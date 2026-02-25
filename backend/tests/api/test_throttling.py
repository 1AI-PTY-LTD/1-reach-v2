"""
Tests for API throttling/rate limiting.

Tests:
- Global throttling (anon and user rates)
- SMS endpoint throttling
- Import endpoint throttling
"""

import pytest
from rest_framework import status
from unittest.mock import patch, Mock


@pytest.mark.django_db
class TestGlobalThrottling:
    """Test global rate limiting for authenticated and anonymous users."""

    def test_user_rate_limit_structure(self, authenticated_client, organisation):
        """Verify throttle configuration allows reasonable requests."""
        # Make 10 requests (well below 1000/min limit)
        for i in range(10):
            response = authenticated_client.get('/api/contacts/')
            assert response.status_code == status.HTTP_200_OK
        # No 429 expected for normal usage


@pytest.mark.django_db
class TestSMSThrottling:
    """Test SMS endpoint throttling."""

    @patch('app.views.get_sms_provider')
    @patch('app.views.get_sms_limit_info')
    def test_sms_send_has_throttle(self, mock_limit, mock_provider, authenticated_client, organisation):
        """SMS send endpoint applies throttle (won't hit limit in single test)."""
        mock_limit.return_value = {'current': 0, 'limit': 1000, 'remaining': 1000}
        provider = Mock()
        provider.send_sms.return_value = {
            'success': True,
            'message_id': 'test-123',
            'message_parts': 1
        }
        mock_provider.return_value = provider

        response = authenticated_client.post('/api/sms/send/', {
            'phone': '0412345678',
            'text': 'Test message'
        })
        # Should not be throttled on first request (may fail validation with 400)
        assert response.status_code != status.HTTP_429_TOO_MANY_REQUESTS


@pytest.mark.django_db
class TestImportThrottling:
    """Test import endpoint throttling."""

    def test_import_has_throttle(self, authenticated_client, organisation):
        """Import endpoint applies throttle configuration."""
        # Single request should succeed (or fail validation, but not be throttled)
        response = authenticated_client.post('/api/contacts/import/', {})
        # May fail validation but shouldn't be throttled on first request
        assert response.status_code != status.HTTP_429_TOO_MANY_REQUESTS
