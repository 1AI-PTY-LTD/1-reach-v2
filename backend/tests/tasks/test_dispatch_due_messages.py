"""
Tests for the dispatch_due_messages Celery beat task.

Two complementary styles are used:

ROUTING tests patch ``app.celery.send_message`` / ``app.celery.send_batch_message``
and assert which task is targeted (single vs batch), the dispatched count, and
which schedules are skipped — without executing any send.

EAGER (dispatch -> EXECUTE) tests run under Celery's ``task_always_eager`` mode so
the dispatched task runs synchronously in-process against a mocked SMS provider
(no real Welcorp call). They assert the schedule reaches its expected terminal
status: PENDING/QUEUED/PROCESSING -> SENT on success, RETRYING/FAILED on a
failure-mock, and FAILED + refund on a fail-with-refund recovery.

Verifies that:
- PENDING parents (batch) with scheduled_time <= now are QUEUED and dispatched
  via send_batch_message.
- PENDING individual schedules (no parent, no children) are QUEUED and dispatched
  via send_message.
- Children (parent set) are excluded — the parent's batch task handles them.
- Stale PROCESSING recovery distinguishes individual sends, batch parents, and
  batch children.
"""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import Mock, patch

import pytest
import redis
from django.conf import settings
from django.utils import timezone

from app.models import (
    ContactGroup,
    CreditTransaction,
    MessageFormat,
    Schedule,
    ScheduleStatus,
)
from app.celery import dispatch_due_messages
from app.utils.billing import record_usage


# ---------------------------------------------------------------------------
# Shared eager-mode fixture — execute Celery tasks synchronously (no broker)
# ---------------------------------------------------------------------------

@pytest.fixture
def celery_eager():
    """Run Celery tasks synchronously so .delay()/.apply_async() execute in-process."""
    from app.celery import app as celery_app
    celery_app.conf.update(task_always_eager=True, task_eager_propagates=True)
    yield
    celery_app.conf.update(task_always_eager=False, task_eager_propagates=False)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_group(organisation, user):
    """Create a ContactGroup for use in group schedule tests."""
    return ContactGroup.objects.create(
        organisation=organisation,
        name='Test group',
        created_by=user,
        updated_by=user,
    )


def _make_parent(organisation, user, group=None, scheduled_time=None, status=ScheduleStatus.PENDING):
    """Create a group-parent schedule (group set, no parent FK)."""
    if group is None:
        group = _make_group(organisation, user)
    return Schedule.objects.create(
        organisation=organisation,
        name='Group campaign',
        text='Group message',
        group=group,
        scheduled_time=scheduled_time or timezone.now() - timedelta(minutes=5),
        status=status,
        format=MessageFormat.SMS,
        message_parts=1,
        created_by=user,
        updated_by=user,
    )


def _make_child(organisation, user, parent, group=None, scheduled_time=None, status=ScheduleStatus.PENDING):
    """Create a leaf child schedule (has parent FK)."""
    return Schedule.objects.create(
        organisation=organisation,
        parent=parent,
        phone='0412345678',
        text='Group message',
        scheduled_time=scheduled_time or timezone.now() - timedelta(minutes=5),
        status=status,
        format=MessageFormat.SMS,
        message_parts=1,
        max_retries=3,
        created_by=user,
        updated_by=user,
    )


def _make_individual(organisation, user, status=ScheduleStatus.PENDING, **extra):
    """Create a leaf individual schedule (no parent, no children).

    Defaults for text / scheduled_time / max_retries can be overridden via extra.
    """
    extra.setdefault('text', 'Individual message')
    extra.setdefault('scheduled_time', timezone.now() - timedelta(minutes=5))
    extra.setdefault('max_retries', 3)
    return Schedule.objects.create(
        organisation=organisation,
        phone='0412345678',
        status=status,
        format=MessageFormat.SMS,
        message_parts=1,
        created_by=user,
        updated_by=user,
        **extra,
    )


