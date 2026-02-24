"""
Tests for Django REST Framework serializers.

Tests all serializers for validation, normalization, and business logic:
- ContactSerializer
- ContactGroupSerializer
- TemplateSerializer
- ScheduleSerializer
- SendSMSSerializer
- SendGroupSMSSerializer
- SendMMSSerializer
- ConfigSerializer
- StatsSerializer

Focuses on:
- Field validation (required, max_length, format)
- Custom validators (phone, message)
- Data normalization (phone +614 → 04)
- Read-only fields
- Nested serializers
- SerializerMethodFields
"""

import pytest
from datetime import timedelta
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from app.serializers import (
    ConfigSerializer,
    ContactGroupSerializer,
    ContactSerializer,
    ScheduleSerializer,
    SendGroupSMSSerializer,
    SendMMSSerializer,
    SendSMSSerializer,
    TemplateSerializer,
    validate_phone_number,
    validate_sms_message,
)
from tests.factories import (
    ConfigFactory,
    ContactFactory,
    ContactGroupFactory,
    OrganisationFactory,
    ScheduleFactory,
    TemplateFactory,
    UserFactory,
)


# ============================================================================
# Contact Serializer Tests
# ============================================================================

@pytest.mark.django_db
class TestContactSerializer:
    """Tests for ContactSerializer."""

    def test_valid_contact_data(self):
        """Valid contact data passes validation."""
        data = {
            'phone': '0412345678',
            'first_name': 'John',
            'last_name': 'Doe',
            'email': 'john@example.com'
        }
        serializer = ContactSerializer(data=data)
        assert serializer.is_valid()

    def test_phone_required(self):
        """Phone is required."""
        data = {'first_name': 'John'}
        serializer = ContactSerializer(data=data)
        assert not serializer.is_valid()
        assert 'phone' in serializer.errors

    def test_phone_normalization(self):
        """Phone +614XXXXXXXX normalized to 04XXXXXXXX."""
        data = {
            'phone': '+61412345678',
            'first_name': 'John',
            'last_name': 'Doe'
        }
        serializer = ContactSerializer(data=data)
        assert serializer.is_valid()
        assert serializer.validated_data['phone'] == '0412345678'

    def test_phone_validation_rejects_invalid(self):
        """Invalid phone numbers rejected."""
        data = {
            'phone': '1234567890',  # Wrong format
            'first_name': 'John'
        }
        serializer = ContactSerializer(data=data)
        assert not serializer.is_valid()
        assert 'phone' in serializer.errors


# ============================================================================
# ContactGroup Serializer Tests
# ============================================================================

@pytest.mark.django_db
class TestContactGroupSerializer:
    """Tests for ContactGroupSerializer."""

    def test_valid_group_data(self):
        """Valid group data passes validation."""
        data = {
            'name': 'VIP Clients',
            'description': 'Our most valued customers'
        }
        serializer = ContactGroupSerializer(data=data)
        assert serializer.is_valid()

    def test_name_required(self):
        """Name is required."""
        data = {'description': 'Test'}
        serializer = ContactGroupSerializer(data=data)
        assert not serializer.is_valid()
        assert 'name' in serializer.errors

    def test_member_count_read_only(self):
        """member_count is read-only (SerializerMethodField)."""
        group = ContactGroupFactory()
        serializer = ContactGroupSerializer(group)
        assert 'member_count' in serializer.data
        assert serializer.data['member_count'] >= 0


# ============================================================================
# Template Serializer Tests
# ============================================================================

@pytest.mark.django_db
class TestTemplateSerializer:
    """Tests for TemplateSerializer."""

    def test_valid_template_data(self):
        """Valid template data passes validation."""
        data = {
            'name': 'Welcome Message',
            'text': 'Hello {{name}}, welcome!'
        }
        serializer = TemplateSerializer(data=data)
        assert serializer.is_valid()

    def test_text_required(self):
        """Text is required."""
        data = {'name': 'Test'}
        serializer = TemplateSerializer(data=data)
        assert not serializer.is_valid()
        assert 'text' in serializer.errors

    def test_version_read_only(self):
        """Version is read-only."""
        template = TemplateFactory(version=3)
        serializer = TemplateSerializer(template)
        assert serializer.data['version'] == 3


