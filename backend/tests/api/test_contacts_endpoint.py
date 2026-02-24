"""
Tests for Contact API endpoints (ContactViewSet).

Tests:
- CRUD operations (list, create, retrieve, update, delete)
- Multi-tenancy isolation
- Pagination
- Search filtering
- CSV import (@action import_csv)
- Bulk operations
"""

import io
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status

from app.models import Contact
from tests.factories import (
    ContactFactory,
    ContactGroupFactory,
    ContactGroupMemberFactory,
    OrganisationFactory,
    UserFactory,
)


@pytest.mark.django_db
class TestContactList:
    """Tests for GET /api/contacts/ endpoint."""

    def test_list_returns_org_contacts(self, authenticated_client, organisation, user):
        """List returns only contacts from user's organisation."""
        # Create contacts in user's org
        contact1 = ContactFactory(organisation=organisation, created_by=user)
        contact2 = ContactFactory(organisation=organisation, created_by=user)

        # Create contact in different org (should not appear)
        other_org = OrganisationFactory()
        ContactFactory(organisation=other_org)

        response = authenticated_client.get('/api/contacts/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 2
        phones = [c['phone'] for c in response.data['results']]
        assert contact1.phone in phones
        assert contact2.phone in phones

    def test_list_pagination(self, authenticated_client, organisation, user):
        """List paginates results."""
        # Create 15 contacts
        ContactFactory.create_batch(
            15,
            organisation=organisation,
            created_by=user,
            updated_by=user
        )

        response = authenticated_client.get('/api/contacts/')

        assert response.status_code == status.HTTP_200_OK
        assert 'pagination' in response.data
        assert 'results' in response.data
        assert response.data['pagination']['total'] == 15
        assert len(response.data['results']) <= 50  # Default page size

    def test_list_search(self, authenticated_client, organisation, user):
        """Search filters contacts by phone/name."""
        contact1 = ContactFactory(
            organisation=organisation,
            phone='0412345678',
            first_name='Alice',
            created_by=user,
            updated_by=user
        )
        contact2 = ContactFactory(
            organisation=organisation,
            phone='0487654321',
            first_name='Bob',
            created_by=user,
            updated_by=user
        )

        response = authenticated_client.get('/api/contacts/?search=Alice')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1
        assert response.data['results'][0]['phone'] == contact1.phone

    def test_list_exclude_group(self, authenticated_client, organisation, user):
        """exclude_group_id filters out group members."""
        group = ContactGroupFactory(organisation=organisation, created_by=user)
        contact1 = ContactFactory(organisation=organisation, created_by=user)
        contact2 = ContactFactory(organisation=organisation, created_by=user)

        # Add contact1 to group
        ContactGroupMemberFactory(contact=contact1, group=group)

        response = authenticated_client.get(f'/api/contacts/?exclude_group_id={group.id}')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1
        assert response.data['results'][0]['phone'] == contact2.phone

    def test_list_requires_authentication(self, api_client):
        """Unauthenticated requests denied."""
        response = api_client.get('/api/contacts/')
        assert response.status_code in [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN]


@pytest.mark.django_db
class TestContactCreate:
    """Tests for POST /api/contacts/ endpoint."""

    def test_create_contact(self, authenticated_client, organisation):
        """Creating contact succeeds with valid data."""
        data = {
            'phone': '0412345678',
            'first_name': 'John',
            'last_name': 'Doe',
            'email': 'john@example.com'
        }

        response = authenticated_client.post('/api/contacts/', data)

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['phone'] == '0412345678'

        contact = Contact.objects.get(id=response.data['id'])
        assert contact.organisation == organisation
        assert contact.first_name == 'John'

    def test_create_normalizes_phone(self, authenticated_client):
        """Phone number normalized on create."""
        data = {
            'phone': '+61412345678',
            'first_name': 'Test',
            'last_name': 'User'
        }

        response = authenticated_client.post('/api/contacts/', data)

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['phone'] == '0412345678'

    def test_create_validates_phone(self, authenticated_client):
        """Invalid phone rejected."""
        data = {
            'phone': 'invalid',
            'first_name': 'Test'
        }

        response = authenticated_client.post('/api/contacts/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'phone' in response.data

    def test_create_enforces_unique_phone_per_org(self, authenticated_client, organisation, user):
        """Duplicate phone in same org rejected."""
        ContactFactory(organisation=organisation, phone='0412345678', created_by=user)

        data = {
            'phone': '0412345678',
            'first_name': 'Duplicate'
        }

        response = authenticated_client.post('/api/contacts/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestContactRetrieve:
    """Tests for GET /api/contacts/{id}/ endpoint."""

    def test_retrieve_contact(self, authenticated_client, organisation, user):
        """Retrieving contact by ID succeeds."""
        contact = ContactFactory(organisation=organisation, created_by=user)

        response = authenticated_client.get(f'/api/contacts/{contact.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['id'] == contact.id
        assert response.data['phone'] == contact.phone

    def test_retrieve_enforces_org_isolation(self, authenticated_client):
        """Cannot retrieve contact from different org."""
        other_org = OrganisationFactory()
        contact = ContactFactory(organisation=other_org)

        response = authenticated_client.get(f'/api/contacts/{contact.id}/')

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestContactUpdate:
    """Tests for PUT/PATCH /api/contacts/{id}/ endpoint."""

    def test_update_contact(self, authenticated_client, organisation, user):
        """Updating contact succeeds."""
        contact = ContactFactory(organisation=organisation, first_name='Old', created_by=user)

        data = {
            'phone': contact.phone,
            'first_name': 'New',
            'last_name': contact.last_name
        }

        response = authenticated_client.put(f'/api/contacts/{contact.id}/', data)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['first_name'] == 'New'

        contact.refresh_from_db()
        assert contact.first_name == 'New'

    def test_partial_update(self, authenticated_client, organisation, user):
        """PATCH allows partial updates."""
        contact = ContactFactory(organisation=organisation, first_name='Old', created_by=user)

        data = {'first_name': 'Updated'}

        response = authenticated_client.patch(f'/api/contacts/{contact.id}/', data)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['first_name'] == 'Updated'

    def test_update_enforces_org_isolation(self, authenticated_client):
        """Cannot update contact from different org."""
        other_org = OrganisationFactory()
        contact = ContactFactory(organisation=other_org)

        data = {'first_name': 'Hacked'}

        response = authenticated_client.patch(f'/api/contacts/{contact.id}/', data)

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestContactDelete:
    """Tests for DELETE /api/contacts/{id}/ endpoint."""

    def test_delete_contact(self, authenticated_client, organisation, user):
        """Deleting contact succeeds."""
        contact = ContactFactory(organisation=organisation, created_by=user)

        response = authenticated_client.delete(f'/api/contacts/{contact.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT

        contact.refresh_from_db()
        assert contact.is_active is False  # Soft delete

    def test_delete_enforces_org_isolation(self, authenticated_client):
        """Cannot delete contact from different org."""
        other_org = OrganisationFactory()
        contact = ContactFactory(organisation=other_org)

        response = authenticated_client.delete(f'/api/contacts/{contact.id}/')

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestContactImportCSV:
    """Tests for POST /api/contacts/import/ endpoint."""

    def test_import_csv_creates_contacts(self, authenticated_client, organisation):
        """CSV import creates contacts."""
        csv_content = b'phone,first_name,last_name,email\n0412345678,John,Doe,john@example.com\n0487654321,Jane,Smith,jane@example.com'
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        response = authenticated_client.post(
            '/api/contacts/import/',
            {'file': csv_file},
            format='multipart'
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['record_count'] == 2
        assert response.data['success_count'] == 2
        assert response.data['error_count'] == 0
        assert response.data['status'] == 'success'

        # Verify contacts created
        assert Contact.objects.filter(organisation=organisation).count() == 2

    def test_import_csv_skips_invalid_rows(self, authenticated_client, organisation):
        """CSV import skips invalid rows and reports errors."""
        csv_content = b'phone,first_name\n0412345678,Valid\ninvalid-phone,Invalid\n0487654321,Valid2'
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        response = authenticated_client.post(
            '/api/contacts/import/',
            {'file': csv_file},
            format='multipart'
        )

        assert response.status_code == 207  # Multi-Status when there are errors
        assert response.data['record_count'] == 3
        assert response.data['success_count'] == 2  # Only valid rows
        assert response.data['error_count'] == 1
        assert response.data['status'] == 'partial'

    def test_import_csv_requires_file(self, authenticated_client):
        """Import without file rejected."""
        response = authenticated_client.post(
            '/api/contacts/import/',
            {},
            format='multipart'
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
