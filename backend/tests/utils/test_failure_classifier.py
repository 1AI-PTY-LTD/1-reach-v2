"""Tests for the failure_classifier module (pure unit tests, no DB)."""

import pytest

from app.models import FailureCategory
from app.utils.failure_classifier import classify_failure


class TestClassifyFailure:
    def test_known_twilio_invalid_number_is_permanent(self):
        cat, retryable = classify_failure('21211', None, None)
        assert cat == FailureCategory.INVALID_NUMBER
        assert retryable is False

    def test_known_twilio_opt_out_is_permanent(self):
        cat, retryable = classify_failure('21610', None, None)
        assert cat == FailureCategory.OPT_OUT
        assert retryable is False

    def test_known_twilio_rate_limit_is_transient(self):
        cat, retryable = classify_failure('20429', 429, None)
        assert cat == FailureCategory.RATE_LIMITED
        assert retryable is True

    def test_known_twilio_blacklisted_is_permanent(self):
        cat, retryable = classify_failure('30004', None, None)
        assert cat == FailureCategory.BLACKLISTED
        assert retryable is False

    def test_http_429_is_rate_limited(self):
        cat, retryable = classify_failure(None, 429, None)
        assert cat == FailureCategory.RATE_LIMITED
        assert retryable is True

    def test_http_503_is_transient(self):
        cat, retryable = classify_failure(None, 503, 'Service Unavailable')
        assert cat == FailureCategory.SERVER_ERROR
        assert retryable is True

    def test_http_500_is_transient(self):
        cat, retryable = classify_failure(None, 500, None)
        assert cat == FailureCategory.SERVER_ERROR
        assert retryable is True

    def test_http_401_is_account_error(self):
        cat, retryable = classify_failure(None, 401, 'Invalid credentials')
        assert cat == FailureCategory.ACCOUNT_ERROR
        assert retryable is False

    def test_http_400_is_permanent(self):
        cat, retryable = classify_failure(None, 400, 'Bad Request')
        assert retryable is False

    def test_http_404_is_permanent(self):
        cat, retryable = classify_failure(None, 404, None)
        assert retryable is False

    def test_keyword_invalid_number_is_permanent(self):
        cat, retryable = classify_failure(None, None, 'Invalid phone number provided')
        assert retryable is False

    def test_keyword_opt_out_is_permanent(self):
        cat, retryable = classify_failure(None, None, 'Number has opted out')
        assert retryable is False

    def test_keyword_timeout_is_transient(self):
        cat, retryable = classify_failure(None, None, 'Connection timed out')
        assert retryable is True

    def test_keyword_network_error_is_transient(self):
        cat, retryable = classify_failure(None, None, 'Network connection refused')
        assert retryable is True

    def test_unknown_defaults_to_transient(self):
        cat, retryable = classify_failure(None, None, None)
        assert retryable is True
        assert 'unknown' in cat.value

    def test_error_code_takes_priority_over_http_status(self):
        """Known permanent error code overrides a 5xx status code."""
        cat, retryable = classify_failure('21211', 500, None)
        assert cat == FailureCategory.INVALID_NUMBER
        assert retryable is False

    def test_timeout_error_code_is_server_error(self):
        cat, retryable = classify_failure('TIMEOUT', None, None)
        assert cat == FailureCategory.SERVER_ERROR
        assert retryable is True

    def test_conn_error_code_is_server_error(self):
        cat, retryable = classify_failure('CONN_ERROR', None, None)
        assert cat == FailureCategory.SERVER_ERROR
        assert retryable is True

    def test_error_code_string_coercion(self):
        """Integer error codes are coerced to string for lookup."""
        cat, retryable = classify_failure(21211, None, None)  # type: ignore[arg-type]
        assert cat == FailureCategory.INVALID_NUMBER
        assert retryable is False


class TestWelcorpErrorCodes:
    """Tests for Welcorp SMS status codes in the classifier."""

    @pytest.mark.parametrize('code,expected_category,expected_retryable', [
        ('INVN', FailureCategory.INVALID_NUMBER, False),
        ('BARR', FailureCategory.BLACKLISTED, False),
        ('OPTO', FailureCategory.OPT_OUT, False),
        ('BADS', FailureCategory.ACCOUNT_ERROR, False),
        ('RECE', FailureCategory.INVALID_NUMBER, False),
        ('SVRE', FailureCategory.SERVER_ERROR, True),
        ('EXPD', FailureCategory.UNKNOWN_TRANSIENT, True),
        ('FAIL', FailureCategory.UNKNOWN_TRANSIENT, True),
        ('QUED', FailureCategory.UNKNOWN_TRANSIENT, True),
    ])
    def test_welcorp_error_code(self, code, expected_category, expected_retryable):
        cat, retryable = classify_failure(code, None, None)
        assert cat == expected_category
        assert retryable is expected_retryable