# ---------------------------------------------------------------------------
# Core dispatch ROUTING tests (which task / counts / skips) — no execution
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestDispatchDueMessages:
    def test_dispatches_batch_parent(self, db, organisation, user):
        """PENDING parent with children dispatched via send_batch_message."""
        parent = _make_parent(organisation, user)
        _make_child(organisation, user, parent)
        _make_child(organisation, user, parent)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            mock_batch.delay.return_value = None
            result = dispatch_due_messages()

        assert result == {'dispatched': 1, 'recovered_queued': 0, 'recovered_processing': 0, 'failed_unknown': 0}
        mock_batch.delay.assert_called_once_with(parent.pk)
        mock_send.delay.assert_not_called()

        parent.refresh_from_db()
        assert parent.status == ScheduleStatus.QUEUED

    def test_children_not_dispatched_directly(self, db, organisation, user):
        """Children (parent set) are excluded from dispatch — parent handles them."""
        parent = _make_parent(organisation, user, status=ScheduleStatus.SENT)
        _make_child(organisation, user, parent)
        _make_child(organisation, user, parent)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            result = dispatch_due_messages()

        assert result == {'dispatched': 0, 'recovered_queued': 0, 'recovered_processing': 0, 'failed_unknown': 0}
        mock_send.delay.assert_not_called()
        mock_batch.delay.assert_not_called()

    def test_parent_without_children_dispatched_as_individual(self, db, organisation, user):
        """A parent with group set but no children is dispatched via send_message (no Exists match)."""
        parent = _make_parent(organisation, user)
        # No children created — Exists(children) is False, so treated as individual

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            mock_send.delay.return_value = None
            result = dispatch_due_messages()

        assert result == {'dispatched': 1, 'recovered_queued': 0, 'recovered_processing': 0, 'failed_unknown': 0}
        mock_send.delay.assert_called_once_with(parent.pk)
        mock_batch.delay.assert_not_called()

    def test_dispatches_individual_schedules(self, db, organisation, user):
        """Individual schedules (parent=None, group=None) are dispatched via send_message."""
        individual = _make_individual(organisation, user)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            mock_send.delay.return_value = None
            result = dispatch_due_messages()

        assert result == {'dispatched': 1, 'recovered_queued': 0, 'recovered_processing': 0, 'failed_unknown': 0}
        mock_send.delay.assert_called_once_with(individual.pk)
        mock_batch.delay.assert_not_called()
        individual.refresh_from_db()
        assert individual.status == ScheduleStatus.QUEUED

    def test_skips_schedules_of_inactive_orgs(self, db, organisation, user):
        """Schedules belonging to soft-deleted orgs are never dispatched."""
        organisation.is_active = False
        organisation.save()
        _make_individual(organisation, user, text='Orphaned')

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            result = dispatch_due_messages()

        assert result['dispatched'] == 0
        mock_send.delay.assert_not_called()
        mock_batch.delay.assert_not_called()

    def test_holds_schedules_of_past_due_orgs(self, db, organisation, user):
        """Past-due orgs' PENDING schedules wait and resume when billing recovers."""
        organisation.billing_mode = organisation.BILLING_PAST_DUE
        organisation.save()
        schedule = _make_individual(organisation, user, text='Held')

        with patch('app.celery.send_message') as mock_send:
            result = dispatch_due_messages()
        assert result['dispatched'] == 0
        mock_send.delay.assert_not_called()

        # Org recovers → schedule dispatches on the next tick
        organisation.billing_mode = organisation.BILLING_SUBSCRIBED
        organisation.save()
        with patch('app.celery.send_message') as mock_send:
            mock_send.delay.return_value = None
            result = dispatch_due_messages()
        assert result['dispatched'] == 1
        mock_send.delay.assert_called_once_with(schedule.pk)

    def test_ignores_future_schedules(self, db, organisation, user):
        """Parents scheduled in the future are left untouched."""
        future = timezone.now() + timedelta(hours=1)
        parent = _make_parent(organisation, user, scheduled_time=future)
        _make_child(organisation, user, parent, scheduled_time=future)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            result = dispatch_due_messages()

        assert result == {'dispatched': 0, 'recovered_queued': 0, 'recovered_processing': 0, 'failed_unknown': 0}
        mock_send.delay.assert_not_called()
        mock_batch.delay.assert_not_called()

    def test_ignores_non_pending_statuses(self, db, organisation, user):
        """Already-QUEUED, SENT, or FAILED parents are not dispatched again."""
        group = _make_group(organisation, user)
        for status in [ScheduleStatus.QUEUED, ScheduleStatus.SENT, ScheduleStatus.FAILED]:
            p = _make_parent(organisation, user, group=group, status=status)
            _make_child(organisation, user, p)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            result = dispatch_due_messages()

        assert result == {'dispatched': 0, 'recovered_queued': 0, 'recovered_processing': 0, 'failed_unknown': 0}
        mock_send.delay.assert_not_called()
        mock_batch.delay.assert_not_called()

    def test_returns_zero_when_nothing_due(self, db):
        """No due schedules → returns {'dispatched': 0} without touching the DB."""
        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            result = dispatch_due_messages()

        assert result == {'dispatched': 0, 'recovered_queued': 0, 'recovered_processing': 0, 'failed_unknown': 0}
        mock_send.delay.assert_not_called()
        mock_batch.delay.assert_not_called()

    def test_returns_correct_dispatched_count(self, db, organisation, user):
        """Return value counts parents dispatched, not children."""
        parent = _make_parent(organisation, user)
        for _ in range(4):
            _make_child(organisation, user, parent)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            mock_batch.delay.return_value = None
            result = dispatch_due_messages()

        assert result == {'dispatched': 1, 'recovered_queued': 0, 'recovered_processing': 0, 'failed_unknown': 0}
        mock_batch.delay.assert_called_once_with(parent.pk)
        mock_send.delay.assert_not_called()

    def test_dispatches_parents_from_multiple_orgs(self, db, organisation, user):
        """Parents from different orgs are all dispatched (task is not org-scoped)."""
        from tests.factories import OrganisationFactory, UserFactory
        other_org = OrganisationFactory()
        other_user = UserFactory()
        other_parent = _make_parent(other_org, other_user)
        _make_child(other_org, other_user, other_parent)

        parent = _make_parent(organisation, user)
        _make_child(organisation, user, parent)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            mock_batch.delay.return_value = None
            dispatch_due_messages()

        dispatched_pks = {c[0][0] for c in mock_batch.delay.call_args_list}
        assert parent.pk in dispatched_pks
        assert other_parent.pk in dispatched_pks
        mock_send.delay.assert_not_called()


