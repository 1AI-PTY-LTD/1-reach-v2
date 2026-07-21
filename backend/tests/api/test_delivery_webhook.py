"""
Tests for the delivery webhook endpoint.

Tests:
- POST /api/webhooks/sms-delivery/ with valid callback → 200, task dispatched
- Invalid token → 401
- Parse failure → 400
- Real Welcorp provider + real form body end-to-end (no provider mock)
"""

from unittest.mock import Mock, patch

import pytest
from django.test import override_settings
from rest_framework import status

from app.utils.welcorp import WelcorpSMSProvider


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
        provider.parse_inbound_callback.return_value = []
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
        provider.parse_inbound_callback.return_value = []
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
        provider.parse_inbound_callback.return_value = []
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
    def test_real_welcorp_callback_end_to_end(self, mock_get_provider, mock_task, api_client):
        """Real provider + verbatim Welcorp form body (job 92840458 shape).

        Every other test here mocks the provider, which is how the
        61XXXXXXXXX-destination normalisation gap stayed invisible: the
        webhook accepted the callback but the dispatched event carried an
        unmatchable phone. This pins the URL-decode → parse → normalise chain.
        """
        with override_settings(
            WELCORP_USERNAME='test-user',
            WELCORP_PASSWORD='test-pass',
            WELCORP_CALLBACK_SECRET='test-secret-123',
            BASE_URL='https://myapp.example.com',
        ):
            mock_get_provider.return_value = WelcorpSMSProvider()

            response = api_client.post(
                self.URL + '?token=test-secret-123',
                data=(
                    'BroadcastID=92840458&Destination=61401104191&Status=EXPD'
                    '&Timestamp=2026-07-02T12%3A02%3A40%2B10%3A00'
                    '&Reference=1&Recipient=Recipient+1&BroadcastName=Rest+API+SMS'
                ),
                content_type='application/x-www-form-urlencoded',
            )

        assert response.status_code == status.HTTP_200_OK
        mock_task.delay.assert_called_once()
        event_data = mock_task.delay.call_args[0][0]
        assert event_data['provider_message_id'] == '92840458'
        assert event_data['status'] == 'failed'
        assert event_data['error_code'] == 'EXPD'
        assert event_data['recipient_phone'] == '0401104191'

    @patch('app.views.process_delivery_event')
    @patch('app.views.get_sms_provider')
    def test_json_content_type(self, mock_get_provider, mock_task, api_client):
        """Endpoint handles JSON payloads too."""
        provider = Mock()
        provider.validate_callback_request.return_value = True

        event = Mock()
        event.__dict__ = {'provider_message_id': '12345', 'status': 'delivered'}
        provider.parse_delivery_callback.return_value = [event]
        provider.parse_inbound_callback.return_value = []
        mock_get_provider.return_value = provider

        response = api_client.post(
            self.URL + '?token=secret',
            data={'BroadcastID': '12345', 'Status': 'SENT'},
            format='json',
        )

        assert response.status_code == 200
        mock_task.delay.assert_called_once()


