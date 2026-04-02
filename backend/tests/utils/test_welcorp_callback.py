"""
Tests for WelcorpSMSProvider delivery callback parsing and validation.

Tests:
- parse_delivery_callback maps Welcorp status codes correctly
- Phone normalisation from +614XXXXXXXX to 04XXXXXXXX
- validate_callback_request with correct/incorrect/missing tokens
- get_callback_url format
- _post_job includes callback fields when configured
"""

from unittest.mock import Mock, patch

import pytest
from django.test import override_settings

from app.utils.welcorp import WelcorpSMSProvider


WELCORP_SETTINGS = {
    'WELCORP_BASE_URL': 'https://api.example.com/api/v1',
    'WELCORP_USERNAME': 'testuser',
    'WELCORP_PASSWORD': 'testpass',
    'WELCORP_CALLBACK_SECRET': 'test-secret-123',
    'CALLBACK_BASE_URL': 'https://myapp.example.com',
}


@pytest.fixture
def provider():
    with override_settings(**WELCORP_SETTINGS):
        yield WelcorpSMSProvider()


class TestParseDeliveryCallback:
    """Welcorp delivery callback parsing."""

    def test_sent_maps_to_delivered(self, provider):
        """Welcorp SENT = carrier accepted (best confirmation available) → delivered."""
        data = {
            'BroadcastID': '12345',
            'Destination': '+61412111111',
            'Status': 'SENT',
            'Timestamp': '2026-04-02T10:30:00+10:00',
            'Reference': '0',
            'Recipient': 'John Doe',
            'BroadcastName': 'Test Job',
        }
        events = provider.parse_delivery_callback(data, 'application/x-www-form-urlencoded')
        assert len(events) == 1
        assert events[0].status == 'delivered'
        assert events[0].provider_message_id == '12345'
        assert events[0].recipient_phone == '0412111111'
        assert events[0].error_code is None

    def test_qued_is_skipped(self, provider):
        data = {'BroadcastID': '12345', 'Destination': '+61412111111', 'Status': 'QUED'}
        events = provider.parse_delivery_callback(data, 'application/x-www-form-urlencoded')
        assert events == []

    @pytest.mark.parametrize('welcorp_status', ['FAIL', 'SVRE', 'BARR', 'INVN', 'BADS', 'EXPD', 'OPTO', 'RECE'])
    def test_failure_statuses(self, provider, welcorp_status):
        data = {
            'BroadcastID': '12345',
            'Destination': '+61412222222',
            'Status': welcorp_status,
        }
        events = provider.parse_delivery_callback(data, 'application/x-www-form-urlencoded')

        assert len(events) == 1
        assert events[0].status == 'failed'
        assert events[0].error_code == welcorp_status
        assert events[0].provider_message_id == '12345'

    def test_phone_normalisation(self, provider):
        data = {'BroadcastID': '1', 'Destination': '+61412345678', 'Status': 'FAIL'}
        events = provider.parse_delivery_callback(data, 'application/x-www-form-urlencoded')
        assert events[0].recipient_phone == '0412345678'

    def test_case_insensitive_sent_delivered(self, provider):
        data = {'BroadcastID': '1', 'Destination': '+61412111111', 'Status': 'sent'}
        events = provider.parse_delivery_callback(data, 'application/x-www-form-urlencoded')
        assert events[0].status == 'delivered'

    def test_case_insensitive_failure(self, provider):
        data = {'BroadcastID': '1', 'Destination': '+61412111111', 'Status': 'fail'}
        events = provider.parse_delivery_callback(data, 'application/x-www-form-urlencoded')
        assert events[0].status == 'failed'

    def test_querydict_list_values(self, provider):
        """Django QueryDict wraps values in lists."""
        data = {
            'BroadcastID': ['12345'],
            'Destination': ['+61412111111'],
            'Status': ['FAIL'],
            'Timestamp': ['2026-04-02T10:30:00+10:00'],
        }
        events = provider.parse_delivery_callback(data, 'application/x-www-form-urlencoded')
        assert len(events) == 1
        assert events[0].provider_message_id == '12345'
        assert events[0].status == 'failed'

    def test_raw_data_preserved(self, provider):
        data = {'BroadcastID': '1', 'Destination': '+61412111111', 'Status': 'FAIL', 'Extra': 'field'}
        events = provider.parse_delivery_callback(data, 'application/x-www-form-urlencoded')
        assert events[0].raw_data == data


