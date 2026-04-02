"""
Tests for the delivery webhook endpoint.

Tests:
- POST /api/webhooks/sms-delivery/ with valid callback → 200, task dispatched
- Invalid token → 401
- Parse failure → 400
"""

from unittest.mock import Mock, patch

import pytest
from rest_framework import status


@pytest.mark.django_db
class TestDeliveryWebhookEndpoint:
    """Tests for POST /api/webhooks/sms-delivery/."""

    URL = '/api/webhooks/sms-delivery/'

    @patch('app.views.process_delivery_event')
    @patch('app.views.get_sms_provider')
    def test_valid_callback_dispatches_task(self, mock_get_provider, mock_task, api_client):
        provider = Mock()
        provider.validate_callback_request.return_value = True

        event = Mock()
        event.__dict__ = {
            'provider_message_id': '12345',
            'status': 'delivered',
            'recipient_phone': '0412111111',
        }
        provider.parse_delivery_callback.return_value = [event]
        mock_get_provider.return_value = provider

        response = api_client.post(
            self.URL + '?token=secret',
            data='BroadcastID=12345&Status=SENT&Destination=%2B61412111111',
            content_type='application/x-www-form-urlencoded',
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data == {'status': 'ok'}
        mock_task.delay.assert_called_once_with(event.__dict__)

    @patch('app.views.get_sms_provider')
    def test_invalid_token_returns_401(self, mock_get_provider, api_client):
        provider = Mock()
        provider.validate_callback_request.return_value = False
        mock_get_provider.return_value = provider

        response = api_client.post(
            self.URL,
            data='BroadcastID=12345&Status=SENT',
            content_type='application/x-www-form-urlencoded',
        )

        assert response.status_code == 401

    @patch('app.views.get_sms_provider')
    def test_parse_failure_returns_400(self, mock_get_provider, api_client):
        provider = Mock()
        provider.validate_callback_request.return_value = True
        provider.parse_delivery_callback.side_effect = ValueError('bad data')
        mock_get_provider.return_value = provider

        response = api_client.post(
            self.URL + '?token=secret',
            data='garbage',
            content_type='application/x-www-form-urlencoded',
        )

        assert response.status_code == 400

    @patch('app.views.process_delivery_event')
    @patch('app.views.get_sms_provider')
    def test_empty_events_returns_200(self, mock_get_provider, mock_task, api_client):
        """Non-terminal status (e.g. QUED) produces no events — still returns 200."""
        provider = Mock()
        provider.validate_callback_request.return_value = True
        provider.parse_delivery_callback.return_value = []
        mock_get_provider.return_value = provider

        response = api_client.post(
            self.URL + '?token=secret',
            data='BroadcastID=12345&Status=QUED',
            content_type='application/x-www-form-urlencoded',
        )

        assert response.status_code == 200
        mock_task.delay.assert_not_called()

    @patch('app.views.process_delivery_event')
    @patch('app.views.get_sms_provider')
    def test_json_content_type(self, mock_get_provider, mock_task, api_client):
        """Endpoint handles JSON payloads too."""
        provider = Mock()
        provider.validate_callback_request.return_value = True

        event = Mock()
        event.__dict__ = {'provider_message_id': '12345', 'status': 'delivered'}
        provider.parse_delivery_callback.return_value = [event]
        mock_get_provider.return_value = provider

        response = api_client.post(
            self.URL + '?token=secret',
            data={'BroadcastID': '12345', 'Status': 'SENT'},
            format='json',
        )

        assert response.status_code == 200
        mock_task.delay.assert_called_once()
