"""
Tests for the TEST-only force-status action on ScheduleViewSet.

PATCH /api/schedules/{id}/force-status/ sets a schedule's status directly. It is
an E2E test affordance ONLY and must be unreachable when settings.TEST is false.

These tests pin both halves of that gate:
- Under @override_settings(TEST=False): the action returns 403 'Not available.'
  and mutates nothing.
- Positive control under TEST=1 (the suite's normal mode): the action succeeds
  and changes the stored status.

NOTE: settings.TEST is NEVER assigned directly — authenticated_client monkey-
patches APIView.dispatch, so override_settings (decorator/context manager) is the
only safe way to flip the flag without leaking state across tests.
"""

import pytest
from django.test import override_settings
from django.utils import timezone

from rest_framework import status

from app.models import MessageFormat, Schedule, ScheduleStatus


def _make_schedule(organisation, user, contact, schedule_status=ScheduleStatus.PENDING):
    return Schedule.objects.create(
        organisation=organisation,
        contact=contact,
        phone='0412345678',
        text='Force status target',
        scheduled_time=timezone.now(),
        status=schedule_status,
        format=MessageFormat.SMS,
        message_parts=1,
        created_by=user,
        updated_by=user,
    )


@pytest.mark.django_db
class TestForceStatusGated:
    """force-status is blocked outside TEST mode and works inside it."""

    @override_settings(TEST=False)
    def test_returns_403_and_mutates_nothing_outside_test_mode(
        self, authenticated_client, organisation, user, contact,
    ):
        sched = _make_schedule(organisation, user, contact, ScheduleStatus.PENDING)

        response = authenticated_client.patch(
            f'/api/schedules/{sched.pk}/force-status/',
            {'status': ScheduleStatus.SENT},
            format='json',
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert response.data['detail'] == 'Not available.'
        sched.refresh_from_db()
        assert sched.status == ScheduleStatus.PENDING

    def test_sets_status_in_test_mode(
        self, authenticated_client, organisation, user, contact,
    ):
        """Positive control: under TEST=1 the status is updated as requested."""
        sched = _make_schedule(organisation, user, contact, ScheduleStatus.PENDING)

        response = authenticated_client.patch(
            f'/api/schedules/{sched.pk}/force-status/',
            {'status': ScheduleStatus.SENT},
            format='json',
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['status'] == ScheduleStatus.SENT
        sched.refresh_from_db()
        assert sched.status == ScheduleStatus.SENT