# ---------------------------------------------------------------------------
# Core dispatch EAGER (dispatch -> EXECUTE) tests — schedule reaches SENT/FAILED
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestDispatchDueMessagesEager:
    def test_due_individual_dispatched_and_sent(
        self, db, organisation, user, celery_eager, mock_sms_provider
    ):
        """A due PENDING individual runs send_message synchronously and reaches SENT."""
        individual = _make_individual(organisation, user)

        result = dispatch_due_messages()

        assert result['dispatched'] == 1
        mock_sms_provider.send_sms.assert_called_once()
        individual.refresh_from_db()
        assert individual.status == ScheduleStatus.SENT

    def test_due_batch_parent_dispatched_and_sent(
        self, db, organisation, user, celery_eager, mock_sms_provider
    ):
        """A due PENDING batch parent runs send_batch_message; parent and children reach SENT."""
        parent = _make_parent(organisation, user)
        child_a = _make_child(organisation, user, parent)
        child_b = _make_child(organisation, user, parent)

        result = dispatch_due_messages()

        assert result['dispatched'] == 1
        mock_sms_provider.send_bulk_sms.assert_called_once()
        parent.refresh_from_db()
        child_a.refresh_from_db()
        child_b.refresh_from_db()
        assert parent.status == ScheduleStatus.SENT
        assert child_a.status == ScheduleStatus.SENT
        assert child_b.status == ScheduleStatus.SENT

    def test_due_individual_permanent_failure_marks_failed(
        self, db, organisation, user, celery_eager, mock_sms_provider_permanent_fail
    ):
        """A permanent (non-retryable) provider failure drives the schedule to FAILED."""
        individual = _make_individual(organisation, user)

        dispatch_due_messages()

        individual.refresh_from_db()
        assert individual.status == ScheduleStatus.FAILED
        assert individual.failure_category == 'invalid_number'

    def test_due_individual_transient_failure_exhausts_retries_to_failed(
        self, db, organisation, user, celery_eager, mock_sms_provider_transient_fail
    ):
        """A transient failure retries (eager apply_async runs inline) until max_retries,
        then permanently fails — eager retries don't sleep, so this is finite."""
        individual = _make_individual(organisation, user, max_retries=2)

        dispatch_due_messages()

        individual.refresh_from_db()
        # All attempts failed transiently; after max_retries the schedule is FAILED.
        assert individual.status == ScheduleStatus.FAILED
        assert individual.retry_count == individual.max_retries


