"""
Tests for Template API endpoints (TemplateViewSet).

Tests:
- CRUD operations
- Multi-tenancy isolation
- Version management
"""

import pytest
from rest_framework import status

from app.models import Template
from tests.factories import OrganisationFactory, TemplateFactory


@pytest.mark.django_db
class TestTemplateList:
    """Tests for GET /api/templates/ endpoint."""

    def test_list_returns_org_templates(self, authenticated_client, organisation, user):
        """List returns only templates from user's organisation."""
        template1 = TemplateFactory(organisation=organisation, created_by=user)
        template2 = TemplateFactory(organisation=organisation, created_by=user)

        # Other org template
        other_org = OrganisationFactory()
        TemplateFactory(organisation=other_org)

        response = authenticated_client.get('/api/templates/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 2

    def test_list_search(self, authenticated_client, organisation, user):
        """Search filters templates by name."""
        template1 = TemplateFactory(
            organisation=organisation,
            name='Welcome Message',
            created_by=user
        )
        template2 = TemplateFactory(
            organisation=organisation,
            name='Reminder',
            created_by=user
        )

        response = authenticated_client.get('/api/templates/?search=Welcome')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1


@pytest.mark.django_db
class TestTemplateCreate:
    """Tests for POST /api/templates/ endpoint."""

    def test_create_template(self, authenticated_client, organisation):
        """Creating template succeeds."""
        data = {
            'name': 'New Template',
            'text': 'Hello {{name}}'
        }

        response = authenticated_client.post('/api/templates/', data)

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['name'] == 'New Template'
        assert response.data['version'] == 1

    def test_create_validates_text(self, authenticated_client):
        """Text is required."""
        data = {'name': 'Test'}

        response = authenticated_client.post('/api/templates/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'text' in response.data


@pytest.mark.django_db
class TestTemplateUpdate:
    """Tests for PUT/PATCH /api/templates/{id}/ endpoint."""

    def test_update_template_increments_version(self, authenticated_client, organisation, user):
        """Updating template increments version."""
        template = TemplateFactory(
            organisation=organisation,
            name='Test',
            version=1,
            created_by=user
        )

        data = {
            'name': 'Test',
            'text': 'Updated text'
        }

        response = authenticated_client.put(f'/api/templates/{template.id}/', data)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['version'] == 2

    def test_update_enforces_org_isolation(self, authenticated_client):
        """Cannot update template from different org."""
        other_org = OrganisationFactory()
        template = TemplateFactory(organisation=other_org)

        data = {'text': 'Hacked'}

        response = authenticated_client.patch(f'/api/templates/{template.id}/', data)

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestTemplateDelete:
    """Tests for DELETE /api/templates/{id}/ endpoint."""

    def test_delete_template(self, authenticated_client, organisation, user):
        """Deleting template succeeds."""
        template = TemplateFactory(organisation=organisation, created_by=user)

        response = authenticated_client.delete(f'/api/templates/{template.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT

        template.refresh_from_db()
        assert template.is_active is False
