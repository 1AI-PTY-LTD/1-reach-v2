"""
Tests for SMS provider abstraction.

Tests:
- SMSProvider base class (validation, normalization, parts calculation)
- MockSMSProvider implementation
- Provider factory function
"""

import pytest
from rest_framework.exceptions import ValidationError

from app.utils.sms import MockSMSProvider, get_sms_provider


class TestSMSProviderValidation:
    """Tests for SMSProvider phone validation."""

    def test_validate_phone_accepts_valid_04_format(self):
        """Valid 04XXXXXXXX phone accepted."""
        provider = MockSMSProvider()
        assert provider._validate_phone('0412345678') is True

    def test_validate_phone_accepts_valid_plus_61_format(self):
        """+614XXXXXXXX phone accepted."""
        provider = MockSMSProvider()
        assert provider._validate_phone('+61412345678') is True

    def test_validate_phone_accepts_with_whitespace(self):
        """Phone with whitespace accepted (will be normalized)."""
        provider = MockSMSProvider()
        assert provider._validate_phone('04 1234 5678') is True
        assert provider._validate_phone('+614 1234 5678') is True

    def test_validate_phone_rejects_invalid_format(self):
        """Invalid phone formats rejected."""
        provider = MockSMSProvider()
        assert provider._validate_phone('1234567890') is False
        assert provider._validate_phone('0312345678') is False
        assert provider._validate_phone('041234567') is False


class TestSMSProviderNormalization:
    """Tests for SMSProvider phone normalization."""

    def test_normalise_phone_04_format_unchanged(self):
        """04XXXXXXXX format unchanged."""
        provider = MockSMSProvider()
        result = provider._normalise_phone('0412345678')
        assert result == '0412345678'

    def test_normalise_phone_converts_plus_61(self):
        """+614XXXXXXXX converted to 04XXXXXXXX."""
        provider = MockSMSProvider()
        result = provider._normalise_phone('+61412345678')
        assert result == '0412345678'

    def test_normalise_phone_removes_whitespace(self):
        """Whitespace removed during normalization."""
        provider = MockSMSProvider()
        result = provider._normalise_phone('04 1234 5678')
        assert result == '0412345678'

        result = provider._normalise_phone('+614 1234 5678')
        assert result == '0412345678'

    @pytest.mark.parametrize('input_phone,expected', [
        ('0400000000', '0400000000'),
        ('+61400000000', '0400000000'),
        ('04 0000 0000', '0400000000'),
        ('+614 0000 0000', '0400000000'),
        ('0499999999', '0499999999'),
        ('+61499999999', '0499999999'),
    ])
    def test_normalise_phone_variations(self, input_phone, expected):
        """Test normalization of various phone formats."""
        provider = MockSMSProvider()
        result = provider._normalise_phone(input_phone)
        assert result == expected


class TestSMSPartsCalculation:
    """Tests for SMS message parts calculation."""

    def test_single_sms_one_part(self):
        """Messages ≤160 chars = 1 part."""
        provider = MockSMSProvider()

        # Exactly 160 characters
        assert provider._calculate_sms_parts('A' * 160) == 1

        # Less than 160
        assert provider._calculate_sms_parts('A' * 100) == 1
        assert provider._calculate_sms_parts('A' * 1) == 1

    def test_concatenated_sms_multiple_parts(self):
        """Messages >160 chars split into 153-char parts."""
        provider = MockSMSProvider()

        # 161 chars = 2 parts (first part uses header)
        assert provider._calculate_sms_parts('A' * 161) == 2

        # 306 chars = 2 parts (2 * 153 = 306)
        assert provider._calculate_sms_parts('A' * 306) == 2

        # 307 chars = 3 parts
        assert provider._calculate_sms_parts('A' * 307) == 3

        # 459 chars = 3 parts (3 * 153 = 459)
        assert provider._calculate_sms_parts('A' * 459) == 3

        # 460 chars = 4 parts
        assert provider._calculate_sms_parts('A' * 460) == 4

    @pytest.mark.parametrize('length,expected_parts', [
        (1, 1),
        (50, 1),
        (100, 1),
        (160, 1),
        (161, 2),
        (200, 2),
        (306, 2),
        (307, 3),
        (400, 3),
        (459, 3),
        (460, 4),
    ])
    def test_parts_calculation_boundaries(self, length, expected_parts):
        """Test SMS parts calculation at various lengths."""
        provider = MockSMSProvider()
        message = 'A' * length
        assert provider._calculate_sms_parts(message) == expected_parts


