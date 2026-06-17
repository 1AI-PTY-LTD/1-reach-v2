"""Load/perf PILOT for the dispatch pipeline (non-gating).

Excluded from the default suite via the ``load`` marker (see pytest.ini). Run with:

    docker compose run --rm -e CONTAINER_ROLE= backend uv run python -m pytest -m load tests/load/ -q

The functional tests prove correctness for 1 message / a 3-recipient group;
this pilot exercises the dispatcher at bulk scale (queueing throughput, batch
size handling) so a regression that only shows under load is visible. It asserts
a generous wall-clock bound rather than a tight benchmark — tune as a baseline.
"""

import time
from datetime import timedelta

import pytest
from django.utils import timezone

from app.celery import dispatch_due_messages
from app.models import MessageFormat, Schedule, ScheduleStatus


@pytest.mark.load
@pytest.mark.django_db
def test_dispatch_bulk_throughput(organisation, user, mock_sms_provider):
    """Queue a large batch of due individual schedules and dispatch them.

    dispatch_due_messages processes in batches of 500/tick; this seeds well past
    one batch and confirms it queues without error within a generous bound.
    """
    N = 1500
    now = timezone.now()
    Schedule.objects.bulk_create([
        Schedule(
            organisation=organisation,
            phone='0412345678',
            text=f'load {i}',
            scheduled_time=now - timedelta(minutes=5),
            status=ScheduleStatus.PENDING,
            format=MessageFormat.SMS,
            message_parts=1,
            created_by=user,
            updated_by=user,
        )
        for i in range(N)
    ])

    start = time.perf_counter()
    total_dispatched = 0
    # Drain in ticks (batch_size=500) — a few ticks cover N.
    for _ in range(10):
        result = dispatch_due_messages()
        total_dispatched += result['dispatched']
        if result['dispatched'] == 0:
            break
    elapsed = time.perf_counter() - start

    assert total_dispatched == N
    assert Schedule.objects.filter(status=ScheduleStatus.QUEUED).count() == N
    # Generous baseline bound — flag a gross regression, not micro-perf.
    assert elapsed < 30, f'bulk dispatch took {elapsed:.1f}s for {N} schedules'
