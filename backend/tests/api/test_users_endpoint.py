"""
Tests for User API endpoints (UserViewSet).

Tests:
- Retrieve current user (GET /api/users/me/)
- Update current user
- List org members (with admin permission)
"""

import pytest
from rest_framework import status

from tests.factories import OrganisationMembershipFactory, UserFactory


@pytest.mark.django_db
class TestUserMe:
    """Tests for GET /api/users/me/ endpoint."""

    def test_me_returns_current_user(self, authenticated_client, user):
        """GET /me/ returns authenticated user."""
        response = authenticated_client.get('/api/users/me/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['id'] == user.id
        assert response.data['email'] == user.email
        assert 'clerk_id' not in response.data  # Should be hidden

    def test_me_requires_authentication(self, api_client):
        """Unauthenticated requests denied."""
        response = api_client.get('/api/users/me/')
        assert response.status_code in [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN]

    def test_update_me(self, authenticated_client, user):
        """PATCH /me/ updates current user."""
        data = {'first_name': 'Updated'}

        response = authenticated_client.patch('/api/users/me/', data)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['first_name'] == 'Updated'

        user.refresh_from_db()
        assert user.first_name == 'Updated'


@pytest.mark.django_db
class TestUserList:
    """Tests for GET /api/users/ endpoint."""

    def test_list_returns_org_members(self, authenticated_client, organisation, user):
        """List returns users in same organisation."""
        # Create other user in same org
        other_user = UserFactory()
        OrganisationMembershipFactory(user=other_user, organisation=organisation)

        # Create user in different org
        UserFactory()

        response = authenticated_client.get('/api/users/')

        assert response.status_code == status.HTTP_200_OK
        # Should return at least current user
        user_ids = [u['id'] for u in response.data['results']]
        assert user.id in user_ids