class TestValidateCallbackRequest:
    """Welcorp callback request validation via shared secret token."""

    def test_valid_token(self, provider):
        with override_settings(**WELCORP_SETTINGS):
            request = Mock()
            request.GET = {'token': 'test-secret-123'}
            assert provider.validate_callback_request(request) is True

    def test_invalid_token(self, provider):
        with override_settings(**WELCORP_SETTINGS):
            request = Mock()
            request.GET = {'token': 'wrong-token'}
            assert provider.validate_callback_request(request) is False

    def test_missing_token(self, provider):
        with override_settings(**WELCORP_SETTINGS):
            request = Mock()
            request.GET = {}
            assert provider.validate_callback_request(request) is False

    def test_no_secret_configured(self):
        with override_settings(**{**WELCORP_SETTINGS, 'WELCORP_CALLBACK_SECRET': ''}):
            p = WelcorpSMSProvider()
            request = Mock()
            request.GET = {'token': 'anything'}
            assert p.validate_callback_request(request) is False


class TestGetCallbackUrl:
    """Welcorp callback URL generation."""

    def test_returns_url_with_token(self, provider):
        with override_settings(**WELCORP_SETTINGS):
            url = provider.get_callback_url()
            assert url == 'https://myapp.example.com/api/webhooks/sms-delivery/?token=test-secret-123'

    def test_returns_none_without_base_url(self):
        with override_settings(**{**WELCORP_SETTINGS, 'CALLBACK_BASE_URL': ''}):
            p = WelcorpSMSProvider()
            assert p.get_callback_url() is None

    def test_returns_none_without_secret(self):
        with override_settings(**{**WELCORP_SETTINGS, 'WELCORP_CALLBACK_SECRET': ''}):
            p = WelcorpSMSProvider()
            assert p.get_callback_url() is None

    def test_strips_trailing_slash(self):
        with override_settings(**{**WELCORP_SETTINGS, 'CALLBACK_BASE_URL': 'https://myapp.example.com/'}):
            p = WelcorpSMSProvider()
            assert p.get_callback_url() == 'https://myapp.example.com/api/webhooks/sms-delivery/?token=test-secret-123'


class TestPostJobCallbackInjection:
    """_post_job includes callback fields when configured."""

    def test_callback_fields_in_payload(self, provider):
        with override_settings(**WELCORP_SETTINGS):
            mock_session = Mock()
            mock_response = Mock()
            mock_response.json.return_value = {'status': 200, 'data': '99999'}
            mock_response.status_code = 200
            mock_session.post.return_value = mock_response
            provider.session = mock_session

            provider._send_sms_impl('0412111111', 'Hello')

            call_args = mock_session.post.call_args
            payload = call_args[1]['json'] if 'json' in call_args[1] else call_args[0][1]
            assert payload['callback_url'] == 'https://myapp.example.com/api/webhooks/sms-delivery/?token=test-secret-123'
            assert payload['callback_on_sms_status_update'] is True

    def test_no_callback_fields_without_config(self):
        with override_settings(**{**WELCORP_SETTINGS, 'WELCORP_CALLBACK_SECRET': '', 'CALLBACK_BASE_URL': ''}):
            p = WelcorpSMSProvider()

            mock_session = Mock()
            mock_response = Mock()
            mock_response.json.return_value = {'status': 200, 'data': '99999'}
            mock_response.status_code = 200
            mock_session.post.return_value = mock_response
            p.session = mock_session

            p._send_sms_impl('0412111111', 'Hello')

            call_args = mock_session.post.call_args
            payload = call_args[1]['json'] if 'json' in call_args[1] else call_args[0][1]
            assert 'callback_url' not in payload
            assert 'callback_on_sms_status_update' not in payload


