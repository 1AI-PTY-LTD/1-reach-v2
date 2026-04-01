"""
Tests for WelcorpSMSProvider.

All HTTP calls are mocked — no real Welcorp API traffic.
"""

from unittest.mock import MagicMock, patch

import pytest
import requests

from app.models import FailureCategory
from app.utils.welcorp import WelcorpSMSProvider


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def provider():
    """WelcorpSMSProvider with test credentials."""
    with patch.object(WelcorpSMSProvider, '__init__', lambda self: None):
        p = WelcorpSMSProvider.__new__(WelcorpSMSProvider)
        p.base_url = 'https://api.message-service.org/api/v1'
        p.session = MagicMock(spec=requests.Session)
        return p


def _ok_response(job_id=42):
    """Simulate a successful Welcorp job creation response."""
    resp = MagicMock(spec=requests.Response)
    resp.status_code = 200
    resp.json.return_value = {'status': 200, 'data': job_id}
    return resp


def _error_response(status=422, errors='Validation failed'):
    """Simulate a Welcorp error response."""
    resp = MagicMock(spec=requests.Response)
    resp.status_code = status
    resp.json.return_value = {'status': status, 'errors': errors}
    return resp


def _non_json_response(status=502):
    """Simulate a non-JSON response (e.g. gateway error)."""
    resp = MagicMock(spec=requests.Response)
    resp.status_code = status
    resp.json.side_effect = ValueError('No JSON')
    return resp


# ---------------------------------------------------------------------------
# Constructor
# ---------------------------------------------------------------------------

class TestWelcorpInit:
    def test_raises_without_credentials(self, settings):
        settings.WELCORP_USERNAME = ''
        settings.WELCORP_PASSWORD = ''
        settings.WELCORP_BASE_URL = 'https://api.message-service.org/api/v1'

        with pytest.raises(ValueError, match='WELCORP_USERNAME and WELCORP_PASSWORD'):
            WelcorpSMSProvider()

    def test_creates_session_with_credentials(self, settings):
        settings.WELCORP_USERNAME = 'user'
        settings.WELCORP_PASSWORD = 'pass'
        settings.WELCORP_BASE_URL = 'https://api.message-service.org/api/v1'

        p = WelcorpSMSProvider()
        assert p.session.auth == ('user', 'pass')
        assert p.base_url == 'https://api.message-service.org/api/v1'


# ---------------------------------------------------------------------------
# Phone conversion
# ---------------------------------------------------------------------------

class TestPhoneConversion:
    """_to_international lives on SMSProvider base class but is used by Welcorp."""

    def test_converts_04_to_international(self):
        assert WelcorpSMSProvider._to_international('0412345678') == '+61412345678'

    def test_leaves_non_04_unchanged(self):
        assert WelcorpSMSProvider._to_international('+61412345678') == '+61412345678'

    def test_converts_various_04_numbers(self):
        assert WelcorpSMSProvider._to_international('0400000000') == '+61400000000'
        assert WelcorpSMSProvider._to_international('0499999999') == '+61499999999'


# ---------------------------------------------------------------------------
# SMS sending
# ---------------------------------------------------------------------------

class TestSendSMS:
    def test_success_returns_job_id(self, provider):
        provider.session.post.return_value = _ok_response(job_id=123)

        result = provider._send_sms_impl('0412345678', 'Hello')

        assert result.success is True
        assert result.message_id == '123'
        assert result.error is None

    def test_sends_correct_payload(self, provider):
        provider.session.post.return_value = _ok_response()

        provider._send_sms_impl('0412345678', 'Test message')

        call_args = provider.session.post.call_args
        payload = call_args.kwargs['json']
        assert payload['job_type'] == 'sms'
        assert payload['message'] == 'Test message'
        assert payload['recipients'] == [{'destination': '+61412345678'}]

    def test_phone_converted_to_international(self, provider):
        provider.session.post.return_value = _ok_response()

        provider._send_sms_impl('0400000000', 'Hi')

        payload = provider.session.post.call_args.kwargs['json']
        assert payload['recipients'][0]['destination'] == '+61400000000'

    def test_api_error_returns_failure(self, provider):
        provider.session.post.return_value = _error_response(422, 'Validation failed')

        result = provider._send_sms_impl('0412345678', 'Hello')

        assert result.success is False
        assert result.message_id is None
        assert result.error == 'Validation failed'
        assert result.http_status == 422
        assert result.retryable is False
        assert result.failure_category == FailureCategory.UNKNOWN_PERMANENT.value

    def test_server_error_is_retryable(self, provider):
        provider.session.post.return_value = _error_response(500, 'Internal error')

        result = provider._send_sms_impl('0412345678', 'Hello')

        assert result.success is False
        assert result.http_status == 500
        assert result.retryable is True
        assert result.failure_category == FailureCategory.SERVER_ERROR.value

    def test_auth_error_not_retryable(self, provider):
        provider.session.post.return_value = _error_response(401, 'Invalid credentials.')

        result = provider._send_sms_impl('0412345678', 'Hello')

        assert result.success is False
        assert result.http_status == 401
        assert result.retryable is False
        assert result.failure_category == FailureCategory.ACCOUNT_ERROR.value

    def test_timeout_is_retryable(self, provider):
        provider.session.post.side_effect = requests.Timeout('timed out')

        result = provider._send_sms_impl('0412345678', 'Hello')

        assert result.success is False
        assert result.retryable is True
        assert 'timed out' in result.error
        assert result.error_code == 'TIMEOUT'
        assert result.failure_category == FailureCategory.SERVER_ERROR.value

    def test_connection_error_is_retryable(self, provider):
        provider.session.post.side_effect = requests.ConnectionError('refused')

        result = provider._send_sms_impl('0412345678', 'Hello')

        assert result.success is False
        assert result.retryable is True
        assert 'connection error' in result.error.lower()
        assert result.error_code == 'CONN_ERROR'
        assert result.failure_category == FailureCategory.SERVER_ERROR.value

    def test_non_json_response(self, provider):
        provider.session.post.return_value = _non_json_response(502)

        result = provider._send_sms_impl('0412345678', 'Hello')

        assert result.success is False
        assert result.http_status == 502
        assert result.error_code == '502'
        assert result.retryable is True
        assert result.failure_category == FailureCategory.SERVER_ERROR.value