# ---------------------------------------------------------------------------
# Batch size cap (routing — 500 real sends would be heavy/non-deterministic)
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestDispatchBatchSize:
    def test_batch_cap_limits_dispatch_to_500(self, db, organisation, user):
        """When >500 individual schedules are due, only 500 are dispatched per tick."""
        # Create 510 individual due schedules (no parent, no children)
        schedules = [
            Schedule(
                organisation=organisation,
                phone='0412345678',
                text='msg',
                scheduled_time=timezone.now() - timedelta(minutes=1),
                status=ScheduleStatus.PENDING,
                format=MessageFormat.SMS,
                message_parts=1,
                max_retries=3,
                created_by=user,
                updated_by=user,
            )
            for _ in range(510)
        ]
        Schedule.objects.bulk_create(schedules)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            mock_send.delay.return_value = None
            result = dispatch_due_messages()

        assert result == {'dispatched': 500, 'recovered_queued': 0, 'recovered_processing': 0, 'failed_unknown': 0}
        assert mock_send.delay.call_count == 500
        mock_batch.delay.assert_not_called()
        # Remaining 10 stay PENDING, picked up next tick
        assert Schedule.objects.filter(
            status=ScheduleStatus.PENDING
        ).count() == 10


# ---------------------------------------------------------------------------
# Overdue RETRYING schedules
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestDispatchRetrying:
    def test_dispatches_overdue_retrying_parent_to_sent(
        self, db, organisation, user, celery_eager, mock_sms_provider
    ):
        """RETRYING parent with next_retry_at <= now is re-sent; parent and child reach SENT."""
        parent = _make_parent(organisation, user, status=ScheduleStatus.RETRYING)
        parent.next_retry_at = timezone.now() - timedelta(minutes=1)
        parent.save(update_fields=['next_retry_at', 'updated_at'])
        child = _make_child(organisation, user, parent, status=ScheduleStatus.QUEUED)

        result = dispatch_due_messages()

        assert result['dispatched'] == 1
        mock_sms_provider.send_bulk_sms.assert_called_once()
        parent.refresh_from_db()
        child.refresh_from_db()
        assert parent.status == ScheduleStatus.SENT
        assert child.status == ScheduleStatus.SENT

    def test_dispatches_overdue_retrying_individual_to_sent(
        self, db, organisation, user, celery_eager, mock_sms_provider
    ):
        """RETRYING individual with next_retry_at <= now is re-sent and reaches SENT."""
        individual = _make_individual(
            organisation, user,
            status=ScheduleStatus.RETRYING,
            scheduled_time=timezone.now() - timedelta(hours=1),
            next_retry_at=timezone.now() - timedelta(minutes=1),
            text='Retry me',
        )

        result = dispatch_due_messages()

        assert result['dispatched'] == 1
        mock_sms_provider.send_sms.assert_called_once()
        individual.refresh_from_db()
        assert individual.status == ScheduleStatus.SENT

    def test_ignores_future_retrying_schedules(self, db, organisation, user):
        """RETRYING parent whose next_retry_at is in the future is left alone."""
        parent = _make_parent(organisation, user, status=ScheduleStatus.RETRYING)
        parent.next_retry_at = timezone.now() + timedelta(hours=1)
        parent.save(update_fields=['next_retry_at', 'updated_at'])
        _make_child(organisation, user, parent, status=ScheduleStatus.QUEUED)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            result = dispatch_due_messages()

        assert result == {'dispatched': 0, 'recovered_queued': 0, 'recovered_processing': 0, 'failed_unknown': 0}
        mock_send.delay.assert_not_called()
        mock_batch.delay.assert_not_called()
        parent.refresh_from_db()
        assert parent.status == ScheduleStatus.RETRYING


