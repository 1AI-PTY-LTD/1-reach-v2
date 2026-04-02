"""
Celery application and async tasks for 1Reach.

Tasks
-----
send_message(schedule_id)
    Core send task. Handles all message formats (SMS, MMS, future) via format-agnostic
    dispatch. Classifies failures as transient (retried with exponential backoff) or
    permanent (terminal, credits refunded immediately).

dispatch_due_messages()
    Beat task (every 60s). Finds PENDING leaf schedules whose scheduled_time <= now()
    and queues them for sending.
"""

import logging
import math
import os
import random
from datetime import timedelta

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'app.settings')

import django
from celery import Celery, shared_task
from django.conf import settings
from django.db import OperationalError, transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

app = Celery('reach')
app.config_from_object('django.conf:settings', namespace='CELERY')
django.setup()

from app.models import MessageFormat, Schedule, ScheduleStatus
from app.utils.billing import record_usage, refund_usage
from app.utils.failure_classifier import classify_failure
from app.utils.sms import SendResult, get_sms_provider

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _estimate_parts(message: str, fmt: str) -> int:
    """Estimate SMS message parts without calling the provider."""
    if fmt == MessageFormat.MMS:
        return 1
    length = len(message or '')
    if length <= 160:
        return 1
    return math.ceil(length / 153)


def _compute_backoff_delay(retry_count: int) -> int:
    """Exponential backoff with full jitter.

    Formula: min(base * 2^retry_count, max_delay) * (1 ± jitter)
    Default: 60s → 120s → 240s → 480s (capped at 3600s, ±25% jitter)
    """
    base = getattr(settings, 'MESSAGE_RETRY_BASE_DELAY', 60)
    max_delay = getattr(settings, 'MESSAGE_RETRY_MAX_DELAY', 3600)
    jitter = getattr(settings, 'MESSAGE_RETRY_JITTER', 0.25)

    delay = min(base * (2 ** retry_count), max_delay)
    delay = delay * (1 + jitter * (random.random() - 0.5) * 2)
    return max(1, int(delay))


def _dispatch_to_provider(provider, schedule: Schedule) -> SendResult:
    """Route to the correct provider method based on schedule.format.

    Format-agnostic: adding a new format requires only a new elif branch here
    and a new MessageFormat choice — the retry/billing machinery is unchanged.
    """
    if schedule.format == MessageFormat.MMS:
        return provider.send_mms(
            to=schedule.phone,
            message=schedule.text or '',
            media_url=schedule.media_url or '',
            subject=schedule.subject,
        )
    # SMS (and any future formats that share the (to, message) signature)
    return provider.send_sms(to=schedule.phone, message=schedule.text or '')


def _handle_success(schedule: Schedule, result: SendResult) -> None:
    org = schedule.organisation
    with transaction.atomic():
        schedule.status = ScheduleStatus.SENT
        schedule.sent_time = timezone.now()
        schedule.provider_message_id = result.message_id
        schedule.error = None
        schedule.failure_category = None
        schedule.save(update_fields=[
            'status', 'sent_time', 'provider_message_id',
            'error', 'failure_category', 'updated_at',
        ])

        # Subscribed orgs: record usage on SENT (optimistic).
        # Trial orgs: credits were already reserved at dispatch time in the HTTP request.
        if org.billing_mode == org.BILLING_SUBSCRIBED:
            record_usage(
                org,
                units=schedule.message_parts,
                format=schedule.format or 'sms',
                description=f'{(schedule.format or "sms").upper()} to {schedule.phone}',
                user=None,
                schedule=schedule,
            )

    _sync_parent_status(schedule)


def _schedule_retry(schedule: Schedule, result: SendResult, failure_category: str) -> None:
    delay = _compute_backoff_delay(schedule.retry_count)
    next_retry_at = timezone.now() + timedelta(seconds=delay)

    with transaction.atomic():
        schedule.status = ScheduleStatus.RETRYING
        schedule.retry_count += 1
        schedule.next_retry_at = next_retry_at
        schedule.failure_category = failure_category
        schedule.error = result.error
        schedule.save(update_fields=[
            'status', 'retry_count', 'next_retry_at',
            'failure_category', 'error', 'updated_at',
        ])

    send_message.apply_async(args=[schedule.pk], countdown=delay)
    logger.info(
        'Scheduled retry %d/%d for schedule %d in %ds (%s)',
        schedule.retry_count, schedule.max_retries, schedule.pk, delay, failure_category,
    )


