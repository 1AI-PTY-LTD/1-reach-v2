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

process_delivery_event(event_data)
    Processes a delivery status callback from the SMS provider. Updates schedule
    status to DELIVERED or FAILED based on provider-reported delivery outcome.

reconcile_stale_sent()
    Beat task. Logs warnings for schedules stuck in SENT status for >24h without
    a delivery callback.

cleanup_stale_media_blobs()
    Beat task (daily). Deletes media blobs for failed MMS schedules older than
    7 days, allowing manual retries within that window.
"""

import logging
import math
import os
import random
from datetime import timedelta
from datetime import datetime as dt
import zoneinfo

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'app.settings')

import django
from celery import Celery, shared_task
from celery.signals import beat_init, task_failure, worker_process_init, worker_ready, worker_shutting_down
from django.conf import settings
from django.db import OperationalError, transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.db import connections

app = Celery('reach')
app.config_from_object('django.conf:settings', namespace='CELERY')
django.setup()

from app.utils.storage import StorageProvider, get_storage_provider
from app.models import (
    Contact,
    FailureCategory,
    Invoice,
    MessageFormat,
    Organisation,
    Schedule,
    ScheduleStatus,
)
from app.utils.billing import record_usage, refund_usage, build_line_items
from app.utils.failure_classifier import classify_failure
from app.utils.segments import estimate_sms_segments
from app.utils.metered_billing import get_billing_provider
from app.utils.sms import SendResult, get_sms_provider

logger = logging.getLogger(__name__)


@beat_init.connect
def _on_beat_init(**kwargs):
    logger.info('celery beat started (pid=%d)', os.getpid())


@worker_ready.connect
def _on_worker_ready(**kwargs):
    logger.info('celery worker ready (pid=%d)', os.getpid())


@worker_shutting_down.connect
def _on_worker_shutting_down(sig=None, how=None, **kwargs):
    logger.warning('celery worker shutting down (sig=%s, how=%s, pid=%d)', sig, how, os.getpid())


@worker_process_init.connect
def _close_db_connections_on_fork(**kwargs):
    """Close inherited DB connections after Celery worker fork.

    Prefork workers inherit the parent's DB connections, which are invalid
    in the child process.  With psycopg3 pooling this also resets the
    connection pool so the child starts fresh.
    """
    connections.close_all()


@task_failure.connect
def _on_task_failure(sender=None, task_id=None, exception=None, traceback=None, **kwargs):
    logger.error(
        'celery task failed: task=%s id=%s error=%s',
        sender.name if sender else 'unknown',
        task_id,
        str(exception),
        exc_info=(type(exception), exception, traceback) if exception else None,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _estimate_parts(message: str, fmt: str) -> int:
    """Estimate message parts without calling the provider.

    SMS segmentation is encoding-aware (GSM-7 vs UCS-2) — see
    app.utils.segments. MMS is always billed as a single unit.
    """
    if fmt == MessageFormat.MMS:
        return 1
    return estimate_sms_segments(message or '')


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


def _cleanup_media_blob(schedule: Schedule) -> None:
    """Delete the media blob for an MMS schedule after it reaches a terminal state.

    Non-fatal: logs a warning on failure but never raises.
    """
    if not schedule.media_url:
        return
    
    blob_name = StorageProvider.extract_blob_name(schedule.media_url)
    if not blob_name:
        return
    get_storage_provider().delete_blob(blob_name)


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
            alphanumeric_sender=schedule.alphanumeric_sender,
        )
    # SMS (and any future formats that share the (to, message) signature)
    return provider.send_sms(to=schedule.phone, message=schedule.text or '',
                             alphanumeric_sender=schedule.alphanumeric_sender)


def _handle_success(schedule: Schedule, result: SendResult) -> None:
    org = schedule.organisation
    with transaction.atomic():
        # Re-fetch under lock: a delivery callback can race us (it matches
        # PROCESSING schedules via a provider_message_id left over from a
        # previous attempt) and must not be regressed from DELIVERED/FAILED
        # back to SENT by this stale instance.
        locked = Schedule.objects.select_for_update().get(pk=schedule.pk)
        if locked.status != ScheduleStatus.PROCESSING:
            logger.warning(
                '_handle_success: schedule %d already advanced to %s — not overwriting with SENT',
                locked.pk, locked.status,
            )
            return

        locked.status = ScheduleStatus.SENT
        locked.sent_time = timezone.now()
        locked.provider_message_id = result.message_id
        locked.error = None
        locked.failure_category = None
        locked.save(update_fields=[
            'status', 'sent_time', 'provider_message_id',
            'error', 'failure_category', 'updated_at',
        ])

        # Subscribed orgs: record usage on SENT (optimistic).
        # Trial orgs: credits were already reserved at dispatch time in the HTTP request.
        if org.billing_mode == org.BILLING_SUBSCRIBED:
            record_usage(
                org,
                units=locked.message_parts,
                format=locked.format or 'sms',
                description=f'{(locked.format or "sms").upper()} to {locked.phone}',
                user=None,
                schedule=locked,
            )

    # Media blob cleanup is deferred until delivery callback (DELIVERED/FAILED)
    # so Welcorp has time to fetch the media URL asynchronously.
    _sync_parent_status(locked)


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

    logger.error(
        'Schedule %d permanently failed (%s): %s',
        schedule.pk, failure_category, result.error,
    )

    # Media blob cleanup deferred to cleanup_stale_media_blobs beat task
    # so the user can manually retry failed MMS within 7 days.
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
        elif children_statuses <= {ScheduleStatus.DELIVERED}:
            new_status = ScheduleStatus.DELIVERED
        elif children_statuses <= {ScheduleStatus.DELIVERED, ScheduleStatus.CANCELLED}:
            new_status = ScheduleStatus.DELIVERED
        else:
            new_status = ScheduleStatus.SENT
    else:
        new_status = ScheduleStatus.PROCESSING

    if parent.status != new_status:
        parent.status = new_status
        parent.save(update_fields=['status', 'updated_at'])


def _block_if_org_ineligible(schedule: Schedule) -> dict | None:
    """Re-check org eligibility at send time (billing gates ran at enqueue time).

    An org can be soft-deleted or fall past_due while schedules sit in the
    queue. Inactive org → cancel the schedule (and any pending children) with a
    refund. Past-due org → park everything back in PENDING; dispatch_due_messages
    skips past_due orgs, so sending resumes automatically once billing recovers.

    Returns a task-result dict when the send is blocked, else None.
    """
    org = schedule.organisation
    active_child_statuses = [
        ScheduleStatus.PENDING, ScheduleStatus.QUEUED,
        ScheduleStatus.RETRYING, ScheduleStatus.PROCESSING,
    ]

    if not org.is_active:
        with transaction.atomic():
            children = list(Schedule.objects.select_for_update().filter(
                parent=schedule, status__in=active_child_statuses,
            ))
            for s in [schedule, *children]:
                s.status = ScheduleStatus.CANCELLED
                s.save(update_fields=['status', 'updated_at'])
                refund_usage(org, s, description='Refund: organisation deactivated')
        logger.warning(
            'send blocked: org %s is inactive — cancelled schedule %d (+%d children)',
            org.clerk_org_id, schedule.pk, len(children),
        )
        return {'skipped': True, 'reason': 'org_inactive'}

    if org.billing_mode == Organisation.BILLING_PAST_DUE:
        with transaction.atomic():
            Schedule.objects.filter(pk=schedule.pk).update(status=ScheduleStatus.PENDING)
            Schedule.objects.filter(
                parent=schedule, status__in=active_child_statuses,
            ).update(status=ScheduleStatus.PENDING)
        logger.warning(
            'send blocked: org %s is past_due — parked schedule %d as PENDING',
            org.clerk_org_id, schedule.pk,
        )
        return {'skipped': True, 'reason': 'org_past_due'}

    return None


def _fail_if_opted_out(schedule: Schedule) -> bool:
    """Fail the send when the recipient has opted out, instead of sending.

    Checked at send time because contacts can opt out (or a carrier OPTO can
    arrive) after a message was scheduled. Returns True when the send was
    blocked; the schedule is FAILED with category opt_out and any prepaid
    charge refunded.
    """
    if not schedule.phone:
        return False
    opted_out = Contact.objects.filter(
        organisation=schedule.organisation, phone=schedule.phone, opt_out=True,
    ).exists()
    if not opted_out:
        return False

    with transaction.atomic():
        schedule.status = ScheduleStatus.FAILED
        schedule.failure_category = FailureCategory.OPT_OUT.value
        schedule.error = 'Recipient has opted out of receiving messages.'
        schedule.save(update_fields=['status', 'failure_category', 'error', 'updated_at'])
        refund_usage(schedule.organisation, schedule)
    logger.warning(
        'send blocked: recipient %s opted out — failed schedule %d without sending',
        schedule.phone, schedule.pk,
    )
    _sync_parent_status(schedule)
    return True


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
            schedule.dispatch_attempted_at = None
            schedule.save(update_fields=['status', 'dispatch_attempted_at', 'updated_at'])
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

    blocked = _block_if_org_ineligible(schedule)
    if blocked:
        return blocked

    if _fail_if_opted_out(schedule):
        return {'skipped': True, 'reason': 'recipient_opted_out'}

    # Committed before the provider HTTP call so crash recovery can tell
    # "worker died before calling the provider" (safe to re-send) from
    # "worker died with the send outcome unknown" (must NOT blindly re-send).
    Schedule.objects.filter(pk=schedule.pk).update(dispatch_attempted_at=timezone.now())

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
            parent.dispatch_attempted_at = None
            parent.save(update_fields=['status', 'dispatch_attempted_at', 'updated_at'])
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

    blocked = _block_if_org_ineligible(parent)
    if blocked:
        return blocked

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

    # Recipients who opted out since scheduling are failed (with refund), not sent
    children = [c for c in children if not _fail_if_opted_out(c)]
    if not children:
        logger.warning(
            'send_batch_message: all recipients of parent %d opted out — nothing sent',
            parent_schedule_id,
        )
        return {'parent_id': parent_schedule_id, 'skipped': True, 'reason': 'all_recipients_opted_out'}

    # Mark children as PROCESSING
    child_pks = [c.pk for c in children]
    Schedule.objects.filter(pk__in=child_pks).update(status=ScheduleStatus.PROCESSING)

    # Committed before the provider HTTP call — see send_message. The marker
    # lives on the parent; the children share the single bulk call's fate.
    Schedule.objects.filter(pk=parent.pk).update(dispatch_attempted_at=timezone.now())

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
        result = provider.send_bulk_mms(recipients, alphanumeric_sender=parent.alphanumeric_sender)
    else:
        result = provider.send_bulk_sms(recipients, alphanumeric_sender=parent.alphanumeric_sender)

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

    # Media blob cleanup is deferred until delivery callback (DELIVERED/FAILED)
    # so Welcorp has time to fetch the media URL asynchronously.

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

        # Media blob cleanup deferred to cleanup_stale_media_blobs beat task.

        logger.error(
            'Batch send permanently failed: parent %d (%s): %s',
            parent.pk, failure_category, error,
        )


_UNKNOWN_OUTCOME_ERROR = (
    'Send outcome unknown: the worker was interrupted after contacting the '
    'provider. Not retried automatically to avoid duplicate delivery — '
    'retry manually if the message did not arrive.'
)


def _fail_unknown_outcome(individual_pks: list, parent_pks: list) -> int:
    """Fail stale PROCESSING schedules whose provider call may have gone out.

    Marks them FAILED with a clear explanation, refunds the prepaid charge,
    and syncs batch parents. Returns the number of schedules failed.
    """
    failed = 0
    for pk in individual_pks:
        with transaction.atomic():
            schedule = Schedule.objects.select_for_update().filter(
                pk=pk, status=ScheduleStatus.PROCESSING,
            ).first()
            if not schedule:
                continue
            schedule.status = ScheduleStatus.FAILED
            schedule.failure_category = 'unknown'
            schedule.error = _UNKNOWN_OUTCOME_ERROR
            schedule.save(update_fields=['status', 'failure_category', 'error', 'updated_at'])
            refund_usage(schedule.organisation, schedule)
            failed += 1
        logger.error('dispatch_due_messages: schedule %d failed with unknown send outcome', pk)

    for pk in parent_pks:
        with transaction.atomic():
            parent = Schedule.objects.select_for_update().filter(
                pk=pk, status=ScheduleStatus.PROCESSING,
            ).first()
            if not parent:
                continue
            children = list(Schedule.objects.select_for_update().filter(
                parent=parent,
                status__in=[ScheduleStatus.PENDING, ScheduleStatus.QUEUED,
                            ScheduleStatus.RETRYING, ScheduleStatus.PROCESSING],
            ))
            for child in children:
                child.status = ScheduleStatus.FAILED
                child.failure_category = 'unknown'
                child.error = _UNKNOWN_OUTCOME_ERROR
                child.save(update_fields=['status', 'failure_category', 'error', 'updated_at'])
                refund_usage(child.organisation, child)
            parent.status = ScheduleStatus.FAILED
            parent.failure_category = 'unknown'
            parent.error = _UNKNOWN_OUTCOME_ERROR
            parent.save(update_fields=['status', 'failure_category', 'error', 'updated_at'])
            failed += 1 + len(children)
        logger.error('dispatch_due_messages: batch parent %d failed with unknown send outcome', pk)

    return failed


# ---------------------------------------------------------------------------
# Beat task: dispatch due PENDING schedules
# ---------------------------------------------------------------------------

@shared_task(name='app.celery.dispatch_due_messages')
def dispatch_due_messages() -> dict:
    """Find PENDING/RETRYING leaf schedules that are due and dispatch them.

    Also recovers stale QUEUED and PROCESSING schedules.
    Uses select_for_update(skip_locked=True) to prevent double-dispatch in clustered
    deployments. Processes in batches of 500 per tick.
    """
    now = timezone.now()
    batch_size = 500
    has_children = Schedule.objects.filter(parent_id=OuterRef('pk'))
    # --- Recover stale QUEUED schedules (Celery task lost before worker pickup) ----------
    # If the broker dropped the task (crash, Redis flush, worker restart before ack),
    # the schedule stays QUEUED forever. Re-enqueue the task and bump updated_at so it
    # won't be re-dispatched again until the next timeout window.
    queued_timeout = getattr(settings, 'MESSAGE_QUEUED_TIMEOUT_MINUTES', 5)
    queued_cutoff = now - timedelta(minutes=queued_timeout)
    stale_queued_qs = Schedule.objects.filter(
        status=ScheduleStatus.QUEUED, updated_at__lte=queued_cutoff,
    )
    stale_queued_individual_pks = list(
        stale_queued_qs.filter(parent__isnull=True)
        .exclude(Exists(has_children))
        .values_list('pk', flat=True)
    )
    stale_queued_parent_pks = list(
        stale_queued_qs.filter(parent__isnull=True)
        .filter(Exists(has_children))
        .values_list('pk', flat=True)
    )
    # Orphaned children: QUEUED but their parent already reached a terminal
    # state, so no batch task will ever pick them up (e.g. recovery reset a
    # child after the parent's bulk send finished without it). A child row is a
    # complete sendable message — dispatch it individually. Children whose
    # parent is still active are left for the parent's batch task.
    terminal = [ScheduleStatus.SENT, ScheduleStatus.DELIVERED,
                ScheduleStatus.FAILED, ScheduleStatus.CANCELLED]
    stale_queued_orphan_pks = list(
        stale_queued_qs.filter(parent__isnull=False, parent__status__in=terminal)
        .values_list('pk', flat=True)
    )
    all_stale_queued = stale_queued_individual_pks + stale_queued_parent_pks + stale_queued_orphan_pks
    recovered_queued = len(all_stale_queued)
    if all_stale_queued:
        Schedule.objects.filter(pk__in=all_stale_queued).update(updated_at=now)
        for pk in stale_queued_individual_pks + stale_queued_orphan_pks:
            send_message.delay(pk)
        for pk in stale_queued_parent_pks:
            send_batch_message.delay(pk)
        logger.warning(
            'dispatch_due_messages: re-dispatched %d stale QUEUED schedules '
            '(%d individual, %d batch parents, %d orphaned children)',
            len(all_stale_queued),
            len(stale_queued_individual_pks),
            len(stale_queued_parent_pks),
            len(stale_queued_orphan_pks),
        )

    # --- Recover stale PROCESSING schedules (worker crashed mid-task) --------------------
    # acks_late + reject_on_worker_lost re-queues the Celery message, but send_message
    # rejects PROCESSING status → schedule stuck. Reset to QUEUED so the task can proceed.
    #
    # Three types of stale schedules:
    #   1. Individual sends (parent=None, no children) → reset + send_message
    #   2. Batch parents (has children) → reset + send_batch_message
    #   3. Batch children (parent set) → reset only (parent task handles them)
    processing_timeout = getattr(settings, 'MESSAGE_PROCESSING_TIMEOUT_MINUTES', 10)
    stale_cutoff = now - timedelta(minutes=processing_timeout)
    stale_qs = Schedule.objects.filter(
        status=ScheduleStatus.PROCESSING, updated_at__lte=stale_cutoff,
    )

    # --- Unknown-outcome schedules: the worker died AFTER the provider call was
    # started (dispatch_attempted_at committed pre-call). The SMS may or may not
    # have gone out — blindly re-sending risks duplicate delivery to the
    # recipient, so fail them with a refund and leave manual retry to the user.
    unknown_individual_pks = list(
        stale_qs.filter(parent__isnull=True, dispatch_attempted_at__isnull=False)
        .exclude(Exists(has_children))
        .values_list('pk', flat=True)
    )
    unknown_parent_pks = list(
        stale_qs.filter(parent__isnull=True, dispatch_attempted_at__isnull=False)
        .filter(Exists(has_children))
        .values_list('pk', flat=True)
    )
    failed_unknown = 0
    if unknown_individual_pks or unknown_parent_pks:
        failed_unknown = _fail_unknown_outcome(unknown_individual_pks, unknown_parent_pks)

    # --- Safe-to-resend schedules: the worker died BEFORE calling the provider
    # (no dispatch_attempted_at). Re-queue and re-dispatch.
    stale_individual_pks = list(
        stale_qs.filter(parent__isnull=True, dispatch_attempted_at__isnull=True)
        .exclude(Exists(has_children))
        .values_list('pk', flat=True)
    )
    stale_parent_pks = list(
        stale_qs.filter(parent__isnull=True, dispatch_attempted_at__isnull=True)
        .filter(Exists(has_children))
        .values_list('pk', flat=True)
    )
    # Children carry no marker of their own (the parent's bulk call decides
    # their fate); only reset children whose parent wasn't just failed above.
    stale_child_pks = list(
        stale_qs.filter(parent__isnull=False)
        .exclude(parent_id__in=unknown_parent_pks)
        .values_list('pk', flat=True)
    )

    all_stale = stale_individual_pks + stale_parent_pks + stale_child_pks
    recovered_processing = len(all_stale)
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
            Schedule.objects.select_for_update(skip_locked=True, of=('self',))
            .filter(
                Q(status=ScheduleStatus.PENDING, scheduled_time__lte=now) |
                Q(status=ScheduleStatus.RETRYING, next_retry_at__lte=now),
            )
            .exclude(parent__isnull=False)  # exclude children
            # Deleted orgs never dispatch; past_due orgs are held in PENDING and
            # resume automatically once billing recovers (send tasks also
            # re-check, for messages already queued when the org was blocked).
            .filter(organisation__is_active=True)
            .exclude(organisation__billing_mode=Organisation.BILLING_PAST_DUE)
            .values_list('pk', flat=True)[:batch_size]
        )

        if not due:
            return {
                'dispatched': 0,
                'recovered_queued': recovered_queued,
                'recovered_processing': recovered_processing,
                'failed_unknown': failed_unknown,
            }

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
    return {
        'dispatched': len(due),
        'recovered_queued': recovered_queued,
        'recovered_processing': recovered_processing,
        'failed_unknown': failed_unknown,
    }


# ---------------------------------------------------------------------------
# Delivery callback processing
# ---------------------------------------------------------------------------

def _find_schedule(provider_message_id: str, recipient_phone: str | None) -> Schedule | None:
    """Find and lock a schedule matching a delivery callback event.

    For batch sends, children share the same provider_message_id (Welcorp job_id)
    so we additionally match on phone number. For single sends, provider_message_id
    alone is sufficient.

    Locks the row (select_for_update) — must be called inside a transaction.
    A concurrent event for the same schedule (duplicate callback, or callback +
    reconciliation poll) blocks here and, once the first commits a terminal
    status, no longer matches the status filter.
    """
    qs = Schedule.objects.select_for_update().filter(
        provider_message_id=provider_message_id,
        status__in=[ScheduleStatus.SENT, ScheduleStatus.PROCESSING],
    )

    if recipient_phone:
        # Try exact phone match first (batch child or single send with phone)
        match = qs.filter(phone=recipient_phone).first()
        if match:
            return match

    # Fallback: single send (no children)
    return qs.filter(parent__isnull=True).first()


def _handle_delivery_success(schedule: Schedule, event_data: dict) -> None:
    """Transition a SENT schedule to DELIVERED.

    Media blob cleanup happens in process_delivery_event after the transaction
    commits — Azure I/O must not run while holding the row lock, and a cleanup
    failure must not roll back the delivery status.
    """
    timestamp = event_data.get('timestamp')
    if timestamp:
        try:
            delivered_time = parse_datetime(timestamp) or timezone.now()
        except (ValueError, TypeError):
            delivered_time = timezone.now()
    else:
        delivered_time = timezone.now()

    schedule.status = ScheduleStatus.DELIVERED
    schedule.delivered_time = delivered_time
    schedule.save(update_fields=['status', 'delivered_time', 'updated_at'])

    logger.info('Schedule %d delivered at %s', schedule.pk, delivered_time)
    _sync_parent_status(schedule)


def _propagate_opt_out(schedule: Schedule) -> None:
    """Mark matching contacts opted out when the carrier reports an opt-out.

    Spam Act compliance: once a recipient has opted out at the carrier level
    (Welcorp OPTO), every contact record with that number in the org must stop
    receiving sends — the send paths filter on Contact.opt_out.
    """
    if not schedule.phone:
        return
    updated = Contact.objects.filter(
        organisation=schedule.organisation, phone=schedule.phone, opt_out=False,
    ).update(opt_out=True)
    if updated:
        logger.warning(
            'Carrier opt-out: marked %d contact(s) with phone %s as opted out (org %s)',
            updated, schedule.phone, schedule.organisation.clerk_org_id,
        )


def _handle_delivery_failure(schedule: Schedule, event_data: dict) -> None:
    """Transition a SENT schedule to FAILED based on a delivery callback."""
    error_code = event_data.get('error_code')
    error_message = event_data.get('error_message', '')

    failure_category_obj, _is_retryable = classify_failure(error_code, None, error_message)
    failure_category = failure_category_obj.value

    org = schedule.organisation
    with transaction.atomic():
        schedule.status = ScheduleStatus.FAILED
        schedule.failure_category = failure_category
        schedule.error = error_message
        schedule.save(update_fields=['status', 'failure_category', 'error', 'updated_at'])
        refund_usage(org, schedule)
        if failure_category == FailureCategory.OPT_OUT.value:
            _propagate_opt_out(schedule)

    logger.error(
        'Schedule %d delivery failed (%s): %s',
        schedule.pk, failure_category, error_message,
    )
    # Media blob cleanup deferred to cleanup_stale_media_blobs beat task.
    _sync_parent_status(schedule)


@shared_task(
    name='app.celery.process_delivery_event',
    queue='messages',
    acks_late=True,
    reject_on_worker_lost=True,
)
def process_delivery_event(event_data: dict) -> dict:
    """Process a delivery status callback from the SMS provider.

    Looks up and row-locks the schedule by provider_message_id (and phone for
    batch sends), then transitions it to DELIVERED or FAILED in one transaction.

    Idempotent and race-safe: only SENT/PROCESSING schedules match, the row
    lock serializes concurrent events for the same schedule (duplicate callback
    POSTs, or a callback racing the reconciliation poll), and the loser re-reads
    a terminal status and skips — so the refund can never be issued twice.
    """
    provider_message_id = event_data.get('provider_message_id')
    recipient_phone = event_data.get('recipient_phone')
    delivery_status = event_data.get('status')

    if not provider_message_id:
        logger.error('process_delivery_event: missing provider_message_id')
        return {'skipped': True, 'reason': 'missing provider_message_id'}

    if delivery_status not in ('delivered', 'failed'):
        logger.warning('process_delivery_event: unknown status %r', delivery_status)
        return {'skipped': True, 'reason': f'unknown_status:{delivery_status}'}

    with transaction.atomic():
        schedule = _find_schedule(provider_message_id, recipient_phone)
        if not schedule:
            logger.info(
                'process_delivery_event: no SENT schedule for provider_message_id=%s phone=%s',
                provider_message_id, recipient_phone,
            )
            return {'skipped': True, 'reason': 'schedule_not_found'}

        if delivery_status == 'delivered':
            _handle_delivery_success(schedule, event_data)
        else:
            _handle_delivery_failure(schedule, event_data)

    # Post-commit, non-critical: blob cleanup does Azure I/O and must not hold
    # the row lock or roll back the status change on failure.
    if delivery_status == 'delivered':
        _cleanup_media_blob(schedule)

    return {'schedule_id': schedule.pk, 'status': delivery_status}


# ---------------------------------------------------------------------------
# Reconciliation
# ---------------------------------------------------------------------------

# Polls up to 50 provider jobs at up to 30s each — needs more than the
# global 300s task time limit.
@shared_task(name='app.celery.reconcile_stale_sent', time_limit=1800, soft_time_limit=1740)
def reconcile_stale_sent() -> dict:
    """Poll provider for delivery status of schedules stuck in SENT.

    Finds schedules that have been SENT for >24h without a delivery callback,
    polls the provider for their status, and dispatches any failure events
    through the normal process_delivery_event pipeline.
    """
    cutoff = timezone.now() - timedelta(hours=24)

    # Get distinct job IDs from stale non-child schedules (one job = one API call)
    stale_ids = list(
        Schedule.objects.filter(
            status=ScheduleStatus.SENT,
            sent_time__lte=cutoff,
            provider_message_id__isnull=False,
        )
        .order_by('sent_time')
        .values_list('provider_message_id', flat=True)
        .distinct()[:50]
    )

    if not stale_ids:
        return {'polled': 0, 'events': 0}

    provider = get_sms_provider()
    total_events = 0

    for job_id in stale_ids:
        try:
            events = provider.poll_job_status(job_id)
        except NotImplementedError:
            logger.info('Provider does not support polling, skipping reconciliation')
            return {'polled': 0, 'events': 0, 'reason': 'not_supported'}
        except Exception:
            logger.exception('Failed to poll job %s', job_id)
            continue

        for event in events:
            process_delivery_event.delay(event.__dict__)
            total_events += 1

    logger.info('reconcile_stale_sent: polled %d jobs, dispatched %d events', len(stale_ids), total_events)
    return {'polled': len(stale_ids), 'events': total_events}


# ---------------------------------------------------------------------------
# Media blob cleanup
# ---------------------------------------------------------------------------

# Iterates blobs with per-blob Azure I/O — may exceed the global time limit.
@shared_task(name='app.celery.cleanup_stale_media_blobs', time_limit=3600, soft_time_limit=3540)
def cleanup_stale_media_blobs() -> dict:
    """Delete media blobs for failed schedules older than 7 days.

    Media blobs are not deleted immediately on failure so that users can
    manually retry failed MMS messages. This task runs daily to clean up
    blobs that are past the retry window.
    """
    cutoff = timezone.now() - timedelta(days=7)
    stale = Schedule.objects.filter(
        status=ScheduleStatus.FAILED,
        media_url__isnull=False,
        updated_at__lt=cutoff,
    ).exclude(media_url='')

    cleaned = 0
    for schedule in stale.iterator():
        _cleanup_media_blob(schedule)
        # Clear media_url so we don't re-attempt on the next run
        schedule.media_url = None
        schedule.save(update_fields=['media_url', 'updated_at'])
        cleaned += 1

    logger.info('cleanup_stale_media_blobs: cleaned %d blobs', cleaned)
    return {'cleaned': cleaned}


# ---------------------------------------------------------------------------
# Metered billing
# ---------------------------------------------------------------------------

@shared_task(name='app.celery.link_billing_customer', bind=True, max_retries=5)
def link_billing_customer(self, org_pk: int) -> None:
    """Retry linking a Stripe customer ID to an org after subscription activation.

    Called when the initial lookup in _handle_subscription_active fails
    (e.g. Clerk hasn't created the Stripe customer yet). Retries with
    exponential backoff: 60s, 120s, 240s, 480s, 960s.
    """
    org = Organisation.objects.get(pk=org_pk)
    if org.billing_customer_id:
        return  # already linked

    provider = get_billing_provider()
    result = provider.find_customer_by_org(org.clerk_org_id)
    if result.success:
        Organisation.objects.filter(pk=org.pk).update(
            billing_customer_id=result.customer_id,
        )
        logger.info(
            'Linked Stripe customer %s for org %s',
            result.customer_id, org.clerk_org_id,
        )
    else:
        logger.warning(
            'link_billing_customer: still no Stripe customer for org %s (attempt %d): %s',
            org.clerk_org_id, self.request.retries + 1, result.error,
        )
        raise self.retry(countdown=60 * (2 ** self.request.retries))


# One Stripe invoice (several API calls) per subscribed org — monthly, slow.
@shared_task(name='app.celery.generate_monthly_invoices', time_limit=3600, soft_time_limit=3540)
def generate_monthly_invoices() -> dict:
    """Generate and send invoices for all subscribed orgs for the previous month.

    Runs on the 1st of each month via beat schedule. Aggregates usage from
    CreditTransaction records, nets refunds, and creates an invoice per org
    via the configured MeteredBillingProvider.

    Idempotent: skips orgs that already have a non-void invoice for the period.
    """
    ADELAIDE_TZ = zoneinfo.ZoneInfo('Australia/Adelaide')
    period_start, period_end = _previous_month_boundaries(ADELAIDE_TZ)
    provider = get_billing_provider()

    created = 0
    skipped = 0
    failed = 0

    for org in Organisation.objects.filter(
        billing_mode=Organisation.BILLING_SUBSCRIBED,
        billing_customer_id__isnull=False,
    ):
        # Idempotency: skip if a non-void invoice already exists for this period
        if Invoice.objects.filter(
            organisation=org,
            period_start=period_start,
        ).exclude(status=Invoice.STATUS_VOID).exists():
            skipped += 1
            continue

        line_items = build_line_items(org, period_start, period_end)

        if not line_items:
            skipped += 1
            continue

        result = provider.create_invoice(
            customer_id=org.billing_customer_id,  # type: ignore[arg-type]  # filtered by __isnull=False
            line_items=line_items,
            period_start=period_start,
            period_end=period_end,
        )

        if result.success:
            Invoice.objects.create(
                organisation=org,
                provider_invoice_id=result.invoice_id,
                status=result.status or Invoice.STATUS_OPEN,
                amount=sum(item.amount for item in line_items),
                invoice_url=result.invoice_url,
                period_start=period_start,
                period_end=period_end,
            )
            logger.info(
                'Created invoice %s ($%s) for org %s, period %s to %s',
                result.invoice_id,
                sum(item.amount for item in line_items),
                org.clerk_org_id,
                period_start.date(), period_end.date(),
            )
            created += 1
        else:
            logger.error(
                'Failed to create invoice for org %s (period %s to %s): %s',
                org.clerk_org_id, period_start.date(), period_end.date(), result.error,
            )
            failed += 1

    logger.info(
        'generate_monthly_invoices: created=%d, skipped=%d, failed=%d',
        created, skipped, failed,
    )
    return {'created': created, 'skipped': skipped, 'failed': failed}


def _previous_month_boundaries(tz) -> tuple:
    """Return (start, end) datetimes for the previous calendar month in the given timezone."""

    now = dt.now(tz)
    # First day of current month
    first_of_current = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    # Last moment of previous month = first of current - 1 microsecond
    # But we use period_end as exclusive upper bound, so period_end = first_of_current
    period_end = first_of_current
    # First of previous month
    if now.month == 1:
        period_start = first_of_current.replace(year=now.year - 1, month=12)
    else:
        period_start = first_of_current.replace(month=now.month - 1)
    return period_start, period_end