# ---------------------------------------------------------------------------
# Stale PROCESSING recovery
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestStaleProcessingRecovery:
    def test_resets_stale_individual_and_sends_via_send_message(
        self, db, organisation, user, celery_eager, mock_sms_provider
    ):
        """Stale individual reset to QUEUED, re-sent via send_message, reaches SENT."""
        individual = _make_individual(
            organisation, user,
            status=ScheduleStatus.PROCESSING,
            scheduled_time=timezone.now() - timedelta(hours=1),
            text='Stale individual',
        )
        Schedule.objects.filter(pk=individual.pk).update(
            updated_at=timezone.now() - timedelta(minutes=15)
        )

        dispatch_due_messages()

        mock_sms_provider.send_sms.assert_called_once()
        individual.refresh_from_db()
        assert individual.status == ScheduleStatus.SENT

    def test_resets_stale_batch_parent_and_sends_via_send_batch_message(
        self, db, organisation, user, celery_eager, mock_sms_provider
    ):
        """Stale batch parent reset to QUEUED, re-sent via send_batch_message;
        parent and child reach SENT."""
        parent = _make_parent(organisation, user, status=ScheduleStatus.PROCESSING)
        child = _make_child(organisation, user, parent, status=ScheduleStatus.PROCESSING)
        # Backdate BOTH parent and child so the stale-PROCESSING recovery resets
        # both to QUEUED — a still-fresh child would be excluded by the batch task
        # (it only loads PENDING/QUEUED/RETRYING children) and nothing would send.
        Schedule.objects.filter(pk__in=[parent.pk, child.pk]).update(
            updated_at=timezone.now() - timedelta(minutes=15)
        )

        dispatch_due_messages()

        mock_sms_provider.send_bulk_sms.assert_called_once()
        parent.refresh_from_db()
        child.refresh_from_db()
        assert parent.status == ScheduleStatus.SENT
        assert child.status == ScheduleStatus.SENT

    def test_resets_stale_batch_children_without_dispatching(self, db, organisation, user):
        """Stale batch children are reset to QUEUED but NOT dispatched (parent handles them)."""
        parent = _make_parent(organisation, user, status=ScheduleStatus.PROCESSING)
        child = _make_child(organisation, user, parent, status=ScheduleStatus.PROCESSING)
        Schedule.objects.filter(pk=child.pk).update(
            updated_at=timezone.now() - timedelta(minutes=15)
        )
        # Parent is NOT stale (recently updated), so only child is stale
        Schedule.objects.filter(pk=parent.pk).update(
            updated_at=timezone.now()
        )

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            dispatch_due_messages()

        # Child is reset but not dispatched
        child.refresh_from_db()
        assert child.status == ScheduleStatus.QUEUED
        # No dispatch for child — only parent would dispatch it
        dispatched_pks = {c[0][0] for c in mock_send.delay.call_args_list}
        assert child.pk not in dispatched_pks
        dispatched_batch_pks = {c[0][0] for c in mock_batch.delay.call_args_list}
        assert child.pk not in dispatched_batch_pks

    def test_unknown_outcome_individual_fails_with_refund_instead_of_resend(
        self, db, organisation, user, celery_eager, mock_sms_provider
    ):
        """A stale PROCESSING send whose provider call may have gone out is failed, not re-sent.

        Regression test: recovery previously re-queued every stale PROCESSING
        schedule, so a worker dying after the provider call meant the recipient
        received the SMS twice. Under eager, the provider must NOT be called.
        """
        organisation.billing_mode = organisation.BILLING_PREPAID
        organisation.credit_balance = Decimal('10.00')
        organisation.save()

        individual = _make_individual(
            organisation, user,
            status=ScheduleStatus.PROCESSING,
            scheduled_time=timezone.now() - timedelta(hours=1),
            text='Maybe sent',
        )
        record_usage(organisation, 1, 'sms', 'dispatch', user, individual)
        Schedule.objects.filter(pk=individual.pk).update(
            updated_at=timezone.now() - timedelta(minutes=15),
            dispatch_attempted_at=timezone.now() - timedelta(minutes=15),
        )

        result = dispatch_due_messages()

        # Never re-sent — duplicate delivery risk.
        mock_sms_provider.send_sms.assert_not_called()
        individual.refresh_from_db()
        assert individual.status == ScheduleStatus.FAILED
        assert individual.failure_category == 'unknown'
        assert 'duplicate' in individual.error
        assert result['failed_unknown'] == 1
        # Prepaid reservation refunded
        organisation.refresh_from_db()
        assert organisation.credit_balance == Decimal('10.00')
        assert CreditTransaction.objects.filter(
            organisation=organisation, schedule=individual,
            transaction_type=CreditTransaction.REFUND,
        ).exists()

    def test_unknown_outcome_batch_parent_fails_children_with_refunds(
        self, db, organisation, user, celery_eager, mock_sms_provider
    ):
        """A stale PROCESSING batch parent with an attempted provider call fails its children too."""
        organisation.billing_mode = organisation.BILLING_PREPAID
        organisation.credit_balance = Decimal('10.00')
        organisation.save()

        parent = _make_parent(organisation, user, status=ScheduleStatus.PROCESSING)
        child = _make_child(organisation, user, parent, status=ScheduleStatus.PROCESSING)
        record_usage(organisation, 1, 'sms', 'dispatch', user, child)
        Schedule.objects.filter(pk=parent.pk).update(
            updated_at=timezone.now() - timedelta(minutes=15),
            dispatch_attempted_at=timezone.now() - timedelta(minutes=15),
        )
        Schedule.objects.filter(pk=child.pk).update(
            updated_at=timezone.now() - timedelta(minutes=15),
        )

        dispatch_due_messages()

        # Never re-sent — duplicate delivery risk.
        mock_sms_provider.send_bulk_sms.assert_not_called()
        parent.refresh_from_db()
        child.refresh_from_db()
        assert parent.status == ScheduleStatus.FAILED
        assert child.status == ScheduleStatus.FAILED
        organisation.refresh_from_db()
        assert organisation.credit_balance == Decimal('10.00')  # child refunded

    def test_leaves_fresh_processing_schedule_alone(self, db, organisation, user):
        """A schedule in PROCESSING updated recently is NOT touched."""
        individual = _make_individual(
            organisation, user,
            status=ScheduleStatus.PROCESSING,
            scheduled_time=timezone.now() - timedelta(hours=1),
            text='Fresh processing',
        )
        # updated_at is set to now() by default — well within the timeout

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            dispatch_due_messages()

        mock_send.delay.assert_not_called()
        mock_batch.delay.assert_not_called()
        individual.refresh_from_db()
        assert individual.status == ScheduleStatus.PROCESSING