def _mark_permanently_failed(schedule: Schedule, result: SendResult, failure_category: str) -> None:
    org = schedule.organisation
    with transaction.atomic():
        schedule.status = ScheduleStatus.FAILED
        schedule.failure_category = failure_category
        schedule.error = result.error
        schedule.save(update_fields=['status', 'failure_category', 'error', 'updated_at'])
        refund_usage(org, schedule)

    logger.warning(
        'Schedule %d permanently failed (%s): %s',
        schedule.pk, failure_category, result.error,
    )

    _sync_parent_status(schedule)


def _sync_parent_status(schedule: Schedule) -> None:
    """Update parent group schedule status based on children's statuses."""
    parent = schedule.parent
    if not parent:
        return

    terminal = {ScheduleStatus.SENT, ScheduleStatus.DELIVERED, ScheduleStatus.FAILED, ScheduleStatus.CANCELLED}
    children_statuses = set(
        Schedule.objects.filter(parent=parent).values_list('status', flat=True)
    )

    if not children_statuses:
        return

    all_terminal = children_statuses.issubset(terminal)

    if all_terminal:
        if children_statuses <= {ScheduleStatus.CANCELLED}:
            new_status = ScheduleStatus.CANCELLED
        elif ScheduleStatus.FAILED in children_statuses:
            new_status = ScheduleStatus.FAILED
        else:
            new_status = ScheduleStatus.SENT
    else:
        new_status = ScheduleStatus.PROCESSING

    if parent.status != new_status:
        parent.status = new_status
        parent.save(update_fields=['status', 'updated_at'])


def _handle_failure(schedule: Schedule, result: SendResult) -> None:
    failure_category_value = result.failure_category
    is_retryable = result.retryable

    if not failure_category_value:
        failure_category_obj, is_retryable = classify_failure(
            result.error_code,
            result.http_status,
            result.error,
        )
        failure_category_value = failure_category_obj.value

    can_retry = is_retryable and schedule.retry_count < schedule.max_retries

    if can_retry:
        _schedule_retry(schedule, result, failure_category_value)
    else:
        _mark_permanently_failed(schedule, result, failure_category_value)


# ---------------------------------------------------------------------------
# Core send task
# ---------------------------------------------------------------------------

@shared_task(
    bind=True,
    name='app.celery.send_message',
    queue='messages',
    acks_late=True,
    reject_on_worker_lost=True,
)
def send_message(self, schedule_id: int) -> dict:
    """Send a single message (any format) with retry support.

    Uses select_for_update(nowait=True) to prevent double-send from concurrent workers.
    """
    # Acquire row lock — discard if another worker already holds it
    try:
        with transaction.atomic():
            schedule = Schedule.objects.select_for_update(nowait=True).get(
                pk=schedule_id,
                status__in=[ScheduleStatus.QUEUED, ScheduleStatus.RETRYING],
            )
            schedule.status = ScheduleStatus.PROCESSING
            schedule.save(update_fields=['status', 'updated_at'])
    except Schedule.DoesNotExist:
        logger.warning(
            'send_message: schedule %d not found or wrong status — skipping',
            schedule_id,
        )
        return {'skipped': True, 'reason': 'not_found_or_wrong_status'}
    except OperationalError:
        logger.warning(
            'send_message: schedule %d locked by another worker — discarding duplicate',
            schedule_id,
        )
        return {'skipped': True, 'reason': 'concurrent_lock'}

    # Call provider outside the lock to avoid holding it during network I/O
    provider = get_sms_provider()
    result = _dispatch_to_provider(provider, schedule)

    if result.success:
        _handle_success(schedule, result)
    else:
        _handle_failure(schedule, result)

    return {'schedule_id': schedule_id, 'success': result.success}


# ---------------------------------------------------------------------------
# Batch send task (group sends / multi-recipient sends)
# ---------------------------------------------------------------------------

