"""
Table-driven tests for _sync_parent_status (backend/app/celery.py).

_sync_parent_status(child) rolls a batch parent's status up from the set of
its children's statuses. The rollup rules (mirrored exactly from the source):

    terminal = {SENT, DELIVERED, FAILED, CANCELLED}

    - no children            -> parent unchanged
    - all children terminal:
        - only CANCELLED            -> CANCELLED
        - any FAILED present        -> FAILED
        - only DELIVERED            -> DELIVERED
        - only DELIVERED+CANCELLED  -> DELIVERED
        - otherwise                 -> SENT
    - any non-terminal child -> PROCESSING

Each case seeds a parent + children with the given statuses, calls
_sync_parent_status directly on one child, and asserts the exact parent status.
"""

from datetime import timedelta

import pytest
from django.utils import timezone

from app.models import MessageFormat, Schedule, ScheduleStatus
from app.celery import _sync_parent_status


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_parent(organisation, user, status=ScheduleStatus.PROCESSING):
    """Create a batch parent schedule (no parent FK, no children yet)."""
    return Schedule.objects.create(
        organisation=organisation,
        name='Batch Campaign',
        text='Hello batch',
        scheduled_time=timezone.now() - timedelta(minutes=5),
        status=status,
        format=MessageFormat.SMS,
        message_parts=1,
        created_by=user,
        updated_by=user,
    )


def _make_child(organisation, user, parent, status):
    """Create a leaf child schedule with the given status."""
    return Schedule.objects.create(
        organisation=organisation,
        parent=parent,
        phone='0412345678',
        text='Hello batch',
        scheduled_time=timezone.now() - timedelta(minutes=5),
        status=status,
        format=MessageFormat.SMS,
        message_parts=1,
        max_retries=3,
        created_by=user,
        updated_by=user,
    )


# (child_statuses, expected_parent_status)
ROLLUP_CASES = [
    pytest.param(
        [ScheduleStatus.SENT, ScheduleStatus.SENT, ScheduleStatus.SENT],
        ScheduleStatus.SENT,
        id='all-sent',
    ),
    pytest.param(
        [ScheduleStatus.DELIVERED, ScheduleStatus.DELIVERED, ScheduleStatus.DELIVERED],
        ScheduleStatus.DELIVERED,
        id='all-delivered',
    ),
    pytest.param(
        [ScheduleStatus.DELIVERED, ScheduleStatus.CANCELLED, ScheduleStatus.DELIVERED],
        ScheduleStatus.DELIVERED,
        id='mixed-delivered-and-cancelled',
    ),
    pytest.param(
        [ScheduleStatus.SENT, ScheduleStatus.DELIVERED, ScheduleStatus.FAILED],
        ScheduleStatus.FAILED,
        id='any-failed-present',
    ),
    pytest.param(
        [ScheduleStatus.FAILED, ScheduleStatus.CANCELLED, ScheduleStatus.DELIVERED],
        ScheduleStatus.FAILED,
        id='failed-wins-over-delivered-and-cancelled',
    ),
    pytest.param(
        [ScheduleStatus.CANCELLED, ScheduleStatus.CANCELLED, ScheduleStatus.CANCELLED],
        ScheduleStatus.CANCELLED,
        id='all-cancelled',
    ),
    pytest.param(
        [ScheduleStatus.SENT, ScheduleStatus.CANCELLED],
        ScheduleStatus.SENT,
        id='sent-plus-cancelled-rolls-to-sent',
    ),
    pytest.param(
        [ScheduleStatus.QUEUED, ScheduleStatus.SENT],
        ScheduleStatus.PROCESSING,
        id='some-queued-some-sent-is-processing',
    ),
    pytest.param(
        [ScheduleStatus.PENDING, ScheduleStatus.DELIVERED],
        ScheduleStatus.PROCESSING,
        id='non-terminal-pending-is-processing',
    ),
    pytest.param(
        [ScheduleStatus.RETRYING, ScheduleStatus.FAILED],
        ScheduleStatus.PROCESSING,
        id='non-terminal-retrying-overrides-failed',
    ),
]


@pytest.mark.django_db
class TestSyncParentStatusRollup:
    @pytest.mark.parametrize('child_statuses, expected', ROLLUP_CASES)
    def test_rollup(self, organisation, user, child_statuses, expected):
        parent = _make_parent(organisation, user)
        children = [
            _make_child(organisation, user, parent, status)
            for status in child_statuses
        ]

        # Call directly on one child, as the production code does.
        _sync_parent_status(children[0])

        parent.refresh_from_db()
        assert parent.status == expected

    def test_empty_children_leaves_parent_unchanged(self, organisation, user):
        """With no child rows, the parent status must not be touched."""
        parent = _make_parent(organisation, user, status=ScheduleStatus.PROCESSING)
        # Anchor a child so the in-memory object resolves parent, then remove
        # all child rows so the rollup sees an empty children set.
        child = _make_child(organisation, user, parent, ScheduleStatus.SENT)
        Schedule.objects.filter(parent=parent).delete()
        assert not Schedule.objects.filter(parent=parent).exists()

        _sync_parent_status(child)

        parent.refresh_from_db()
        assert parent.status == ScheduleStatus.PROCESSING

    def test_no_parent_is_noop(self, organisation, user):
        """A schedule with no parent FK is a no-op (must not raise)."""
        orphan = _make_parent(organisation, user, status=ScheduleStatus.SENT)
        assert orphan.parent is None

        _sync_parent_status(orphan)

        orphan.refresh_from_db()
        assert orphan.status == ScheduleStatus.SENT
