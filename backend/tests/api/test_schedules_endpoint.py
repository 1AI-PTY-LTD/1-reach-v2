"""
Tests for Schedule API endpoints (ScheduleViewSet).

Tests:
- CRUD operations (individual schedules only, not groups)
- Multi-tenancy isolation
- Date filtering
- Status filtering
"""

import pytest
from datetime import timedelta
from django.utils import timezone
from rest_framework import status

from app.models import Schedule, ScheduleStatus
from tests.factories import (
    ContactFactory,
    OrganisationFactory,
    ScheduleFactory,
)


@pytest.mark.django_db
class TestScheduleList:
    """Tests for GET /api/schedules/ endpoint."""

    def test_list_returns_org_schedules(self, authenticated_client, organisation, user):
        """List returns only schedules from user's organisation."""
        schedule1 = ScheduleFactory(organisation=organisation, for_contact=True, created_by=user)
        schedule2 = ScheduleFactory(organisation=organisation, for_contact=True, created_by=user)

        # Other org schedule
        other_org = OrganisationFactory()
        ScheduleFactory(organisation=other_org, for_contact=True)

        response = authenticated_client.get('/api/schedules/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 2

    def test_list_excludes_children(self, authenticated_client, organisation, user):
        """List excludes child schedules (parent != None)."""
        # Parent schedule
        parent = ScheduleFactory(organisation=organisation, for_group=True, created_by=user)

        # Child schedules
        ScheduleFactory(organisation=organisation, parent=parent, for_contact=True, created_by=user)
        ScheduleFactory(organisation=organisation, parent=parent, for_contact=True, created_by=user)

        response = authenticated_client.get('/api/schedules/')

        # Should only return standalone schedules, not children
        assert response.data['pagination']['total'] == 0  # Parent is a group schedule, filtered elsewhere

    def test_list_filter_by_date_from(self, authenticated_client, organisation, user):
        """date_from filters schedules."""
        now = timezone.now()
        schedule1 = ScheduleFactory(
            organisation=organisation,
            scheduled_time=now,
            for_contact=True,
            created_by=user
        )
        schedule2 = ScheduleFactory(
            organisation=organisation,
            scheduled_time=now + timedelta(days=2),
            for_contact=True,
            created_by=user
        )

        date_filter = (now + timedelta(days=1)).date().isoformat()
        response = authenticated_client.get(f'/api/schedules/?date_from={date_filter}')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1

    def test_cancelled_schedule_appears_in_list(self, authenticated_client, organisation, user):
        """Cancelled schedules remain visible in the list."""
        ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.CANCELLED,
            for_contact=True,
            created_by=user
        )

        response = authenticated_client.get('/api/schedules/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1
        assert response.data['results'][0]['status'] == ScheduleStatus.CANCELLED

    def test_delete_schedule_remains_in_list_as_cancelled(self, authenticated_client, organisation, user):
        """After deleting a pending schedule, it still appears in list with cancelled status."""
        schedule = ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.PENDING,
            for_contact=True,
            created_by=user
        )

        # Delete (soft-cancel) the schedule
        delete_response = authenticated_client.delete(f'/api/schedules/{schedule.id}/')
        assert delete_response.status_code == status.HTTP_204_NO_CONTENT

        # It should still appear in the list
        list_response = authenticated_client.get('/api/schedules/')
        assert list_response.status_code == status.HTTP_200_OK
        assert list_response.data['pagination']['total'] == 1
        assert list_response.data['results'][0]['status'] == ScheduleStatus.CANCELLED

    def test_list_filter_by_status(self, authenticated_client, organisation, user):
        """Status filter works."""
        schedule1 = ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.PENDING,
            for_contact=True,
            created_by=user
        )
        schedule2 = ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.SENT,
            for_contact=True,
            created_by=user
        )

        response = authenticated_client.get(f'/api/schedules/?status={ScheduleStatus.SENT}')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1


@pytest.mark.django_db
class TestScheduleCreate:
    """Tests for POST /api/schedules/ endpoint."""

    def test_create_schedule(self, authenticated_client, organisation, user):
        """Creating schedule succeeds."""
        contact = ContactFactory(organisation=organisation, created_by=user)
        future = timezone.now() + timedelta(hours=1)

        data = {
            'contact_id': contact.id,
            'text': 'Test message',
            'scheduled_time': future.isoformat()
        }

        response = authenticated_client.post('/api/schedules/', data)

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['text'] == 'Test message'

    def test_create_validates_scheduled_time_future(self, authenticated_client, user):
        """Scheduled time must be in future."""
        past = timezone.now() - timedelta(hours=1)

        data = {
            'text': 'Test',
            'phone': '0412345678',
            'scheduled_time': past.isoformat()
        }

        response = authenticated_client.post('/api/schedules/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestScheduleRetrieve:
    """Tests for GET /api/schedules/{id}/ endpoint."""

    def test_retrieve_schedule(self, authenticated_client, organisation, user):
        """Retrieving schedule succeeds."""
        schedule = ScheduleFactory(organisation=organisation, for_contact=True, created_by=user)

        response = authenticated_client.get(f'/api/schedules/{schedule.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['id'] == schedule.id

    def test_retrieve_enforces_org_isolation(self, authenticated_client):
        """Cannot retrieve schedule from different org."""
        other_org = OrganisationFactory()
        schedule = ScheduleFactory(organisation=other_org, for_contact=True)

        response = authenticated_client.get(f'/api/schedules/{schedule.id}/')

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestScheduleUpdate:
    """Tests for PUT/PATCH /api/schedules/{id}/ endpoint."""

    def test_update_pending_schedule(self, authenticated_client, organisation, user):
        """Updating pending schedule succeeds."""
        future = timezone.now() + timedelta(hours=2)
        schedule = ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.PENDING,
            for_contact=True,
            created_by=user
        )

        data = {
            'text': 'Updated text',
            'phone': schedule.phone,
            'scheduled_time': future.isoformat()
        }

        response = authenticated_client.put(f'/api/schedules/{schedule.id}/', data)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['text'] == 'Updated text'

    def test_cannot_update_sent_schedule(self, authenticated_client, organisation, user):
        """Cannot update sent schedule."""
        schedule = ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.SENT,
            sent=True,
            for_contact=True,
            created_by=user
        )

        data = {'text': 'Updated'}

        response = authenticated_client.patch(f'/api/schedules/{schedule.id}/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestScheduleDelete:
    """Tests for DELETE /api/schedules/{id}/ endpoint."""

    def test_delete_pending_schedule(self, authenticated_client, organisation, user):
        """Deleting pending schedule succeeds."""
        schedule = ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.PENDING,
            for_contact=True,
            created_by=user
        )

        response = authenticated_client.delete(f'/api/schedules/{schedule.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT

    def test_delete_sets_status_to_cancelled(self, authenticated_client, organisation, user):
        """Deleting a pending schedule sets its status to cancelled."""
        schedule = ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.PENDING,
            for_contact=True,
            created_by=user
        )

        response = authenticated_client.delete(f'/api/schedules/{schedule.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        schedule.refresh_from_db()
        assert schedule.status == ScheduleStatus.CANCELLED

    def test_cannot_delete_sent_schedule(self, authenticated_client, organisation, user):
        """Cannot delete sent schedule."""
        schedule = ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.SENT,
            sent=True,
            for_contact=True,
            created_by=user
        )

        response = authenticated_client.delete(f'/api/schedules/{schedule.id}/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