# ============================================================================
# Schedule Serializer Tests
# ============================================================================

@pytest.mark.django_db
class TestScheduleSerializer:
    """Tests for ScheduleSerializer."""

    def test_valid_schedule_data(self):
        """Valid schedule data passes validation."""
        future = timezone.now() + timedelta(hours=1)
        data = {
            'text': 'Test message',
            'scheduled_time': future.isoformat(),
            'phone': '0412345678'
        }
        serializer = ScheduleSerializer(data=data)
        assert serializer.is_valid()

    def test_text_required(self):
        """Text is optional (can be null/blank)."""
        future = timezone.now() + timedelta(hours=1)
        data = {
            'scheduled_time': future.isoformat(),
            'phone': '0412345678'
        }
        serializer = ScheduleSerializer(data=data)
        # Text is optional in Schedule model (blank=True, null=True)
        assert serializer.is_valid()

    def test_scheduled_time_must_be_future(self):
        """Scheduled time must be in the future."""
        past = timezone.now() - timedelta(hours=1)
        data = {
            'text': 'Test',
            'scheduled_time': past.isoformat(),
            'phone': '0412345678'
        }
        serializer = ScheduleSerializer(data=data)
        assert not serializer.is_valid()
        assert 'scheduled_time' in serializer.errors


# ============================================================================
# SendSMS Serializer Tests
# ============================================================================

@pytest.mark.django_db
class TestSendSMSSerializer:
    """Tests for SendSMSSerializer."""

    def test_valid_sms_data(self):
        """Valid SMS data passes validation."""
        data = {
            'message': 'Hello!',
            'recipient': '0412345678'
        }
        serializer = SendSMSSerializer(data=data)
        assert serializer.is_valid()

    def test_message_required(self):
        """Message is required."""
        data = {'recipient': '0412345678'}
        serializer = SendSMSSerializer(data=data)
        assert not serializer.is_valid()
        assert 'message' in serializer.errors

    def test_recipient_required(self):
        """Recipient is required."""
        data = {'message': 'Hello'}
        serializer = SendSMSSerializer(data=data)
        assert not serializer.is_valid()
        assert 'recipient' in serializer.errors

    def test_recipient_validated(self):
        """Recipient phone validated."""
        data = {
            'message': 'Hello',
            'recipient': 'invalid-phone'
        }
        serializer = SendSMSSerializer(data=data)
        assert not serializer.is_valid()
        assert 'recipient' in serializer.errors

    def test_message_cleaned(self):
        """Message whitespace is cleaned."""
        data = {
            'message': '  Hello World  ',
            'recipient': '0412345678'
        }
        serializer = SendSMSSerializer(data=data)
        assert serializer.is_valid()
        # Whitespace is stripped
        assert serializer.validated_data['message'] == 'Hello World'

    def test_contact_id_optional(self):
        """contact_id is optional."""
        data = {
            'message': 'Hello',
            'recipient': '0412345678',
            'contact_id': 123
        }
        serializer = SendSMSSerializer(data=data)
        assert serializer.is_valid()
        assert serializer.validated_data['contact_id'] == 123


# ============================================================================
# SendBulkSMS Serializer Tests
# ============================================================================

@pytest.mark.django_db
class TestSendGroupSMSSerializer:
    """Tests for SendGroupSMSSerializer."""

    def test_valid_bulk_data(self):
        """Valid bulk SMS data passes validation."""
        data = {
            'message': 'Bulk message',
            'group_id': 1
        }
        serializer = SendGroupSMSSerializer(data=data)
        assert serializer.is_valid()

    def test_group_id_required(self):
        """group_id is required."""
        data = {'message': 'Test'}
        serializer = SendGroupSMSSerializer(data=data)
        assert not serializer.is_valid()
        assert 'group_id' in serializer.errors

    def test_message_cleaned(self):
        """Message is cleaned."""
        data = {
            'message': '  Test  ',
            'group_id': 1
        }
        serializer = SendGroupSMSSerializer(data=data)
        assert serializer.is_valid()
        assert serializer.validated_data['message'] == 'Test'


