"""
Tests for Stats API endpoint (StatsView).

Tests:
- GET /api/stats/monthly/ returns organisation statistics
- Counts schedules by status
- Multi-tenancy isolation
"""

import pytest
from datetime import timedelta
from django.utils import timezone
from rest_framework import status

from app.models import MessageFormat, ScheduleStatus
from tests.factories import (
    ContactFactory,
    ContactGroupFactory,
    OrganisationFactory,
    ScheduleFactory,
)


@pytest.mark.django_db
class TestStatsEndpoint:
    """Tests for GET /api/stats/monthly/ endpoint."""

    def test_stats_returns_monthly_data(self, authenticated_client, organisation, user):
        """Stats returns monthly stats array with billing info."""
        # Create test data
        ScheduleFactory.create_batch(
            10,
            organisation=organisation,
            for_contact=True,
            created_by=user,
            scheduled_time=timezone.now()
        )

        response = authenticated_client.get('/api/stats/monthly/')

        assert response.status_code == status.HTTP_200_OK
        assert 'monthly_stats' in response.data
        assert 'monthly_limit' in response.data
        assert 'total_monthly_spend' in response.data
        assert isinstance(response.data['monthly_stats'], list)

    def test_stats_counts_by_status(self, authenticated_client, organisation, user):
        """Stats breaks down schedules by status within monthly_stats."""
        # Create schedules with different statuses
        ScheduleFactory.create_batch(
            3,
            organisation=organisation,
            status=ScheduleStatus.PENDING,
            for_contact=True,
            created_by=user,
            scheduled_time=timezone.now()
        )
        ScheduleFactory.create_batch(
            5,
            organisation=organisation,
            status=ScheduleStatus.SENT,
            for_contact=True,
            sent=True,
            created_by=user,
            scheduled_time=timezone.now()
        )
        ScheduleFactory.create_batch(
            2,
            organisation=organisation,
            status=ScheduleStatus.FAILED,
            for_contact=True,
            failed=True,
            created_by=user,
            scheduled_time=timezone.now()
        )

        response = authenticated_client.get('/api/stats/monthly/')

        assert response.status_code == status.HTTP_200_OK
        assert 'monthly_stats' in response.data
        # Verify current month has status breakdown
        if response.data['monthly_stats']:
            current_month = response.data['monthly_stats'][0]
            assert 'pending' in current_month
            assert 'errored' in current_month
            assert current_month['pending'] >= 3
            assert current_month['errored'] >= 2

    def test_stats_only_counts_org_data(self, authenticated_client, organisation, user):
        """Stats only counts schedules from user's organisation."""
        # Create schedules in user's org
        ScheduleFactory.create_batch(
            5,
            organisation=organisation,
            created_by=user,
            scheduled_time=timezone.now()
        )

        # Create schedules in other org (should not count)
        other_org = OrganisationFactory()
        ScheduleFactory.create_batch(
            10,
            organisation=other_org,
            scheduled_time=timezone.now()
        )

        response = authenticated_client.get('/api/stats/monthly/')

        assert response.status_code == status.HTTP_200_OK
        # Should only have stats from user's org
        assert 'monthly_stats' in response.data
        # Verify counts reflect only user's org (5 schedules, not 15)
        if response.data['monthly_stats']:
            current_month = response.data['monthly_stats'][0]
            total = current_month.get('pending', 0) + current_month.get('sms_sent', 0) + current_month.get('mms_sent', 0) + current_month.get('errored', 0)
            assert total == 5

    def test_stats_requires_authentication(self, api_client):
        """Unauthenticated requests denied."""
        response = api_client.get('/api/stats/monthly/')
        assert response.status_code in [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN]

    def test_stats_counts_monthly_sms_mms(self, authenticated_client, organisation, user):
        """Stats includes monthly SMS/MMS counts and limits."""
        # Create SMS/MMS this month
        ScheduleFactory.create_batch(
            7,
            organisation=organisation,
            format=MessageFormat.SMS,
            status=ScheduleStatus.SENT,
            scheduled_time=timezone.now(),
            for_contact=True,
            sent=True,
            created_by=user
        )
        ScheduleFactory.create_batch(
            3,
            organisation=organisation,
            format=MessageFormat.MMS,
            status=ScheduleStatus.SENT,
            scheduled_time=timezone.now(),
            for_contact=True,
            sent=True,
            created_by=user
        )

        response = authenticated_client.get('/api/stats/monthly/')

        assert response.status_code == status.HTTP_200_OK
        assert 'monthly_stats' in response.data
        assert 'monthly_limit' in response.data
        assert 'total_monthly_spend' in response.data

        # Verify current month has SMS/MMS breakdown
        if response.data['monthly_stats']:
            current_month = response.data['monthly_stats'][0]
            assert 'sms_sent' in current_month
            assert 'mms_sent' in current_month
            assert current_month['sms_sent'] >= 7
            assert current_month['mms_sent'] >= 3

    def test_stats_excludes_schedules_older_than_12_months(
        self, authenticated_client, organisation, user
    ):
        """Stats only returns data within the last ~12 months (330-day cutoff).

        A schedule with scheduled_time 13 months in the past must not appear in
        monthly_stats, while a schedule from 6 months ago must appear.
        """
        # Schedule 13 months ago — outside the window
        old_time = timezone.now() - timedelta(days=395)
        ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.SENT,
            format=MessageFormat.SMS,
            scheduled_time=old_time,
            for_contact=True,
            sent=True,
            created_by=user,
        )

        # Schedule 6 months ago — within the window
        recent_time = timezone.now() - timedelta(days=180)
        ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.SENT,
            format=MessageFormat.SMS,
            scheduled_time=recent_time,
            for_contact=True,
            sent=True,
            created_by=user,
        )

        response = authenticated_client.get('/api/stats/monthly/')

        assert response.status_code == status.HTTP_200_OK

        # Count total sms_sent across all months returned
        total_sms = sum(
            m.get('sms_sent', 0) for m in response.data['monthly_stats']
        )
        # Only the recent schedule should be counted — the old one must be excluded
        assert total_sms == 1