class TestPollJobStatus:
    """Welcorp job status polling via GET /jobs/{job_id}."""

    def _mock_poll_response(self, provider, reports, job_status='Complete'):
        """Helper: set up mock session to return a job poll response."""
        mock_session = Mock()
        mock_response = Mock()
        mock_response.json.return_value = {
            'status': 200,
            'data': {
                'job_id': 12345,
                'job_type': 'SMS',
                'job_status': job_status,
                'reports': reports,
            },
        }
        mock_session.get.return_value = mock_response
        provider.session = mock_session
        return mock_session

    def test_confirmed_failure_returns_event(self, provider):
        self._mock_poll_response(provider, [
            {'status': 'FAIL', 'stage': 'Confirmed', 'destination': '+61412111111', 'send_date_time': '2026-04-02T10:00:00+10:00'},
        ])

        events = provider.poll_job_status('12345')
        assert len(events) == 1
        assert events[0].status == 'failed'
        assert events[0].error_code == 'FAIL'
        assert events[0].recipient_phone == '0412111111'
        assert events[0].provider_message_id == '12345'

    def test_confirmed_sent_maps_to_delivered(self, provider):
        self._mock_poll_response(provider, [
            {'status': 'SENT', 'stage': 'Confirmed', 'destination': '+61412111111'},
        ])

        events = provider.poll_job_status('12345')
        assert len(events) == 1
        assert events[0].status == 'delivered'
        assert events[0].recipient_phone == '0412111111'

    def test_confirmed_qued_is_skipped(self, provider):
        self._mock_poll_response(provider, [
            {'status': 'QUED', 'stage': 'Confirmed', 'destination': '+61412111111'},
        ])

        events = provider.poll_job_status('12345')
        assert events == []

    def test_initial_stage_is_skipped(self, provider):
        """Initial = carrier hasn't responded yet, skip."""
        self._mock_poll_response(provider, [
            {'status': 'FAIL', 'stage': 'Initial', 'destination': '+61412111111'},
        ])

        events = provider.poll_job_status('12345')
        assert events == []

    def test_empty_reports(self, provider):
        self._mock_poll_response(provider, [])

        events = provider.poll_job_status('12345')
        assert events == []

    def test_multiple_reports_mixed(self, provider):
        self._mock_poll_response(provider, [
            {'status': 'SENT', 'stage': 'Confirmed', 'destination': '+61412111111'},
            {'status': 'INVN', 'stage': 'Confirmed', 'destination': '+61412222222'},
            {'status': 'BARR', 'stage': 'Initial', 'destination': '+61412333333'},
            {'status': 'OPTO', 'stage': 'Confirmed', 'destination': '+61412444444'},
        ])

        events = provider.poll_job_status('12345')
        # BARR initial skipped → SENT (delivered) + INVN (failed) + OPTO (failed)
        assert len(events) == 3
        assert events[0].status == 'delivered'
        assert events[0].recipient_phone == '0412111111'
        assert events[1].error_code == 'INVN'
        assert events[1].recipient_phone == '0412222222'
        assert events[2].error_code == 'OPTO'
        assert events[2].recipient_phone == '0412444444'

    def test_phone_normalisation(self, provider):
        self._mock_poll_response(provider, [
            {'status': 'FAIL', 'stage': 'Confirmed', 'destination': '+61412345678'},
        ])

        events = provider.poll_job_status('12345')
        assert events[0].recipient_phone == '0412345678'

    def test_api_timeout_returns_empty(self, provider):
        import requests as req
        mock_session = Mock()
        mock_session.get.side_effect = req.Timeout('timed out')
        provider.session = mock_session

        events = provider.poll_job_status('12345')
        assert events == []

    def test_api_connection_error_returns_empty(self, provider):
        import requests as req
        mock_session = Mock()
        mock_session.get.side_effect = req.ConnectionError('refused')
        provider.session = mock_session

        events = provider.poll_job_status('12345')
        assert events == []

    def test_non_200_status_returns_empty(self, provider):
        mock_session = Mock()
        mock_response = Mock()
        mock_response.json.return_value = {'status': 404, 'errors': 'Job not found'}
        mock_session.get.return_value = mock_response
        provider.session = mock_session

        events = provider.poll_job_status('12345')
        assert events == []

    def test_non_json_response_returns_empty(self, provider):
        mock_session = Mock()
        mock_response = Mock()
        mock_response.json.side_effect = ValueError('not json')
        mock_response.status_code = 500
        mock_session.get.return_value = mock_response
        provider.session = mock_session

        events = provider.poll_job_status('12345')
        assert events == []
