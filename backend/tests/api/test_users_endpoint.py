"""
Tests for User API endpoints (UserViewSet).

Tests:
- Retrieve current user (GET /api/users/me/) - read-only, managed by Clerk
- List org members (with admin permission)
- PATCH /api/users/{id}/role/ — change member role (admin only)
- PATCH /api/users/{id}/status/ — deactivate/reactivate member (admin only)
- POST /api/users/invite/ — invite new member by email (admin only)
"""

import pytest
from unittest.mock import MagicMock, patch

from rest_framework import status
from rest_framework.test import APIClient
from rest_framework.views import APIView

from tests.factories import OrganisationFactory, OrganisationMembershipFactory, UserFactory


def make_admin_client(user, organisation):
    """Return (client, original_dispatch) with request.org and org_role='admin' injected."""
    client = APIClient()
    client.force_authenticate(user=user)

    original_dispatch = APIView.dispatch

    def patched_dispatch(self, request, *args, **kwargs):
        request.org = organisation
        request.org_id = organisation.clerk_org_id
        request.org_role = 'admin'
        request.org_permissions = ['*']
        return original_dispatch(self, request, *args, **kwargs)

    APIView.dispatch = patched_dispatch
    return client, original_dispatch


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


# ---------------------------------------------------------------------------
# PATCH /api/users/{id}/role/
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestUserRole:
    """Tests for PATCH /api/users/{id}/role/ (admin only)."""

    def setup_method(self):
        self.org = OrganisationFactory(clerk_org_id='org_role_tests')
        self.admin = UserFactory(clerk_id='admin_role')
        OrganisationMembershipFactory(user=self.admin, organisation=self.org, role='admin')
        self.target = UserFactory(clerk_id='target_role')
        OrganisationMembershipFactory(user=self.target, organisation=self.org)

    def teardown_method(self):
        APIView.dispatch = APIView.dispatch.__wrapped__ if hasattr(APIView.dispatch, '__wrapped__') else APIView.dispatch

    def test_returns_400_when_role_invalid(self):
        client, original = make_admin_client(self.admin, self.org)
        try:
            response = client.patch(f'/api/users/{self.target.pk}/role/', {'role': 'bad'}, format='json')
        finally:
            APIView.dispatch = original
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_returns_400_when_changing_own_role(self):
        client, original = make_admin_client(self.admin, self.org)
        try:
            response = client.patch(f'/api/users/{self.admin.pk}/role/', {'role': 'org:member'}, format='json')
        finally:
            APIView.dispatch = original
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'own role' in response.data['detail'].lower()

    def test_calls_clerk_and_returns_200(self):
        mock_result = MagicMock()
        mock_result.role = 'org:admin'
        client, original = make_admin_client(self.admin, self.org)
        try:
            with patch('clerk_backend_api.Clerk') as MockClerk:
                MockClerk.return_value.organization_memberships.update.return_value = mock_result
                response = client.patch(f'/api/users/{self.target.pk}/role/', {'role': 'org:admin'}, format='json')
        finally:
            APIView.dispatch = original
        assert response.status_code == status.HTTP_200_OK
        assert response.data['role'] == 'org:admin'

    def test_returns_502_when_clerk_fails(self):
        client, original = make_admin_client(self.admin, self.org)
        try:
            with patch('clerk_backend_api.Clerk') as MockClerk:
                MockClerk.return_value.organization_memberships.update.side_effect = Exception('Clerk down')
                response = client.patch(f'/api/users/{self.target.pk}/role/', {'role': 'org:member'}, format='json')
        finally:
            APIView.dispatch = original
        assert response.status_code == status.HTTP_502_BAD_GATEWAY