# ---------------------------------------------------------------------------
# MMS sending
# ---------------------------------------------------------------------------

class TestSendMMS:
    def test_success_returns_job_id(self, provider):
        provider.session.post.return_value = _ok_response(job_id=456)

        result = provider._send_mms_impl(
            '0412345678', 'Check this', 'https://example.com/img.jpg', 'Photo'
        )

        assert result.success is True
        assert result.message_id == '456'

    def test_sends_correct_payload_with_subject(self, provider):
        provider.session.post.return_value = _ok_response()

        provider._send_mms_impl(
            '0412345678', 'Look!', 'https://example.com/img.jpg', 'My Photo'
        )

        payload = provider.session.post.call_args.kwargs['json']
        assert payload['job_type'] == 'mms'
        assert payload['message'] == 'Look!'
        assert payload['subject'] == 'My Photo'
        assert payload['files'] == [{'name': 'media', 'url': 'https://example.com/img.jpg'}]
        assert payload['recipients'] == [{'destination': '+61412345678'}]

    def test_sends_payload_without_subject(self, provider):
        provider.session.post.return_value = _ok_response()

        provider._send_mms_impl(
            '0412345678', 'Look!', 'https://example.com/img.jpg', None
        )

        payload = provider.session.post.call_args.kwargs['json']
        assert 'subject' not in payload

    def test_api_error(self, provider):
        provider.session.post.return_value = _error_response(422, 'Invalid file')

        result = provider._send_mms_impl(
            '0412345678', 'Hi', 'https://example.com/bad.xyz'
        )

        assert result.success is False
        assert result.error == 'Invalid file'


# ---------------------------------------------------------------------------
# Bulk SMS
# ---------------------------------------------------------------------------

class TestSendBulkSMS:
    def test_success_creates_single_job(self, provider):
        provider.session.post.return_value = _ok_response(job_id=789)

        recipients = [
            {'to': '0412345678', 'message': 'Hi', 'message_parts': 1},
            {'to': '0400000000', 'message': 'Hi', 'message_parts': 1},
        ]
        result = provider._send_bulk_sms_impl(recipients)

        assert result['success'] is True
        assert len(result['results']) == 2
        assert all(r['success'] for r in result['results'])
        assert all(r['message_id'] == '789' for r in result['results'])

        # Verify single API call with all recipients
        provider.session.post.assert_called_once()
        payload = provider.session.post.call_args.kwargs['json']
        assert len(payload['recipients']) == 2
        assert payload['recipients'][0]['destination'] == '+61412345678'
        assert payload['recipients'][1]['destination'] == '+61400000000'

    def test_recipients_have_reference_index(self, provider):
        provider.session.post.return_value = _ok_response()

        recipients = [
            {'to': '0412345678', 'message': 'Hi', 'message_parts': 1},
            {'to': '0400000000', 'message': 'Hi', 'message_parts': 1},
        ]
        provider._send_bulk_sms_impl(recipients)

        payload = provider.session.post.call_args.kwargs['json']
        assert payload['recipients'][0]['reference'] == '0'
        assert payload['recipients'][1]['reference'] == '1'

    def test_failure_marks_all_recipients_failed(self, provider):
        provider.session.post.return_value = _error_response(500, 'Server down')

        recipients = [
            {'to': '0412345678', 'message': 'Hi', 'message_parts': 1},
            {'to': '0400000000', 'message': 'Hi', 'message_parts': 1},
        ]
        result = provider._send_bulk_sms_impl(recipients)

        assert result['success'] is False
        assert len(result['results']) == 2
        assert all(not r['success'] for r in result['results'])
        assert all(r['error'] == 'Server down' for r in result['results'])


# ---------------------------------------------------------------------------
# Integration with base class (send_sms calls validate + _send_sms_impl)
# ---------------------------------------------------------------------------

class TestBaseClassIntegration:
    def test_send_sms_validates_then_calls_impl(self, provider):
        provider.session.post.return_value = _ok_response(job_id=99)

        result = provider.send_sms('0412345678', 'Hello')

        assert result.success is True
        assert result.message_id == '99'
        assert result.message_parts == 1

    def test_send_sms_rejects_invalid_phone(self, provider):
        result = provider.send_sms('invalid', 'Hello')

        assert result.success is False
        assert 'Invalid phone' in result.error
        provider.session.post.assert_not_called()

    def test_send_mms_validates_then_calls_impl(self, provider):
        provider.session.post.return_value = _ok_response(job_id=100)

        result = provider.send_mms('0412345678', 'Look', 'https://example.com/img.jpg')

        assert result.success is True
        assert result.message_parts == 1

    def test_send_sms_calculates_multipart(self, provider):
        provider.session.post.return_value = _ok_response()

        result = provider.send_sms('0412345678', 'A' * 307)

        assert result.message_parts == 3
