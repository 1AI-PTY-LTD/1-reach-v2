"""
Recovery-path tests for the dispatch/reconciliation beat tasks.

Covers the "worker/broker lost the message" and "delivery callback never
arrived" recovery flows by calling the tasks directly (no real Celery):

- dispatch_due_messages re-dispatches stale QUEUED schedules.
- dispatch_due_messages resets stale PROCESSING schedules WITHOUT a
  dispatch_attempted_at marker (worker died before the provider call) and
  re-sends them.
- dispatch_due_messages fails-with-refund stale PROCESSING schedules WITH a
  dispatch_attempted_at marker (worker died after the provider call) instead of
  re-sending — avoids duplicate delivery.
- reconcile_stale_sent polls the provider for schedules stuck SENT for >24h and
  pumps any returned events through process_delivery_event.
- Fresh schedules (recent updated_at / sent_time) are left untouched.

Staleness is induced by backdating updated_at / dispatch_attempted_at / sent_time
via .update() (bypasses auto_now). send_message / send_batch_message /
process_delivery_event are patched at app.celery so .delay() is asserted, never
executed.
"""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import Mock, patch

import pytest
from django.utils import timezone

from app.celery import dispatch_due_messages, reconcile_stale_sent
from app.models import (
    ContactGroup,
    CreditTransaction,
    MessageFormat,
    Schedule,
    ScheduleStatus,
)
from app.utils.billing import record_usage
from app.utils.sms import DeliveryEvent


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_individual(organisation, user, status, **extra):
    """Create a leaf individual schedule (no parent, no children)."""
    return Schedule.objects.create(
        organisation=organisation,
        phone='0412345678',
        text='Recovery message',
        scheduled_time=timezone.now() - timedelta(hours=1),
        status=status,
        format=MessageFormat.SMS,
        message_parts=1,
        max_retries=3,
        created_by=user,
        updated_by=user,
        **extra,
    )


def _make_parent(organisation, user, status):
    group = ContactGroup.objects.create(
        organisation=organisation, name='Recovery group',
        created_by=user, updated_by=user,
    )
    return Schedule.objects.create(
        organisation=organisation,
        name='Recovery campaign',
        text='Recovery message',
        group=group,
        scheduled_time=timezone.now() - timedelta(hours=1),
        status=status,
        format=MessageFormat.SMS,
        message_parts=1,
        created_by=user,
        updated_by=user,
    )


def _make_child(organisation, user, parent, status):
    return Schedule.objects.create(
        organisation=organisation,
        parent=parent,
        phone='0412999999',
        text='Recovery message',
        scheduled_time=timezone.now() - timedelta(hours=1),
        status=status,
        format=MessageFormat.SMS,
        message_parts=1,
        max_retries=3,
        created_by=user,
        updated_by=user,
    )


def _backdate(pk, minutes, *, dispatch_attempted=False):
    """Backdate updated_at (and optionally dispatch_attempted_at) into the past."""
    past = timezone.now() - timedelta(minutes=minutes)
    fields = {'updated_at': past}
    if dispatch_attempted:
        fields['dispatch_attempted_at'] = past
    Schedule.objects.filter(pk=pk).update(**fields)


# ---------------------------------------------------------------------------
# Stale QUEUED recovery (broker dropped the task)
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestStaleQueuedRedispatch:
    def test_stale_queued_individual_is_redispatched(self, db, organisation, user):
        """A QUEUED individual schedule past the queued timeout is re-sent."""
        sched = _make_individual(organisation, user, ScheduleStatus.QUEUED)
        _backdate(sched.pk, minutes=10)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            mock_send.delay.return_value = None
            result = dispatch_due_messages()

        mock_send.delay.assert_called_once_with(sched.pk)
        mock_batch.delay.assert_not_called()
        assert result['recovered_queued'] == 1
        sched.refresh_from_db()
        assert sched.status == ScheduleStatus.QUEUED

    def test_stale_queued_batch_parent_is_redispatched(self, db, organisation, user):
        """A QUEUED batch parent past the queued timeout is re-sent via the batch task."""
        parent = _make_parent(organisation, user, ScheduleStatus.QUEUED)
        _make_child(organisation, user, parent, ScheduleStatus.QUEUED)
        _backdate(parent.pk, minutes=10)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            mock_batch.delay.return_value = None
            result = dispatch_due_messages()

        mock_batch.delay.assert_called_once_with(parent.pk)
        mock_send.delay.assert_not_called()
        assert result['recovered_queued'] == 1