# ---------------------------------------------------------------------------
# Stale QUEUED recovery tests
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestStaleQueuedRecovery:
    """Schedules stuck in QUEUED (Celery task lost) are re-dispatched by the beat task."""

    def test_redispatches_stale_queued_individual_to_sent(
        self, db, organisation, user, celery_eager, mock_sms_provider
    ):
        """Stale individual QUEUED schedule is re-sent via send_message and reaches SENT."""
        individual = _make_individual(
            organisation, user,
            status=ScheduleStatus.QUEUED,
            scheduled_time=timezone.now() - timedelta(hours=1),
            text='Stuck queued',
        )
        Schedule.objects.filter(pk=individual.pk).update(
            updated_at=timezone.now() - timedelta(minutes=10)
        )

        dispatch_due_messages()

        mock_sms_provider.send_sms.assert_called_once()
        individual.refresh_from_db()
        assert individual.status == ScheduleStatus.SENT

    def test_redispatches_stale_queued_batch_parent_to_sent(
        self, db, organisation, user, celery_eager, mock_sms_provider
    ):
        """Stale batch parent QUEUED schedule is re-sent via send_batch_message;
        parent and child reach SENT."""
        parent = _make_parent(organisation, user, status=ScheduleStatus.QUEUED)
        child = _make_child(organisation, user, parent, status=ScheduleStatus.QUEUED)
        Schedule.objects.filter(pk=parent.pk).update(
            updated_at=timezone.now() - timedelta(minutes=10)
        )

        dispatch_due_messages()

        mock_sms_provider.send_bulk_sms.assert_called_once()
        parent.refresh_from_db()
        child.refresh_from_db()
        assert parent.status == ScheduleStatus.SENT
        assert child.status == ScheduleStatus.SENT

    def test_stale_queued_children_not_dispatched(self, db, organisation, user):
        """Stale QUEUED children are NOT directly dispatched — parent handles them."""
        parent = _make_parent(organisation, user, status=ScheduleStatus.QUEUED)
        child = _make_child(organisation, user, parent, status=ScheduleStatus.QUEUED)
        # Only child is stale; parent is fresh
        Schedule.objects.filter(pk=child.pk).update(
            updated_at=timezone.now() - timedelta(minutes=10)
        )
        Schedule.objects.filter(pk=parent.pk).update(
            updated_at=timezone.now()
        )

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            dispatch_due_messages()

        dispatched_pks = {c[0][0] for c in mock_send.delay.call_args_list}
        assert child.pk not in dispatched_pks
        dispatched_batch_pks = {c[0][0] for c in mock_batch.delay.call_args_list}
        assert child.pk not in dispatched_batch_pks

    def test_orphaned_queued_child_dispatched_individually(self, db, organisation, user):
        """A stale QUEUED child whose parent is already terminal is sent individually.

        Regression test: such children were stranded forever — the parent's
        batch task only runs for QUEUED/RETRYING parents, so a SENT parent
        never picked them up.
        """
        parent = _make_parent(organisation, user, status=ScheduleStatus.SENT)
        child = _make_child(organisation, user, parent, status=ScheduleStatus.QUEUED)
        Schedule.objects.filter(pk=child.pk).update(
            updated_at=timezone.now() - timedelta(minutes=10)
        )

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            mock_send.delay.return_value = None
            dispatch_due_messages()

        mock_send.delay.assert_called_once_with(child.pk)
        mock_batch.delay.assert_not_called()

    def test_stale_queued_child_of_active_parent_left_for_parent(self, db, organisation, user):
        """A stale QUEUED child whose parent is still active is NOT dispatched individually."""
        parent = _make_parent(organisation, user, status=ScheduleStatus.QUEUED)
        child = _make_child(organisation, user, parent, status=ScheduleStatus.QUEUED)
        Schedule.objects.filter(pk__in=[parent.pk, child.pk]).update(
            updated_at=timezone.now() - timedelta(minutes=10)
        )

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            mock_batch.delay.return_value = None
            dispatch_due_messages()

        dispatched_pks = {c[0][0] for c in mock_send.delay.call_args_list}
        assert child.pk not in dispatched_pks
        mock_batch.delay.assert_called_once_with(parent.pk)

    def test_fresh_queued_not_redispatched(self, db, organisation, user):
        """A QUEUED schedule with recent updated_at is NOT re-dispatched."""
        _make_individual(
            organisation, user,
            status=ScheduleStatus.QUEUED,
            scheduled_time=timezone.now() - timedelta(hours=1),
            text='Fresh queued',
        )
        # updated_at is set to now() by default — well within the timeout

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            dispatch_due_messages()

        mock_send.delay.assert_not_called()
        mock_batch.delay.assert_not_called()

    def test_stale_queued_updated_at_is_bumped(self, db, organisation, user):
        """After re-dispatch, updated_at is bumped so schedule isn't re-dispatched next tick."""
        individual = _make_individual(
            organisation, user,
            status=ScheduleStatus.QUEUED,
            scheduled_time=timezone.now() - timedelta(hours=1),
            text='Stuck queued',
        )
        old_time = timezone.now() - timedelta(minutes=10)
        Schedule.objects.filter(pk=individual.pk).update(updated_at=old_time)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message'):
            mock_send.delay.return_value = None
            dispatch_due_messages()

        individual.refresh_from_db()
        assert individual.updated_at > old_time