# ---------------------------------------------------------------------------
# PATCH /api/users/{id}/status/
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestUserStatus:
    """Tests for PATCH /api/users/{id}/status/ (admin only)."""

    def setup_method(self):
        self.org = OrganisationFactory(clerk_org_id='org_status_tests')
        self.admin = UserFactory(clerk_id='admin_status')
        OrganisationMembershipFactory(user=self.admin, organisation=self.org, role='admin')
        self.target = UserFactory(clerk_id='target_status', email='target@example.com')
        OrganisationMembershipFactory(user=self.target, organisation=self.org)

    def test_returns_400_when_is_active_not_bool(self):
        client, original = make_admin_client(self.admin, self.org)
        try:
            response = client.patch(f'/api/users/{self.target.pk}/status/', {'is_active': 'yes'}, format='json')
        finally:
            APIView.dispatch = original
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_returns_400_when_changing_own_status(self):
        client, original = make_admin_client(self.admin, self.org)
        try:
            response = client.patch(f'/api/users/{self.admin.pk}/status/', {'is_active': False}, format='json')
        finally:
            APIView.dispatch = original
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'own status' in response.data['detail'].lower()

    def test_deactivates_member(self):
        client, original = make_admin_client(self.admin, self.org)
        try:
            with patch('app.views.Clerk') as MockClerk:
                response = client.patch(f'/api/users/{self.target.pk}/status/', {'is_active': False}, format='json')
        finally:
            APIView.dispatch = original
        assert response.status_code == status.HTTP_200_OK
        assert response.data['is_active'] is False
        MockClerk.return_value.organization_memberships.delete.assert_called_once()

    def test_reactivates_member(self):
        client, original = make_admin_client(self.admin, self.org)
        try:
            with patch('app.views.Clerk') as MockClerk:
                response = client.patch(f'/api/users/{self.target.pk}/status/', {'is_active': True}, format='json')
        finally:
            APIView.dispatch = original
        assert response.status_code == status.HTTP_200_OK
        assert response.data['status'] == 'invitation_sent'
        MockClerk.return_value.organization_invitations.create.assert_called_once()

    def test_returns_502_when_clerk_fails(self):
        client, original = make_admin_client(self.admin, self.org)
        try:
            with patch('app.views.Clerk') as MockClerk:
                MockClerk.return_value.organization_memberships.delete.side_effect = Exception('Clerk down')
                response = client.patch(f'/api/users/{self.target.pk}/status/', {'is_active': False}, format='json')
        finally:
            APIView.dispatch = original
        assert response.status_code == status.HTTP_502_BAD_GATEWAY


# ---------------------------------------------------------------------------
# POST /api/users/invite/
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestUserInvite:
    """Tests for POST /api/users/invite/ (admin only)."""

    def setup_method(self):
        self.org = OrganisationFactory(clerk_org_id='org_invite_tests')
        self.admin = UserFactory(clerk_id='admin_invite')
        OrganisationMembershipFactory(user=self.admin, organisation=self.org, role='admin')

    def test_returns_400_when_email_missing(self):
        client, original = make_admin_client(self.admin, self.org)
        try:
            response = client.post('/api/users/invite/', {}, format='json')
        finally:
            APIView.dispatch = original
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_returns_400_when_role_invalid(self):
        client, original = make_admin_client(self.admin, self.org)
        try:
            response = client.post('/api/users/invite/', {'email': 'x@example.com', 'role': 'bad'}, format='json')
        finally:
            APIView.dispatch = original
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_sends_invitation_via_clerk(self):
        client, original = make_admin_client(self.admin, self.org)
        try:
            with patch('app.views.Clerk') as MockClerk:
                response = client.post('/api/users/invite/', {'email': 'new@example.com'}, format='json')
        finally:
            APIView.dispatch = original
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['email'] == 'new@example.com'
        MockClerk.return_value.organization_invitations.create.assert_called_once()

    def test_returns_502_when_clerk_fails(self):
        client, original = make_admin_client(self.admin, self.org)
        try:
            with patch('app.views.Clerk') as MockClerk:
                MockClerk.return_value.organization_invitations.create.side_effect = Exception('Clerk down')
                response = client.post('/api/users/invite/', {'email': 'new@example.com'}, format='json')
        finally:
            APIView.dispatch = original
        assert response.status_code == status.HTTP_502_BAD_GATEWAY