# ---------------------------------------------------------------------------
# Stale PROCESSING recovery (worker crashed mid-task)
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestStaleProcessingRecovery:
    def test_processing_without_marker_is_reset_and_resent(self, db, organisation, user):
        """No dispatch_attempted_at → worker died BEFORE the provider call → safe to re-send."""
        sched = _make_individual(organisation, user, ScheduleStatus.PROCESSING)
        # No dispatch_attempted_at set → marker is NULL.
        _backdate(sched.pk, minutes=15)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            mock_send.delay.return_value = None
            result = dispatch_due_messages()

        mock_send.delay.assert_called_once_with(sched.pk)
        mock_batch.delay.assert_not_called()
        assert result['recovered_processing'] == 1
        assert result['failed_unknown'] == 0
        sched.refresh_from_db()
        assert sched.status == ScheduleStatus.QUEUED

    def test_processing_with_marker_is_failed_with_refund_not_resent(self, db, organisation, user):
        """dispatch_attempted_at set → provider call may have gone out → fail+refund, never re-send."""
        organisation.billing_mode = organisation.BILLING_PREPAID
        organisation.credit_balance = Decimal('10.00')
        organisation.save()

        sched = _make_individual(organisation, user, ScheduleStatus.PROCESSING)
        # Reserve the prepaid charge so we can assert it is refunded.
        record_usage(organisation, 1, 'sms', 'dispatch', user, sched)
        _backdate(sched.pk, minutes=15, dispatch_attempted=True)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            result = dispatch_due_messages()

        # Never re-sent — duplicate delivery risk.
        mock_send.delay.assert_not_called()
        mock_batch.delay.assert_not_called()
        assert result['failed_unknown'] == 1
        assert result['recovered_processing'] == 0

        sched.refresh_from_db()
        assert sched.status == ScheduleStatus.FAILED
        assert sched.failure_category == 'unknown'

        # Prepaid reservation refunded (balance restored, REFUND row written).
        organisation.refresh_from_db()
        assert organisation.credit_balance == Decimal('10.00')
        assert CreditTransaction.objects.filter(
            organisation=organisation, schedule=sched,
            transaction_type=CreditTransaction.REFUND,
        ).exists()

    def test_fresh_processing_is_untouched(self, db, organisation, user):
        """A PROCESSING schedule updated recently (within timeout) is left alone."""
        sched = _make_individual(organisation, user, ScheduleStatus.PROCESSING)
        # updated_at defaults to now() — well within MESSAGE_PROCESSING_TIMEOUT_MINUTES.

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            result = dispatch_due_messages()

        mock_send.delay.assert_not_called()
        mock_batch.delay.assert_not_called()
        assert result['recovered_processing'] == 0
        assert result['failed_unknown'] == 0
        sched.refresh_from_db()
        assert sched.status == ScheduleStatus.PROCESSING


# ---------------------------------------------------------------------------
# reconcile_stale_sent (delivery callback never arrived)
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestReconcileStaleSent:
    def test_polls_provider_for_schedules_sent_over_24h(self, db, organisation, user):
        """A schedule SENT >24h ago is polled and any returned events are dispatched."""
        sched = _make_individual(
            organisation, user, ScheduleStatus.SENT,
            provider_message_id='job-stale-1',
        )
        # sent_time is the staleness key for reconcile (>24h).
        Schedule.objects.filter(pk=sched.pk).update(
            sent_time=timezone.now() - timedelta(hours=25),
        )

        event = DeliveryEvent(
            provider_message_id='job-stale-1',
            status='failed',
            recipient_phone='0412345678',
        )
        provider = Mock()
        provider.poll_job_status.return_value = [event]

        with patch('app.celery.get_sms_provider', return_value=provider), \
             patch('app.celery.process_delivery_event') as mock_pde:
            mock_pde.delay.return_value = None
            result = reconcile_stale_sent()

        provider.poll_job_status.assert_called_once_with('job-stale-1')
        mock_pde.delay.assert_called_once_with(event.__dict__)
        assert result == {'polled': 1, 'events': 1}

    def test_fresh_sent_schedules_not_polled(self, db, organisation, user):
        """A schedule SENT recently (<24h) is not polled."""
        sched = _make_individual(
            organisation, user, ScheduleStatus.SENT,
            provider_message_id='job-fresh-1',
        )
        Schedule.objects.filter(pk=sched.pk).update(
            sent_time=timezone.now() - timedelta(hours=1),
        )

        provider = Mock()
        with patch('app.celery.get_sms_provider', return_value=provider), \
             patch('app.celery.process_delivery_event') as mock_pde:
            result = reconcile_stale_sent()

        provider.poll_job_status.assert_not_called()
        mock_pde.delay.assert_not_called()
        assert result == {'polled': 0, 'events': 0}

    def test_provider_without_polling_support_is_skipped(self, db, organisation, user):
        """A provider that raises NotImplementedError short-circuits cleanly."""
        sched = _make_individual(
            organisation, user, ScheduleStatus.SENT,
            provider_message_id='job-stale-2',
        )
        Schedule.objects.filter(pk=sched.pk).update(
            sent_time=timezone.now() - timedelta(hours=25),
        )

        provider = Mock()
        provider.poll_job_status.side_effect = NotImplementedError
        with patch('app.celery.get_sms_provider', return_value=provider), \
             patch('app.celery.process_delivery_event') as mock_pde:
            result = reconcile_stale_sent()

        mock_pde.delay.assert_not_called()
        assert result['polled'] == 0
        assert result.get('reason') == 'not_supported'
