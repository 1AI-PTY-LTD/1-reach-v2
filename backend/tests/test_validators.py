"""
Tests for custom validator functions.

Tests the reusable validators:
- validate_phone_number: Australian mobile validation and normalization
- validate_sms_message: Message text cleaning and validation
"""

import pytest
from rest_framework.exceptions import ValidationError

from app.serializers import validate_phone_number, validate_sms_message


class TestValidatePhoneNumber:
    """Tests for validate_phone_number function."""

    def test_accepts_04_format(self):
        """04XXXXXXXX format accepted and returned as-is."""
        result = validate_phone_number('0412345678')
        assert result == '0412345678'

    def test_normalizes_plus_61_format(self):
        """+614XXXXXXXX normalized to 04XXXXXXXX."""
        result = validate_phone_number('+61412345678')
        assert result == '0412345678'

    def test_removes_whitespace(self):
        """Whitespace removed from phone number."""
        result = validate_phone_number('04 1234 5678')
        assert result == '0412345678'

        result = validate_phone_number('+614 1234 5678')
        assert result == '0412345678'

    def test_rejects_wrong_prefix(self):
        """Rejects numbers not starting with 04 or +614."""
        with pytest.raises(ValidationError) as exc_info:
            validate_phone_number('0312345678')  # 03 instead of 04
        assert 'Australian mobile' in str(exc_info.value)

        with pytest.raises(ValidationError):
            validate_phone_number('1234567890')  # No prefix

    def test_rejects_wrong_length(self):
        """Rejects numbers with incorrect length."""
        with pytest.raises(ValidationError):
            validate_phone_number('041234567')  # Too short (9 digits)

        with pytest.raises(ValidationError):
            validate_phone_number('04123456789')  # Too long (11 digits)

    def test_rejects_non_numeric(self):
        """Rejects non-numeric characters."""
        with pytest.raises(ValidationError):
            validate_phone_number('04abcd5678')

    @pytest.mark.parametrize('phone,expected', [
        ('0400000000', '0400000000'),
        ('0499999999', '0499999999'),
        ('+61400000000', '0400000000'),
        ('+61499999999', '0499999999'),
        ('04 0000 0000', '0400000000'),
        ('+614 0000 0000', '0400000000'),
    ])
    def test_valid_phone_variations(self, phone, expected):
        """Test various valid phone number formats."""
        result = validate_phone_number(phone)
        assert result == expected


class TestValidateSMSMessage:
    """Tests for validate_sms_message function."""

    def test_accepts_normal_text(self):
        """Normal text accepted as-is."""
        message = 'Hello, this is a test message!'
        result = validate_sms_message(message)
        assert result == message

    def test_strips_whitespace(self):
        """Leading/trailing whitespace stripped."""
        result = validate_sms_message('  Hello World  ')
        assert result == 'Hello World'

    def test_removes_control_characters(self):
        """Control characters removed from message."""
        message = 'Hello\x00World\x0BTest'
        result = validate_sms_message(message)
        assert result == 'HelloWorldTest'

    def test_preserves_newlines(self):
        """Newlines (\n) are preserved."""
        message = 'Line 1\nLine 2\nLine 3'
        result = validate_sms_message(message)
        assert result == message

    def test_rejects_empty_after_cleaning(self):
        """Raises error if message empty after cleaning."""
        with pytest.raises(ValidationError) as exc_info:
            validate_sms_message('   ')  # Only whitespace
        assert 'empty' in str(exc_info.value).lower()

        with pytest.raises(ValidationError):
            validate_sms_message('\x00\x0B')  # Only control chars

    def test_allows_empty_with_flag(self):
        """Empty messages allowed if allow_empty=True."""
        result = validate_sms_message('   ', allow_empty=True)
        assert result == ''

        result = validate_sms_message('\x00\x0B', allow_empty=True)
        assert result == ''

    def test_handles_unicode(self):
        """Unicode characters handled correctly."""
        message = 'Hello 👋 World 🌍'
        result = validate_sms_message(message)
        assert result == message

    def test_handles_long_messages(self):
        """Long messages accepted (validation is length-agnostic)."""
        message = 'A' * 500  # Very long message
        result = validate_sms_message(message)
        assert result == message

    @pytest.mark.parametrize('message,expected', [
        ('Simple message', 'Simple message'),
        ('  Trimmed  ', 'Trimmed'),
        ('Hello\nWorld', 'Hello\nWorld'),
        ('Clean\x00this', 'Cleanthis'),
    ])
    def test_message_variations(self, message, expected):
        """Test various message formats."""
        result = validate_sms_message(message)
        assert result == expected
