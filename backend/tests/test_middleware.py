"""
Tests for custom middleware.

Tests:
- ClerkTenantMiddleware: Extracts org context from JWT and sets on request
"""

import pytest
from unittest.mock import Mock
from django.http import HttpRequest, HttpResponse

from app.middleware import ClerkTenantMiddleware
from tests.factories import OrganisationFactory


@pytest.mark.django_db
class TestClerkTenantMiddleware:
    """Tests for ClerkTenantMiddleware."""

    def test_sets_org_from_jwt(self):
        """Middleware sets request.org from JWT org_id claim."""
        org = OrganisationFactory(clerk_org_id='org_123')

        request = HttpRequest()
        request.user = Mock()
        request.user.is_authenticated = True
        request.auth = {
            'o': {
                'id': 'org_123',
                'rol': 'member',
                'per': ''
            }
        }

        get_response = lambda r: HttpResponse()
        middleware = ClerkTenantMiddleware(get_response)

        middleware(request)

        assert hasattr(request, 'org')
        assert request.org == org
        assert request.org_role == 'member'
        assert request.org_permissions == []

    def test_handles_missing_org_id(self):
        """Middleware handles missing org_id gracefully."""
        request = HttpRequest()
        request.user = Mock()
        request.user.is_authenticated = True
        request.auth = {}  # No org_id

        get_response = lambda r: HttpResponse()
        middleware = ClerkTenantMiddleware(get_response)

        middleware(request)

        assert hasattr(request, 'org')
        assert request.org is None

    def test_handles_nonexistent_org(self):
        """Middleware handles nonexistent org gracefully."""
        request = HttpRequest()
        request.user = Mock()
        request.user.is_authenticated = True
        request.auth = {
            'o': {
                'id': 'org_nonexistent',
                'rol': 'member',
                'per': ''
            }
        }

        get_response = lambda r: HttpResponse()
        middleware = ClerkTenantMiddleware(get_response)

        middleware(request)

        assert request.org is None

    def test_handles_unauthenticated_user(self):
        """Middleware handles unauthenticated users."""
        request = HttpRequest()
        request.user = Mock()
        request.user.is_authenticated = False

        get_response = lambda r: HttpResponse()
        middleware = ClerkTenantMiddleware(get_response)

        middleware(request)

        assert hasattr(request, 'org')
        assert request.org is None

    def test_extracts_org_role(self):
        """Middleware extracts org_role from JWT."""
        org = OrganisationFactory(clerk_org_id='org_123')

        request = HttpRequest()
        request.user = Mock()
        request.user.is_authenticated = True
        request.auth = {
            'o': {
                'id': 'org_123',
                'rol': 'admin',
                'per': '*'
            }
        }

        get_response = lambda r: HttpResponse()
        middleware = ClerkTenantMiddleware(get_response)

        middleware(request)

        assert request.org_role == 'admin'
        assert request.org_permissions == ['*']