@shared_task(
    bind=True,
    name='app.celery.send_batch_message',
    queue='messages',
    acks_late=True,
    reject_on_worker_lost=True,
)
def send_batch_message(self, parent_schedule_id: int) -> dict:
    """Send a batch of messages via a single provider API call.

    Used for group sends and multi-recipient sends. All children share the
    same Welcorp job. On failure the whole batch is retried or failed together.
    """
    # Acquire lock on parent schedule
    try:
        with transaction.atomic():
            parent = Schedule.objects.select_for_update(nowait=True).get(
                pk=parent_schedule_id,
                status__in=[ScheduleStatus.QUEUED, ScheduleStatus.RETRYING],
            )
            parent.status = ScheduleStatus.PROCESSING
            parent.save(update_fields=['status', 'updated_at'])
    except Schedule.DoesNotExist:
        logger.warning(
            'send_batch_message: parent %d not found or wrong status — skipping',
            parent_schedule_id,
        )
        return {'skipped': True, 'reason': 'not_found_or_wrong_status'}
    except OperationalError:
        logger.warning(
            'send_batch_message: parent %d locked by another worker — discarding',
            parent_schedule_id,
        )
        return {'skipped': True, 'reason': 'concurrent_lock'}

    # Load children that need sending (PENDING from scheduled creates, QUEUED/RETRYING from dispatch)
    children = list(
        Schedule.objects.filter(parent=parent)
        .filter(status__in=[ScheduleStatus.PENDING, ScheduleStatus.QUEUED, ScheduleStatus.RETRYING])
        .order_by('pk')
    )

    if not children:
        parent.status = ScheduleStatus.SENT
        parent.save(update_fields=['status', 'updated_at'])
        logger.info('send_batch_message: parent %d has no pending children', parent_schedule_id)
        return {'parent_id': parent_schedule_id, 'no_children': True}

    # Mark children as PROCESSING
    child_pks = [c.pk for c in children]
    Schedule.objects.filter(pk__in=child_pks).update(status=ScheduleStatus.PROCESSING)

    # Build recipients and call provider
    provider = get_sms_provider()
    recipients = [
        {'to': child.phone, 'message': child.text or '', 'message_parts': child.message_parts}
        for child in children
    ]
    if parent.format == MessageFormat.MMS:
        for i, child in enumerate(children):
            recipients[i]['media_url'] = child.media_url or ''
            recipients[i]['subject'] = child.subject
            recipients[i]['message_parts'] = 1
        result = provider.send_bulk_mms(recipients)
    else:
        result = provider.send_bulk_sms(recipients)

    if result['success']:
        _handle_batch_success(parent, children, result)
        return {'parent_id': parent_schedule_id, 'success': True, 'sent': len(children)}

    _handle_batch_failure(parent, children, result)
    return {'parent_id': parent_schedule_id, 'success': False, 'error': result.get('error')}


def _handle_batch_success(parent: Schedule, children: list[Schedule], result: dict) -> None:
    """Mark all children as SENT and record billing."""
    now = timezone.now()
    org = parent.organisation
    per_recipient = result.get('results', [])

    for i, child in enumerate(children):
        child_result = per_recipient[i] if i < len(per_recipient) else {}
        with transaction.atomic():
            child.status = ScheduleStatus.SENT
            child.sent_time = now
            child.provider_message_id = child_result.get('message_id')
            child.error = None
            child.failure_category = None
            child.save(update_fields=[
                'status', 'sent_time', 'provider_message_id',
                'error', 'failure_category', 'updated_at',
            ])

            if org.billing_mode == org.BILLING_SUBSCRIBED:
                record_usage(
                    org,
                    units=child.message_parts,
                    format=child.format or 'sms',
                    description=f'{(child.format or "sms").upper()} to {child.phone}',
                    user=None,
                    schedule=child,
                )

    parent.status = ScheduleStatus.SENT
    parent.sent_time = now
    parent.save(update_fields=['status', 'sent_time', 'updated_at'])

    logger.info(
        'Batch send succeeded: parent %d, %d children sent',
        parent.pk, len(children),
    )


def _handle_batch_failure(parent: Schedule, children: list[Schedule], result: dict) -> None:
    """Handle batch send failure — retry or mark permanently failed."""
    error = result.get('error', 'Batch send failed')
    is_retryable = result.get('retryable', True)
    failure_category = result.get('failure_category')

    if not failure_category:
        fc, is_retryable = classify_failure(None, None, error)
        failure_category = fc.value

    can_retry = is_retryable and parent.retry_count < parent.max_retries

    if can_retry:
        # Reset children to QUEUED so the retry picks them up
        child_pks = [c.pk for c in children]
        Schedule.objects.filter(pk__in=child_pks).update(status=ScheduleStatus.QUEUED)

        delay = _compute_backoff_delay(parent.retry_count)
        next_retry_at = timezone.now() + timedelta(seconds=delay)

        with transaction.atomic():
            parent.status = ScheduleStatus.RETRYING
            parent.retry_count += 1
            parent.next_retry_at = next_retry_at
            parent.failure_category = failure_category
            parent.error = error
            parent.save(update_fields=[
                'status', 'retry_count', 'next_retry_at',
                'failure_category', 'error', 'updated_at',
            ])

        send_batch_message.apply_async(args=[parent.pk], countdown=delay)
        logger.info(
            'Scheduled batch retry %d/%d for parent %d in %ds (%s)',
            parent.retry_count, parent.max_retries, parent.pk, delay, failure_category,
        )
    else:
        # Permanently fail all children and refund credits
        org = parent.organisation
        for child in children:
            with transaction.atomic():
                child.status = ScheduleStatus.FAILED
                child.failure_category = failure_category
                child.error = error
                child.save(update_fields=['status', 'failure_category', 'error', 'updated_at'])
                refund_usage(org, child)

        parent.status = ScheduleStatus.FAILED
        parent.failure_category = failure_category
        parent.error = error
        parent.save(update_fields=['status', 'failure_category', 'error', 'updated_at'])

        logger.warning(
            'Batch send permanently failed: parent %d (%s): %s',
            parent.pk, failure_category, error,
        )


