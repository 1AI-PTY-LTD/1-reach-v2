"""
Tests for the dispatch_due_messages Celery beat task.

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
from unittest.mock import patch

import pytest
from django.utils import timezone

from app.models import ContactGroup, MessageFormat, Schedule, ScheduleStatus
from app.celery import dispatch_due_messages


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


# ---------------------------------------------------------------------------
# Core dispatch tests
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

        assert result == {'dispatched': 1}
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

        assert result == {'dispatched': 0}
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

        assert result == {'dispatched': 1}
        mock_send.delay.assert_called_once_with(parent.pk)
        mock_batch.delay.assert_not_called()

    def test_dispatches_individual_schedules(self, db, organisation, user):
        """Individual schedules (parent=None, group=None) are dispatched via send_message."""
        individual = Schedule.objects.create(
            organisation=organisation,
            phone='0412345678',
            text='Individual message',
            scheduled_time=timezone.now() - timedelta(minutes=5),
            status=ScheduleStatus.PENDING,
            format=MessageFormat.SMS,
            message_parts=1,
            max_retries=3,
            created_by=user,
            updated_by=user,
        )

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            mock_send.delay.return_value = None
            result = dispatch_due_messages()

        assert result == {'dispatched': 1}
        mock_send.delay.assert_called_once_with(individual.pk)
        mock_batch.delay.assert_not_called()
        individual.refresh_from_db()
        assert individual.status == ScheduleStatus.QUEUED

    def test_ignores_future_schedules(self, db, organisation, user):
        """Parents scheduled in the future are left untouched."""
        future = timezone.now() + timedelta(hours=1)
        parent = _make_parent(organisation, user, scheduled_time=future)
        _make_child(organisation, user, parent, scheduled_time=future)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            result = dispatch_due_messages()

        assert result == {'dispatched': 0}
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

        assert result == {'dispatched': 0}
        mock_send.delay.assert_not_called()
        mock_batch.delay.assert_not_called()

    def test_returns_zero_when_nothing_due(self, db):
        """No due schedules → returns {'dispatched': 0} without touching the DB."""
        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            result = dispatch_due_messages()

        assert result == {'dispatched': 0}
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

        assert result == {'dispatched': 1}
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
# Batch size cap
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

        assert result == {'dispatched': 500}
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
    def test_dispatches_overdue_retrying_parent(self, db, organisation, user):
        """RETRYING parent with next_retry_at <= now is re-dispatched via send_batch_message."""
        parent = _make_parent(organisation, user, status=ScheduleStatus.RETRYING)
        parent.next_retry_at = timezone.now() - timedelta(minutes=1)
        parent.save(update_fields=['next_retry_at', 'updated_at'])
        _make_child(organisation, user, parent, status=ScheduleStatus.QUEUED)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            mock_batch.delay.return_value = None
            result = dispatch_due_messages()

        assert result == {'dispatched': 1}
        mock_batch.delay.assert_called_once_with(parent.pk)
        mock_send.delay.assert_not_called()
        parent.refresh_from_db()
        assert parent.status == ScheduleStatus.QUEUED

    def test_dispatches_overdue_retrying_individual(self, db, organisation, user):
        """RETRYING individual schedule with next_retry_at <= now is re-dispatched via send_message."""
        individual = Schedule.objects.create(
            organisation=organisation,
            phone='0412345678',
            text='Retry me',
            scheduled_time=timezone.now() - timedelta(hours=1),
            status=ScheduleStatus.RETRYING,
            next_retry_at=timezone.now() - timedelta(minutes=1),
            format=MessageFormat.SMS,
            message_parts=1,
            max_retries=3,
            created_by=user,
            updated_by=user,
        )

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            mock_send.delay.return_value = None
            result = dispatch_due_messages()

        assert result == {'dispatched': 1}
        mock_send.delay.assert_called_once_with(individual.pk)
        mock_batch.delay.assert_not_called()
        individual.refresh_from_db()
        assert individual.status == ScheduleStatus.QUEUED

    def test_ignores_future_retrying_schedules(self, db, organisation, user):
        """RETRYING parent whose next_retry_at is in the future is left alone."""
        parent = _make_parent(organisation, user, status=ScheduleStatus.RETRYING)
        parent.next_retry_at = timezone.now() + timedelta(hours=1)
        parent.save(update_fields=['next_retry_at', 'updated_at'])
        _make_child(organisation, user, parent, status=ScheduleStatus.QUEUED)

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            result = dispatch_due_messages()

        assert result == {'dispatched': 0}
        mock_send.delay.assert_not_called()
        mock_batch.delay.assert_not_called()
        parent.refresh_from_db()
        assert parent.status == ScheduleStatus.RETRYING


# ---------------------------------------------------------------------------
# Stale PROCESSING recovery
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestStaleProcessingRecovery:
    def test_resets_stale_individual_and_dispatches_via_send_message(self, db, organisation, user):
        """Stale individual send reset to QUEUED and dispatched via send_message."""
        individual = Schedule.objects.create(
            organisation=organisation,
            phone='0412345678',
            text='Stale individual',
            scheduled_time=timezone.now() - timedelta(hours=1),
            status=ScheduleStatus.PROCESSING,
            format=MessageFormat.SMS,
            message_parts=1,
            max_retries=3,
            created_by=user,
            updated_by=user,
        )
        Schedule.objects.filter(pk=individual.pk).update(
            updated_at=timezone.now() - timedelta(minutes=15)
        )

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            mock_send.delay.return_value = None
            dispatch_due_messages()

        mock_send.delay.assert_called_once_with(individual.pk)
        mock_batch.delay.assert_not_called()
        individual.refresh_from_db()
        assert individual.status == ScheduleStatus.QUEUED

    def test_resets_stale_batch_parent_and_dispatches_via_send_batch_message(self, db, organisation, user):
        """Stale batch parent reset to QUEUED and dispatched via send_batch_message."""
        parent = _make_parent(organisation, user, status=ScheduleStatus.PROCESSING)
        _make_child(organisation, user, parent, status=ScheduleStatus.PROCESSING)
        Schedule.objects.filter(pk=parent.pk).update(
            updated_at=timezone.now() - timedelta(minutes=15)
        )

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            mock_batch.delay.return_value = None
            dispatch_due_messages()

        mock_batch.delay.assert_called_once_with(parent.pk)
        mock_send.delay.assert_not_called()
        parent.refresh_from_db()
        assert parent.status == ScheduleStatus.QUEUED

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

    def test_leaves_fresh_processing_schedule_alone(self, db, organisation, user):
        """A schedule in PROCESSING updated recently is NOT touched."""
        individual = Schedule.objects.create(
            organisation=organisation,
            phone='0412345678',
            text='Fresh processing',
            scheduled_time=timezone.now() - timedelta(hours=1),
            status=ScheduleStatus.PROCESSING,
            format=MessageFormat.SMS,
            message_parts=1,
            max_retries=3,
            created_by=user,
            updated_by=user,
        )
        # updated_at is set to now() by default — well within the timeout

        with patch('app.celery.send_message') as mock_send, \
             patch('app.celery.send_batch_message') as mock_batch:
            dispatch_due_messages()

        mock_send.delay.assert_not_called()
        mock_batch.delay.assert_not_called()
        individual.refresh_from_db()
        assert individual.status == ScheduleStatus.PROCESSING
