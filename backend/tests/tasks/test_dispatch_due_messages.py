"""
Tests for the dispatch_due_messages Celery beat task.

Verifies that PENDING leaf schedules whose scheduled_time <= now are
transitioned to QUEUED and handed off to send_message.delay(), while
parent schedules, future schedules, non-PENDING schedules, and empty
states are all handled correctly.
"""

from datetime import timedelta
from unittest.mock import call, patch

import pytest
from django.utils import timezone

from app.models import MessageFormat, Schedule, ScheduleStatus
from app.celery import dispatch_due_messages


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_parent(organisation, user, scheduled_time=None):
    """Create a group-parent schedule (no parent FK)."""
    return Schedule.objects.create(
        organisation=organisation,
        name='Group campaign',
        text='Group message',
        scheduled_time=scheduled_time or timezone.now() - timedelta(minutes=5),
        status=ScheduleStatus.PENDING,
        format=MessageFormat.SMS,
        message_parts=1,
        created_by=user,
        updated_by=user,
    )


def _make_child(organisation, user, parent, scheduled_time=None, status=ScheduleStatus.PENDING):
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
    def test_dispatches_pending_leaf_schedules(self, db, organisation, user):
        """PENDING children with scheduled_time <= now get QUEUED and dispatched."""
        parent = _make_parent(organisation, user)
        child1 = _make_child(organisation, user, parent)
        child2 = _make_child(organisation, user, parent)

        with patch('app.celery.send_message') as mock_task:
            mock_task.delay.return_value = None
            result = dispatch_due_messages()

        assert result == {'dispatched': 2}
        assert mock_task.delay.call_count == 2
        dispatched_pks = {c[0][0] for c in mock_task.delay.call_args_list}
        assert dispatched_pks == {child1.pk, child2.pk}

        child1.refresh_from_db()
        child2.refresh_from_db()
        assert child1.status == ScheduleStatus.QUEUED
        assert child2.status == ScheduleStatus.QUEUED

    def test_ignores_parent_schedules(self, db, organisation, user):
        """Group-parent schedules (parent=None) are never dispatched directly."""
        _make_parent(organisation, user)  # parent only, no children

        with patch('app.celery.send_message') as mock_task:
            result = dispatch_due_messages()

        assert result == {'dispatched': 0}
        mock_task.delay.assert_not_called()

    def test_ignores_future_schedules(self, db, organisation, user):
        """Children scheduled in the future are left untouched."""
        parent = _make_parent(organisation, user)
        future = timezone.now() + timedelta(hours=1)
        child = _make_child(organisation, user, parent, scheduled_time=future)

        with patch('app.celery.send_message') as mock_task:
            result = dispatch_due_messages()

        assert result == {'dispatched': 0}
        mock_task.delay.assert_not_called()
        child.refresh_from_db()
        assert child.status == ScheduleStatus.PENDING

    def test_ignores_non_pending_statuses(self, db, organisation, user):
        """Already-QUEUED, SENT, or FAILED children are not dispatched again."""
        parent = _make_parent(organisation, user)
        _make_child(organisation, user, parent, status=ScheduleStatus.QUEUED)
        _make_child(organisation, user, parent, status=ScheduleStatus.SENT)
        _make_child(organisation, user, parent, status=ScheduleStatus.FAILED)

        with patch('app.celery.send_message') as mock_task:
            result = dispatch_due_messages()

        assert result == {'dispatched': 0}
        mock_task.delay.assert_not_called()

    def test_returns_zero_when_nothing_due(self, db):
        """No due schedules → returns {'dispatched': 0} without touching the DB."""
        with patch('app.celery.send_message') as mock_task:
            result = dispatch_due_messages()

        assert result == {'dispatched': 0}
        mock_task.delay.assert_not_called()

    def test_returns_correct_dispatched_count(self, db, organisation, user):
        """Return value matches the number of schedules actually dispatched."""
        parent = _make_parent(organisation, user)
        for _ in range(4):
            _make_child(organisation, user, parent)

        with patch('app.celery.send_message') as mock_task:
            mock_task.delay.return_value = None
            result = dispatch_due_messages()

        assert result == {'dispatched': 4}
        assert mock_task.delay.call_count == 4

    def test_does_not_dispatch_children_of_different_org(self, db, organisation, user):
        """Only dispatches schedules for the relevant org (multi-tenancy guard)."""
        from tests.factories import OrganisationFactory, UserFactory
        other_org = OrganisationFactory()
        other_user = UserFactory()
        other_parent = _make_parent(other_org, other_user)
        other_child = _make_child(other_org, other_user, other_parent)

        parent = _make_parent(organisation, user)
        own_child = _make_child(organisation, user, parent)

        with patch('app.celery.send_message') as mock_task:
            mock_task.delay.return_value = None
            dispatch_due_messages()

        dispatched_pks = {c[0][0] for c in mock_task.delay.call_args_list}
        # Both orgs' due children are dispatched (task is not org-scoped)
        assert own_child.pk in dispatched_pks
        assert other_child.pk in dispatched_pks


# ---------------------------------------------------------------------------
# Batch size cap
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestDispatchBatchSize:
    def test_batch_cap_limits_dispatch_to_500(self, db, organisation, user):
        """When >500 schedules are due, only 500 are dispatched per tick."""
        parent = _make_parent(organisation, user)
        # Create 510 due children in bulk for speed
        children = [
            Schedule(
                organisation=organisation,
                parent=parent,
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
        Schedule.objects.bulk_create(children)

        with patch('app.celery.send_message') as mock_task:
            mock_task.delay.return_value = None
            result = dispatch_due_messages()

        assert result == {'dispatched': 500}
        assert mock_task.delay.call_count == 500
        # Remaining 10 stay PENDING, picked up next tick
        assert Schedule.objects.filter(
            parent=parent, status=ScheduleStatus.PENDING
        ).count() == 10
