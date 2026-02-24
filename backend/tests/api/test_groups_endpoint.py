"""
Tests for ContactGroup API endpoints (ContactGroupViewSet).

Tests:
- CRUD operations
- Multi-tenancy isolation
- Member management
"""

import pytest
from rest_framework import status

from app.models import ContactGroup, ContactGroupMember
from tests.factories import (
    ContactFactory,
    ContactGroupFactory,
    ContactGroupMemberFactory,
    OrganisationFactory,
)


@pytest.mark.django_db
class TestContactGroupList:
    """Tests for GET /api/groups/ endpoint."""

    def test_list_returns_org_groups(self, authenticated_client, organisation, user):
        """List returns only groups from user's organisation."""
        group1 = ContactGroupFactory(organisation=organisation, created_by=user)
        group2 = ContactGroupFactory(organisation=organisation, created_by=user)

        # Other org group
        other_org = OrganisationFactory()
        ContactGroupFactory(organisation=other_org)

        response = authenticated_client.get('/api/groups/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 2

    def test_list_search(self, authenticated_client, organisation, user):
        """Search filters groups by name."""
        group1 = ContactGroupFactory(organisation=organisation, name='VIP Clients', created_by=user)
        group2 = ContactGroupFactory(organisation=organisation, name='Regular', created_by=user)

        response = authenticated_client.get('/api/groups/?search=VIP')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1
        assert response.data['results'][0]['name'] == 'VIP Clients'


@pytest.mark.django_db
class TestContactGroupCreate:
    """Tests for POST /api/groups/ endpoint."""

    def test_create_group(self, authenticated_client, organisation):
        """Creating group succeeds."""
        data = {
            'name': 'New Group',
            'description': 'Test group'
        }

        response = authenticated_client.post('/api/groups/', data)

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['name'] == 'New Group'

        group = ContactGroup.objects.get(id=response.data['id'])
        assert group.organisation == organisation

    def test_create_validates_name(self, authenticated_client):
        """Name is required."""
        data = {'description': 'Test'}

        response = authenticated_client.post('/api/groups/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'name' in response.data


@pytest.mark.django_db
class TestContactGroupRetrieve:
    """Tests for GET /api/groups/{id}/ endpoint."""

    def test_retrieve_group(self, authenticated_client, organisation, user):
        """Retrieving group succeeds."""
        group = ContactGroupFactory(organisation=organisation, created_by=user)

        response = authenticated_client.get(f'/api/groups/{group.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['id'] == group.id
        assert 'member_count' in response.data

    def test_retrieve_enforces_org_isolation(self, authenticated_client):
        """Cannot retrieve group from different org."""
        other_org = OrganisationFactory()
        group = ContactGroupFactory(organisation=other_org)

        response = authenticated_client.get(f'/api/groups/{group.id}/')

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestContactGroupUpdate:
    """Tests for PUT/PATCH /api/groups/{id}/ endpoint."""

    def test_update_group(self, authenticated_client, organisation, user):
        """Updating group succeeds."""
        group = ContactGroupFactory(organisation=organisation, name='Old', created_by=user)

        data = {'name': 'New Name', 'description': 'Updated'}

        response = authenticated_client.put(f'/api/groups/{group.id}/', data)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['name'] == 'New Name'

    def test_update_enforces_org_isolation(self, authenticated_client):
        """Cannot update group from different org."""
        other_org = OrganisationFactory()
        group = ContactGroupFactory(organisation=other_org)

        data = {'name': 'Hacked'}

        response = authenticated_client.patch(f'/api/groups/{group.id}/', data)

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestContactGroupDelete:
    """Tests for DELETE /api/groups/{id}/ endpoint."""

    def test_delete_group(self, authenticated_client, organisation, user):
        """Deleting group succeeds."""
        group = ContactGroupFactory(organisation=organisation, created_by=user)

        response = authenticated_client.delete(f'/api/groups/{group.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT

        group.refresh_from_db()
        assert group.is_active is False


@pytest.mark.django_db
class TestContactGroupMembers:
    """Tests for group member management endpoints."""

    def test_add_member(self, authenticated_client, organisation, user):
        """POST /api/groups/{id}/members/ adds member."""
        group = ContactGroupFactory(organisation=organisation, created_by=user)
        contact = ContactFactory(organisation=organisation, created_by=user)

        data = {'contact_ids': [contact.id]}

        response = authenticated_client.post(
            f'/api/groups/{group.id}/members/',
            data
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['added_count'] == 1

        # Verify member added
        member = ContactGroupMember.objects.filter(group=group, contact=contact).first()
        assert member is not None

    def test_remove_member(self, authenticated_client, organisation, user):
        """DELETE /api/groups/{id}/members/ removes member."""
        group = ContactGroupFactory(organisation=organisation, created_by=user)
        contact = ContactFactory(organisation=organisation, created_by=user)
        ContactGroupMemberFactory(group=group, contact=contact)

        data = {'contact_ids': [contact.id]}

        response = authenticated_client.delete(
            f'/api/groups/{group.id}/members/',
            data
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['removed_count'] == 1

        # Verify member removed
        member = ContactGroupMember.objects.filter(group=group, contact=contact).first()
        assert member is None

    def test_bulk_add_members(self, authenticated_client, organisation, user):
        """POST /api/groups/{id}/members/ adds multiple."""
        group = ContactGroupFactory(organisation=organisation, created_by=user)
        contact1 = ContactFactory(organisation=organisation, created_by=user)
        contact2 = ContactFactory(organisation=organisation, created_by=user)

        data = {'contact_ids': [contact1.id, contact2.id]}

        response = authenticated_client.post(
            f'/api/groups/{group.id}/members/',
            data
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['added_count'] == 2
        assert ContactGroupMember.objects.filter(group=group).count() == 2