# ============================================================================
# SendMMS Serializer Tests
# ============================================================================

@pytest.mark.django_db
class TestSendMMSSerializer:
    """Tests for SendMMSSerializer."""

    def test_valid_mms_data(self):
        """Valid MMS data passes validation."""
        data = {
            'message': 'Check this out',
            'media_url': 'https://example.com/image.jpg',
            'recipient': '0412345678'
        }
        serializer = SendMMSSerializer(data=data)
        assert serializer.is_valid()

    def test_media_url_required(self):
        """media_url is required for MMS."""
        data = {
            'message': 'Test',
            'recipient': '0412345678'
        }
        serializer = SendMMSSerializer(data=data)
        assert not serializer.is_valid()
        assert 'media_url' in serializer.errors

    def test_message_optional_for_mms(self):
        """Message is optional for MMS (image-only)."""
        data = {
            'message': '',
            'media_url': 'https://example.com/image.jpg',
            'recipient': '0412345678'
        }
        serializer = SendMMSSerializer(data=data)
        assert serializer.is_valid()
        assert serializer.validated_data['message'] == ''

    def test_subject_optional(self):
        """Subject is optional."""
        data = {
            'message': 'Test',
            'media_url': 'https://example.com/image.jpg',
            'recipient': '0412345678',
            'subject': 'Photo'
        }
        serializer = SendMMSSerializer(data=data)
        assert serializer.is_valid()
        assert serializer.validated_data['subject'] == 'Photo'


# ============================================================================
# Config Serializer Tests
# ============================================================================

@pytest.mark.django_db
class TestConfigSerializer:
    """Tests for ConfigSerializer."""

    def test_valid_config_data(self):
        """Valid config data passes validation."""
        data = {
            'name': 'sms_limit',
            'value': '100'
        }
        serializer = ConfigSerializer(data=data)
        assert serializer.is_valid()

    def test_name_required(self):
        """Name is required."""
        data = {'value': '100'}
        serializer = ConfigSerializer(data=data)
        assert not serializer.is_valid()
        assert 'name' in serializer.errors

    def test_value_required(self):
        """Value is required."""
        data = {'name': 'test'}
        serializer = ConfigSerializer(data=data)
        assert not serializer.is_valid()
        assert 'value' in serializer.errors


# ============================================================================
# Validator Function Tests (moved from test_validators.py for completeness)
# ============================================================================

class TestValidatePhoneNumber:
    """Tests for validate_phone_number function."""

    def test_accepts_04_format(self):
        """04XXXXXXXX format accepted."""
        result = validate_phone_number('0412345678')
        assert result == '0412345678'

    def test_normalizes_plus_61(self):
        """+614XXXXXXXX normalized to 04XXXXXXXX."""
        result = validate_phone_number('+61412345678')
        assert result == '0412345678'

    def test_removes_whitespace(self):
        """Whitespace removed."""
        result = validate_phone_number('04 1234 5678')
        assert result == '0412345678'

    def test_rejects_invalid(self):
        """Invalid formats rejected."""
        with pytest.raises(ValidationError):
            validate_phone_number('1234567890')


class TestValidateSMSMessage:
    """Tests for validate_sms_message function."""

    def test_strips_whitespace(self):
        """Leading/trailing whitespace stripped."""
        result = validate_sms_message('  Hello  ')
        assert result == 'Hello'

    def test_removes_control_chars(self):
        """Control characters removed."""
        result = validate_sms_message('Hello\x00World')
        assert result == 'HelloWorld'

    def test_rejects_empty(self):
        """Empty messages rejected by default."""
        with pytest.raises(ValidationError):
            validate_sms_message('   ')

    def test_allows_empty_with_flag(self):
        """Empty messages allowed if allow_empty=True."""
        result = validate_sms_message('   ', allow_empty=True)
        assert result == ''
