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
from django.db.models import Q
from django.utils import timezone

app = Celery('reach')
app.config_from_object('django.conf:settings', namespace='CELERY')
django.setup()

from app.models import MessageFormat, Schedule, ScheduleStatus
from app.utils.billing import record_usage, refund_usage
from app.utils.failure_classifier import classify_failure
from app.utils.sms import get_sms_provider

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


def _dispatch_to_provider(provider, schedule: Schedule) -> dict:
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


def _handle_success(schedule: Schedule, result: dict) -> None:
    org = schedule.organisation
    with transaction.atomic():
        schedule.status = ScheduleStatus.SENT
        schedule.sent_time = timezone.now()
        schedule.provider_message_id = result.get('message_id')
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


def _schedule_retry(schedule: Schedule, result: dict, failure_category: str) -> None:
    delay = _compute_backoff_delay(schedule.retry_count)
    next_retry_at = timezone.now() + timedelta(seconds=delay)

    with transaction.atomic():
        schedule.status = ScheduleStatus.RETRYING
        schedule.retry_count += 1
        schedule.next_retry_at = next_retry_at
        schedule.failure_category = failure_category
        schedule.error = result.get('error')
        schedule.save(update_fields=[
            'status', 'retry_count', 'next_retry_at',
            'failure_category', 'error', 'updated_at',
        ])

    send_message.apply_async(args=[schedule.pk], countdown=delay)
    logger.info(
        'Scheduled retry %d/%d for schedule %d in %ds (%s)',
        schedule.retry_count, schedule.max_retries, schedule.pk, delay, failure_category,
    )


def _mark_permanently_failed(schedule: Schedule, result: dict, failure_category: str) -> None:
    org = schedule.organisation
    with transaction.atomic():
        schedule.status = ScheduleStatus.FAILED
        schedule.failure_category = failure_category
        schedule.error = result.get('error')
        schedule.save(update_fields=['status', 'failure_category', 'error', 'updated_at'])
        refund_usage(org, schedule)

    logger.warning(
        'Schedule %d permanently failed (%s): %s',
        schedule.pk, failure_category, result.get('error'),
    )


def _handle_failure(schedule: Schedule, result: dict) -> None:
    failure_category_value = result.get('failure_category')
    is_retryable = result.get('retryable', False)

    if not failure_category_value:
        failure_category_obj, is_retryable = classify_failure(
            result.get('error_code'),
            result.get('http_status'),
            result.get('error'),
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

    if result['success']:
        _handle_success(schedule, result)
    else:
        _handle_failure(schedule, result)

    return {'schedule_id': schedule_id, 'success': result['success']}


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

    # Gap 3: Recover stale PROCESSING schedules (worker crashed between PROCESSING and completion).
    # acks_late + reject_on_worker_lost re-queues the Celery message, but send_message rejects
    # PROCESSING status → schedule stuck. Reset to QUEUED so the re-queued task can proceed.
    stale_pks = list(
        Schedule.objects
        .filter(status=ScheduleStatus.PROCESSING, updated_at__lte=stale_cutoff)
        .values_list('pk', flat=True)
    )
    if stale_pks:
        Schedule.objects.filter(pk__in=stale_pks).update(status=ScheduleStatus.QUEUED)
        for pk in stale_pks:
            send_message.delay(pk)
        logger.warning('dispatch_due_messages: reset %d stale PROCESSING schedules', len(stale_pks))

    with transaction.atomic():
        # Leaf schedules are either:
        #   - group children (parent set, group set), or
        #   - individual schedules (parent=None, group=None)
        # Group parents (parent=None, group set) are containers only — never sent directly.
        #
        # Gap 2: Also pick up overdue RETRYING schedules. Worker may crash after marking a
        # schedule RETRYING + setting next_retry_at but before calling apply_async (which is
        # outside the transaction). The beat task is the safety net that recovers these.
        due = list(
            Schedule.objects.select_for_update(skip_locked=True)
            .filter(
                Q(status=ScheduleStatus.PENDING, scheduled_time__lte=now) |
                Q(status=ScheduleStatus.RETRYING, next_retry_at__lte=now),
            )
            .exclude(
                parent__isnull=True, group__isnull=False,  # exclude group-parent containers
            )
            .values_list('pk', flat=True)[:batch_size]
        )

        if not due:
            return {'dispatched': 0}

        Schedule.objects.filter(pk__in=due).update(
            status=ScheduleStatus.QUEUED,
        )

    for schedule_id in due:
        send_message.delay(schedule_id)

    logger.info('dispatch_due_messages: dispatched %d schedules', len(due))
    return {'dispatched': len(due)}