@pytest.mark.django_db
class TestInboundReplyWebhook:
    """Reply callbacks arrive on the same URL and fan out to process_inbound_message."""

    URL = '/api/webhooks/sms-delivery/'

    @patch('app.views.process_inbound_message')
    @patch('app.views.process_delivery_event')
    @patch('app.views.get_sms_provider')
    def test_reply_dispatches_inbound_task_only(
        self, mock_get_provider, mock_delivery_task, mock_inbound_task, api_client,
    ):
        provider = Mock()
        provider.validate_callback_request.return_value = True
        provider.parse_delivery_callback.return_value = []

        event = Mock()
        event.__dict__ = {
            'provider_message_id': '62131644',
            'sender_phone': '0498765432',
            'text': 'This is a reply',
        }
        provider.parse_inbound_callback.return_value = [event]
        mock_get_provider.return_value = provider

        response = api_client.post(
            self.URL + '?token=secret',
            data='BroadcastID=62131644&Destination=61498765432&Response=This+is+a+reply',
            content_type='application/x-www-form-urlencoded',
        )

        assert response.status_code == status.HTTP_200_OK
        mock_inbound_task.delay.assert_called_once_with(event.__dict__)
        mock_delivery_task.delay.assert_not_called()

    @patch('app.views.process_inbound_message')
    @patch('app.views.process_delivery_event')
    @patch('app.views.get_sms_provider')
    def test_provider_returning_both_kinds_dispatches_both(
        self, mock_get_provider, mock_delivery_task, mock_inbound_task, api_client,
    ):
        provider = Mock()
        provider.validate_callback_request.return_value = True

        delivery_event = Mock()
        delivery_event.__dict__ = {'provider_message_id': '1', 'status': 'delivered'}
        inbound_event = Mock()
        inbound_event.__dict__ = {'provider_message_id': '1', 'sender_phone': '0412111111', 'text': 'hi'}
        provider.parse_delivery_callback.return_value = [delivery_event]
        provider.parse_inbound_callback.return_value = [inbound_event]
        mock_get_provider.return_value = provider

        response = api_client.post(
            self.URL + '?token=secret',
            data='BroadcastID=1',
            content_type='application/x-www-form-urlencoded',
        )

        assert response.status_code == status.HTTP_200_OK
        mock_delivery_task.delay.assert_called_once_with(delivery_event.__dict__)
        mock_inbound_task.delay.assert_called_once_with(inbound_event.__dict__)

    @patch('app.views.process_inbound_message')
    @patch('app.views.process_delivery_event')
    @patch('app.views.get_sms_provider')
    def test_inbound_parse_failure_returns_400(
        self, mock_get_provider, mock_delivery_task, mock_inbound_task, api_client,
    ):
        provider = Mock()
        provider.validate_callback_request.return_value = True
        provider.parse_delivery_callback.return_value = []
        provider.parse_inbound_callback.side_effect = ValueError('bad data')
        mock_get_provider.return_value = provider

        response = api_client.post(
            self.URL + '?token=secret',
            data='Response=hi',
            content_type='application/x-www-form-urlencoded',
        )

        assert response.status_code == 400
        mock_inbound_task.delay.assert_not_called()
        mock_delivery_task.delay.assert_not_called()

    @patch('app.views.process_inbound_message')
    @patch('app.views.process_delivery_event')
    @patch('app.views.get_sms_provider')
    def test_real_welcorp_reply_end_to_end(
        self, mock_get_provider, mock_delivery_task, mock_inbound_task, api_client,
    ):
        """Real provider + verbatim reply form body (Welcorp docs field set).

        Pins the URL-decode → parse → normalise chain for replies, and the
        hazard fix: a reply body must never reach process_delivery_event.
        """
        with override_settings(
            WELCORP_USERNAME='test-user',
            WELCORP_PASSWORD='test-pass',
            WELCORP_CALLBACK_SECRET='test-secret-123',
            BASE_URL='https://myapp.example.com',
        ):
            mock_get_provider.return_value = WelcorpSMSProvider()

            response = api_client.post(
                self.URL + '?token=test-secret-123',
                data=(
                    'BroadcastID=62131644&Destination=61498765432'
                    '&Response=This+is+a+reply'
                    '&Timestamp=2026-07-10T12%3A02%3A52%2B10%3A00'
                    '&Reference=Customer+123&Recipient=Jane+Smith&BroadcastName=Quick+Send'
                ),
                content_type='application/x-www-form-urlencoded',
            )

        assert response.status_code == status.HTTP_200_OK
        mock_delivery_task.delay.assert_not_called()
        mock_inbound_task.delay.assert_called_once()
        event_data = mock_inbound_task.delay.call_args[0][0]
        assert event_data['provider_message_id'] == '62131644'
        assert event_data['sender_phone'] == '0498765432'
        assert event_data['text'] == 'This is a reply'
        assert event_data['reference'] == 'Customer 123'