class TestMockSMSProvider:
    """Tests for MockSMSProvider implementation."""

    def test_send_sms_returns_success(self):
        """send_sms returns success with mock message ID."""
        provider = MockSMSProvider()
        result = provider.send_sms(to='0412345678', message='Test message')

        assert result['success'] is True
        assert result['message_id'].startswith('mock-sms-')
        assert result['error'] is None
        assert result['message_parts'] == 1

    def test_send_sms_validates_phone(self):
        """send_sms validates phone number."""
        provider = MockSMSProvider()

        # Invalid phone
        result = provider.send_sms(to='invalid', message='Test')
        assert result['success'] is False
        assert 'Invalid phone' in result['error']
        assert result['message_id'] is None

    def test_send_sms_normalizes_phone(self):
        """send_sms normalizes phone before sending."""
        provider = MockSMSProvider()

        # +614 format normalized to 04
        result = provider.send_sms(to='+61412345678', message='Test')
        assert result['success'] is True

    def test_send_sms_calculates_parts(self):
        """send_sms calculates message parts correctly."""
        provider = MockSMSProvider()

        # Single part
        result = provider.send_sms(to='0412345678', message='A' * 160)
        assert result['message_parts'] == 1

        # Multiple parts
        result = provider.send_sms(to='0412345678', message='A' * 307)
        assert result['message_parts'] == 3

    def test_send_bulk_sms_processes_all_recipients(self):
        """send_bulk_sms processes all valid recipients."""
        provider = MockSMSProvider()

        recipients = [
            {'to': '0412345678', 'message': 'Message 1'},
            {'to': '0487654321', 'message': 'Message 2'},
            {'to': '0400000000', 'message': 'Message 3'},
        ]

        result = provider.send_bulk_sms(recipients)

        assert result['success'] is True
        assert len(result['results']) == 3
        assert all(r['success'] for r in result['results'])
        assert result['error'] is None

    def test_send_bulk_sms_skips_invalid_phones(self):
        """send_bulk_sms skips recipients with invalid phones."""
        provider = MockSMSProvider()

        recipients = [
            {'to': '0412345678', 'message': 'Valid'},
            {'to': 'invalid', 'message': 'Invalid'},
            {'to': '0487654321', 'message': 'Valid'},
        ]

        result = provider.send_bulk_sms(recipients)

        # Only 2 valid recipients processed
        assert len(result['results']) == 2
        assert all(r['success'] for r in result['results'])

    def test_send_mms_returns_success(self):
        """send_mms returns success with mock message ID."""
        provider = MockSMSProvider()

        result = provider.send_mms(
            to='0412345678',
            message='Check this out!',
            media_url='https://example.com/image.jpg',
            subject='Photo'
        )

        assert result['success'] is True
        assert result['message_id'].startswith('mock-mms-')
        assert result['error'] is None
        assert result['message_parts'] == 1  # MMS always 1 part

    def test_send_mms_validates_phone(self):
        """send_mms validates phone number."""
        provider = MockSMSProvider()

        result = provider.send_mms(
            to='invalid',
            message='Test',
            media_url='https://example.com/image.jpg'
        )

        assert result['success'] is False
        assert 'Invalid phone' in result['error']

    def test_send_mms_accepts_empty_message(self):
        """send_mms accepts empty message (image-only MMS)."""
        provider = MockSMSProvider()

        result = provider.send_mms(
            to='0412345678',
            message='',
            media_url='https://example.com/image.jpg'
        )

        assert result['success'] is True


class TestGetSMSProvider:
    """Tests for get_sms_provider factory function."""

    def test_returns_configured_provider(self):
        """get_sms_provider returns configured provider class."""
        provider = get_sms_provider()
        assert isinstance(provider, MockSMSProvider)

    def test_returns_singleton(self):
        """get_sms_provider returns same instance on multiple calls."""
        provider1 = get_sms_provider()
        provider2 = get_sms_provider()
        assert provider1 is provider2
