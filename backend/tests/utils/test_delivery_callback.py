"""
Tests for SMSProvider base class delivery callback interface.

Tests:
- parse_delivery_callback raises NotImplementedError by default
- validate_callback_request returns True by default
- get_callback_url returns None by default
"""

import pytest

from app.utils.sms import MockSMSProvider


class TestSMSProviderCallbackDefaults:
    """Base class callback methods have safe defaults."""

    def setup_method(self):
        self.provider = MockSMSProvider()

    def test_parse_delivery_callback_raises(self):
        with pytest.raises(NotImplementedError, match='MockSMSProvider'):
            self.provider.parse_delivery_callback({}, 'application/json')

    def test_validate_callback_request_returns_true(self):
        assert self.provider.validate_callback_request(object()) is True

    def test_get_callback_url_returns_none(self):
        assert self.provider.get_callback_url() is None

    def test_poll_job_status_raises(self):
        with pytest.raises(NotImplementedError, match='MockSMSProvider'):
            self.provider.poll_job_status('some-job-id')