# ---------------------------------------------------------------------------
# Beat task: dispatch due PENDING schedules
# ---------------------------------------------------------------------------

@shared_task(name='app.celery.dispatch_due_messages')
def dispatch_due_messages() -> dict:
    """Find PENDING/RETRYING leaf schedules that are due and dispatch them.

    Also recovers stale PROCESSING schedules (worker crashed mid-task).
    Uses select_for_update(skip_locked=True) to prevent double-dispatch in clustered
    deployments. Processes in batches of 500 per tick.
    """
    now = timezone.now()
    batch_size = 500
    processing_timeout = getattr(settings, 'MESSAGE_PROCESSING_TIMEOUT_MINUTES', 10)
    stale_cutoff = now - timedelta(minutes=processing_timeout)

    # Recover stale PROCESSING schedules (worker crashed between PROCESSING and completion).
    # acks_late + reject_on_worker_lost re-queues the Celery message, but send_message rejects
    # PROCESSING status → schedule stuck. Reset to QUEUED so the re-queued task can proceed.
    #
    # Three types of stale schedules:
    #   1. Individual sends (parent=None, no children) → reset + send_message
    #   2. Batch parents (has children) → reset + send_batch_message
    #   3. Batch children (parent set) → reset only (parent task handles them)
    has_children = Schedule.objects.filter(parent_id=OuterRef('pk'))
    stale_qs = Schedule.objects.filter(
        status=ScheduleStatus.PROCESSING, updated_at__lte=stale_cutoff,
    )
    stale_individual_pks = list(
        stale_qs.filter(parent__isnull=True)
        .exclude(Exists(has_children))
        .values_list('pk', flat=True)
    )
    stale_parent_pks = list(
        stale_qs.filter(parent__isnull=True)
        .filter(Exists(has_children))
        .values_list('pk', flat=True)
    )
    stale_child_pks = list(
        stale_qs.filter(parent__isnull=False)
        .values_list('pk', flat=True)
    )

    all_stale = stale_individual_pks + stale_parent_pks + stale_child_pks
    if all_stale:
        Schedule.objects.filter(pk__in=all_stale).update(status=ScheduleStatus.QUEUED)
        for pk in stale_individual_pks:
            send_message.delay(pk)
        for pk in stale_parent_pks:
            send_batch_message.delay(pk)
        # stale children: just reset, parent batch task will pick them up
        logger.warning('dispatch_due_messages: reset %d stale PROCESSING schedules', len(all_stale))

    with transaction.atomic():
        # Dispatch two types of schedules:
        #   1. Individual sends (parent=None, no parent) — dispatched via send_message
        #   2. Batch parents (parent=None, has children) — dispatched via send_batch_message
        # Children (parent set) are NOT dispatched directly — handled by parent's batch task.
        due = list(
            Schedule.objects.select_for_update(skip_locked=True)
            .filter(
                Q(status=ScheduleStatus.PENDING, scheduled_time__lte=now) |
                Q(status=ScheduleStatus.RETRYING, next_retry_at__lte=now),
            )
            .exclude(parent__isnull=False)  # exclude children
            .values_list('pk', flat=True)[:batch_size]
        )

        if not due:
            return {'dispatched': 0}

        Schedule.objects.filter(pk__in=due).update(
            status=ScheduleStatus.QUEUED,
        )

    # Determine which are batch parents (have children) vs individual sends
    batch_parent_pks = set(
        Schedule.objects.filter(pk__in=due)
        .filter(Exists(Schedule.objects.filter(parent_id=OuterRef('pk'))))
        .values_list('pk', flat=True)
    )

    for schedule_id in due:
        if schedule_id in batch_parent_pks:
            send_batch_message.delay(schedule_id)
        else:
            send_message.delay(schedule_id)

    logger.info('dispatch_due_messages: dispatched %d schedules', len(due))
    return {'dispatched': len(due)}