# ---------------------------------------------------------------------------
# Worker heartbeat
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestDispatchHeartbeat:
    """Each dispatch_due_messages tick records a liveness heartbeat in Redis.

    Read by /api/health/worker/ to detect a dead/misconfigured worker+beat.
    celery.py imports _get_redis_client at module top, so patch where it is used:
    app.celery._get_redis_client.
    """

    def test_writes_heartbeat_each_tick(self, db):
        """dispatch_due_messages SETs WORKER_HEARTBEAT_KEY on the broker Redis."""
        redis_client = Mock()
        with patch('app.celery._get_redis_client', return_value=redis_client), \
             patch('app.celery.send_message'), \
             patch('app.celery.send_batch_message'):
            dispatch_due_messages()

        redis_client.set.assert_called_once()
        args, kwargs = redis_client.set.call_args
        assert args[0] == settings.WORKER_HEARTBEAT_KEY
        # A TTL is set so a dead worker's stale heartbeat eventually expires.
        assert kwargs.get('ex')

    def test_writes_heartbeat_even_when_nothing_due(self, db):
        """The heartbeat is written before any dispatch work, so an idle tick still beats."""
        redis_client = Mock()
        with patch('app.celery._get_redis_client', return_value=redis_client), \
             patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            result = dispatch_due_messages()

        assert result['dispatched'] == 0
        mock_send.delay.assert_not_called()
        mock_batch.delay.assert_not_called()
        redis_client.set.assert_called_once()

    def test_redis_failure_does_not_break_dispatch(self, db, organisation, user):
        """A Redis blip while writing the heartbeat must never fail dispatch."""
        redis_client = Mock()
        redis_client.set.side_effect = redis.RedisError('redis down')
        individual = _make_individual(organisation, user, text='Heartbeat resilience')

        with patch('app.celery._get_redis_client', return_value=redis_client), \
             patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message'):
            mock_send.delay.return_value = None
            result = dispatch_due_messages()

        # Dispatch still proceeds despite the heartbeat write failing.
        assert result['dispatched'] == 1
        mock_send.delay.assert_called_once_with(individual.pk)
