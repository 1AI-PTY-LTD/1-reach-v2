"""
Tests for GroupSchedule API endpoints (GroupScheduleViewSet).

CRITICAL TESTS for parent/child schedule atomicity:
- Creating group schedule creates parent + children atomically
- Updating parent propagates to PENDING children only
- Cancelling parent cancels PENDING children
- Deleting parent deletes PENDING children
- Multi-tenancy isolation
"""

import pytest
from datetime import timedelta
from django.utils import timezone
from rest_framework import status

from app.models import Schedule, ScheduleStatus
from tests.factories import (
    ContactFactory,
    ContactGroupFactory,
    ContactGroupMemberFactory,
    OrganisationFactory,
    ScheduleFactory,
    create_contact_group_with_members,
)


@pytest.mark.django_db
class TestGroupScheduleList:
    """Tests for GET /api/group-schedules/ endpoint."""

    def test_list_returns_org_group_schedules(self, authenticated_client, organisation, user):
        """List returns only group schedules from user's org."""
        # Group schedules (parent schedules)
        group1 = ContactGroupFactory(organisation=organisation, created_by=user)
        group2 = ContactGroupFactory(organisation=organisation, created_by=user)
        schedule1 = ScheduleFactory(
            organisation=organisation,
            group=group1,
            name='Campaign 1',
            created_by=user
        )
        schedule2 = ScheduleFactory(
            organisation=organisation,
            group=group2,
            name='Campaign 2',
            created_by=user
        )

        # Other org
        other_org = OrganisationFactory()
        other_group = ContactGroupFactory(organisation=other_org)
        ScheduleFactory(organisation=other_org, group=other_group, name='Other')

        response = authenticated_client.get('/api/group-schedules/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 2

    def test_list_only_shows_parent_schedules(self, authenticated_client, organisation, user):
        """List only shows parent schedules (group != None), not children."""
        # Parent with children
        group = ContactGroupFactory(organisation=organisation, created_by=user)
        parent = ScheduleFactory(
            organisation=organisation,
            group=group,
            name='Parent',
            created_by=user
        )
        child1 = ScheduleFactory(
            organisation=organisation,
            parent=parent,
            for_contact=True,
            created_by=user
        )
        child2 = ScheduleFactory(
            organisation=organisation,
            parent=parent,
            for_contact=True,
            created_by=user
        )

        response = authenticated_client.get('/api/group-schedules/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1
        assert response.data['results'][0]['id'] == parent.id


@pytest.mark.django_db
class TestGroupScheduleCreate:
    """Tests for POST /api/group-schedules/ endpoint."""

    def test_create_group_schedule_creates_parent_and_children(
        self, authenticated_client, organisation, user
    ):
        """Creating group schedule creates parent + child schedules atomically."""
        group, contacts = create_contact_group_with_members(organisation, num_members=3, user=user)
        future = timezone.now() + timedelta(hours=1)

        data = {
            'name': 'Marketing Campaign',
            'group_id': group.id,
            'text': 'Hello everyone!',
            'scheduled_time': future.isoformat()
        }

        response = authenticated_client.post('/api/group-schedules/', data)

        assert response.status_code == status.HTTP_201_CREATED
        parent = Schedule.objects.get(id=response.data['id'])

        # Verify parent
        assert parent.group == group
        assert parent.text == 'Hello everyone!'
        assert parent.name == 'Marketing Campaign'

        # Verify children created
        children = Schedule.objects.filter(parent=parent)
        assert children.count() == 3

        for child in children:
            assert child.parent == parent
            assert child.text == 'Hello everyone!'
            assert child.status == ScheduleStatus.PENDING
            assert child.contact in contacts

    def test_create_validates_group_exists(self, authenticated_client):
        """Non-existent group ID rejected."""
        future = timezone.now() + timedelta(hours=1)
        data = {
            'name': 'Test',
            'group_id': 99999,
            'text': 'Test',
            'scheduled_time': future.isoformat()
        }

        response = authenticated_client.post('/api/group-schedules/', data)

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_create_validates_group_org_isolation(self, authenticated_client):
        """Cannot create schedule for group from different org."""
        other_org = OrganisationFactory()
        other_group = ContactGroupFactory(organisation=other_org)
        future = timezone.now() + timedelta(hours=1)

        data = {
            'name': 'Test',
            'group_id': other_group.id,
            'text': 'Test',
            'scheduled_time': future.isoformat()
        }

        response = authenticated_client.post('/api/group-schedules/', data)

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_create_skips_opted_out_contacts(self, authenticated_client, organisation, user):
        """Opted-out contacts excluded from child schedule creation."""
        group, contacts = create_contact_group_with_members(organisation, num_members=5, user=user)

        # Mark 2 contacts as opted out
        contacts[0].opt_out = True
        contacts[0].save()
        contacts[1].opt_out = True
        contacts[1].save()

        future = timezone.now() + timedelta(hours=1)
        data = {
            'name': 'Test',
            'group_id': group.id,
            'text': 'Test',
            'scheduled_time': future.isoformat()
        }

        response = authenticated_client.post('/api/group-schedules/', data)

        assert response.status_code == status.HTTP_201_CREATED

        parent = Schedule.objects.get(id=response.data['id'])
        children = Schedule.objects.filter(parent=parent)

        # Should only create 3 children (5 - 2 opted out)
        assert children.count() == 3


@pytest.mark.django_db
class TestGroupScheduleUpdate:
    """Tests for PUT/PATCH /api/group-schedules/{id}/ endpoint."""

    def test_update_propagates_to_pending_children(self, authenticated_client, organisation, user):
        """Updating parent propagates changes to PENDING children only."""
        group, contacts = create_contact_group_with_members(organisation, num_members=4, user=user)
        parent = ScheduleFactory(
            organisation=organisation,
            group=group,
            text='Original',
            name='Campaign',
            created_by=user
        )

        # Create children with different statuses
        child_pending = ScheduleFactory(
            organisation=organisation,
            parent=parent,
            contact=contacts[0],
            phone=contacts[0].phone,
            text='Original',
            status=ScheduleStatus.PENDING,
            created_by=user
        )
        child_sent = ScheduleFactory(
            organisation=organisation,
            parent=parent,
            contact=contacts[1],
            phone=contacts[1].phone,
            text='Original',
            status=ScheduleStatus.SENT,
            sent=True,
            created_by=user
        )
        child_failed = ScheduleFactory(
            organisation=organisation,
            parent=parent,
            contact=contacts[2],
            phone=contacts[2].phone,
            text='Original',
            status=ScheduleStatus.FAILED,
            failed=True,
            created_by=user
        )

        # Update parent
        future = timezone.now() + timedelta(hours=2)
        data = {
            'name': 'Campaign',
            'group_id': group.id,
            'text': 'Updated message',
            'scheduled_time': future.isoformat()
        }

        response = authenticated_client.put(f'/api/group-schedules/{parent.id}/', data)

        assert response.status_code == status.HTTP_200_OK

        # Verify propagation
        child_pending.refresh_from_db()
        child_sent.refresh_from_db()
        child_failed.refresh_from_db()

        assert child_pending.text == 'Updated message'  # PENDING updated
        assert child_sent.text == 'Original'  # SENT not updated
        assert child_failed.text == 'Original'  # FAILED not updated

    def test_cannot_update_sent_group_schedule(self, authenticated_client, organisation, user):
        """Cannot update group schedule that has been sent."""
        group = ContactGroupFactory(organisation=organisation, created_by=user)
        parent = ScheduleFactory(
            organisation=organisation,
            group=group,
            status=ScheduleStatus.SENT,
            sent=True,
            created_by=user
        )

        data = {'text': 'Updated'}

        response = authenticated_client.patch(f'/api/group-schedules/{parent.id}/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestGroupScheduleCancel:
    """Tests for POST /api/group-schedules/{id}/cancel/ endpoint."""

    def test_cancel_cancels_parent_and_pending_children(
        self, authenticated_client, organisation, user
    ):
        """Cancelling parent cancels parent + PENDING children."""
        group, contacts = create_contact_group_with_members(organisation, num_members=3, user=user)
        parent = ScheduleFactory(
            organisation=organisation,
            group=group,
            status=ScheduleStatus.PENDING,
            created_by=user
        )

        child_pending = ScheduleFactory(
            organisation=organisation,
            parent=parent,
            contact=contacts[0],
            phone=contacts[0].phone,
            status=ScheduleStatus.PENDING,
            created_by=user
        )
        child_sent = ScheduleFactory(
            organisation=organisation,
            parent=parent,
            contact=contacts[1],
            phone=contacts[1].phone,
            status=ScheduleStatus.SENT,
            sent=True,
            created_by=user
        )

        response = authenticated_client.post(f'/api/group-schedules/{parent.id}/cancel/')

        assert response.status_code == status.HTTP_200_OK

        parent.refresh_from_db()
        child_pending.refresh_from_db()
        child_sent.refresh_from_db()

        assert parent.status == ScheduleStatus.CANCELLED
        assert child_pending.status == ScheduleStatus.CANCELLED
        assert child_sent.status == ScheduleStatus.SENT  # SENT not cancelled


@pytest.mark.django_db
class TestGroupScheduleDelete:
    """Tests for DELETE /api/group-schedules/{id}/ endpoint."""

    def test_delete_deletes_parent_and_pending_children(
        self, authenticated_client, organisation, user
    ):
        """Deleting parent deletes parent + PENDING children."""
        group, contacts = create_contact_group_with_members(organisation, num_members=2, user=user)
        parent = ScheduleFactory(
            organisation=organisation,
            group=group,
            status=ScheduleStatus.PENDING,
            created_by=user
        )

        child_pending = ScheduleFactory(
            organisation=organisation,
            parent=parent,
            contact=contacts[0],
            phone=contacts[0].phone,
            status=ScheduleStatus.PENDING,
            created_by=user
        )
        child_sent = ScheduleFactory(
            organisation=organisation,
            parent=parent,
            contact=contacts[1],
            phone=contacts[1].phone,
            status=ScheduleStatus.SENT,
            sent=True,
            created_by=user
        )

        response = authenticated_client.delete(f'/api/group-schedules/{parent.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT

        # Verify deletion (soft delete via status=CANCELLED)
        parent.refresh_from_db()
        child_pending.refresh_from_db()
        child_sent.refresh_from_db()

        assert parent.status == ScheduleStatus.CANCELLED
        assert child_pending.status == ScheduleStatus.CANCELLED
        assert child_sent.status == ScheduleStatus.SENT  # SENT children not cancelled

        # SENT child preserved
        child_sent.refresh_from_db()
        assert child_sent.status == ScheduleStatus.SENT

    def test_delete_enforces_org_isolation(self, authenticated_client):
        """Cannot delete group schedule from different org."""
        other_org = OrganisationFactory()
        other_group = ContactGroupFactory(organisation=other_org)
        schedule = ScheduleFactory(organisation=other_org, group=other_group)

        response = authenticated_client.delete(f'/api/group-schedules/{schedule.id}/')

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestGroupScheduleRetrieve:
    """Tests for GET /api/group-schedules/{id}/ endpoint."""

    def test_retrieve_includes_child_count(self, authenticated_client, organisation, user):
        """Retrieve response includes child schedule statistics."""
        group, contacts = create_contact_group_with_members(organisation, num_members=5, user=user)
        parent = ScheduleFactory(
            organisation=organisation,
            group=group,
            created_by=user
        )

        # Create children with different statuses
        ScheduleFactory(
            organisation=organisation,
            parent=parent,
            contact=contacts[0],
            phone=contacts[0].phone,
            status=ScheduleStatus.PENDING,
            created_by=user
        )
        ScheduleFactory(
            organisation=organisation,
            parent=parent,
            contact=contacts[1],
            phone=contacts[1].phone,
            status=ScheduleStatus.SENT,
            sent=True,
            created_by=user
        )
        ScheduleFactory(
            organisation=organisation,
            parent=parent,
            contact=contacts[2],
            phone=contacts[2].phone,
            status=ScheduleStatus.FAILED,
            failed=True,
            created_by=user
        )

        response = authenticated_client.get(f'/api/group-schedules/{parent.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert 'child_count' in response.data or 'children' in response.data
