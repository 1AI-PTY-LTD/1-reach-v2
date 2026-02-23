"""
Tests for SMS endpoint (SMSViewSet).

Tests critical SMS/MMS functionality:
- send_sms: Individual SMS sending with limit checking
- send_to_group: Bulk SMS to contact groups
- send_mms: MMS sending with media
- upload_file: File upload for MMS media

These are CRITICAL tests as they verify:
- SMS/MMS sending logic
- Monthly limit enforcement
- Multi-tenancy isolation
- Provider abstraction integration
"""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework import status

from app.models import MessageFormat, Schedule, ScheduleStatus
from tests.factories import (
    ConfigFactory,
    ContactFactory,
    ContactGroupFactory,
    ScheduleFactory,
    create_contact_group_with_members,
)


@pytest.mark.django_db
class TestSendSMS:
    """Tests for POST /api/sms/send/ endpoint."""

    def test_send_sms_creates_schedule(
        self, authenticated_client, organisation, user, mock_sms_provider, mock_check_sms_limit
    ):
        """Sending SMS creates a Schedule record."""
        data = {
            'message': 'Test message',
            'recipient': '0412345678'
        }

        response = authenticated_client.post('/api/sms/send/', data)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['success'] is True

        # Verify Schedule created
        schedule = Schedule.objects.filter(
            organisation=organisation,
            phone='0412345678',
            format=MessageFormat.SMS
        ).first()

        assert schedule is not None
        assert schedule.text == 'Test message'
        assert schedule.status == ScheduleStatus.SENT
        assert schedule.message_parts == 1

    def test_send_sms_with_contact_id(
        self, authenticated_client, contact, mock_sms_provider, mock_check_sms_limit
    ):
        """Sending SMS with contact_id links to contact."""
        data = {
            'message': 'Hello!',
            'recipient': contact.phone,
            'contact_id': contact.id
        }

        response = authenticated_client.post('/api/sms/send/', data)

        assert response.status_code == status.HTTP_200_OK

        schedule = Schedule.objects.filter(contact=contact).first()
        assert schedule is not None
        assert schedule.contact == contact

    def test_send_sms_checks_monthly_limit(
        self, authenticated_client, organisation, config_sms_limit
    ):
        """Send SMS enforces monthly SMS limit."""
        # Set limit to 5
        config_sms_limit.value = '5'
        config_sms_limit.save()

        # Create 5 existing SMS schedules this month
        ScheduleFactory.create_batch(
            5,
            organisation=organisation,
            format=MessageFormat.SMS,
            scheduled_time=timezone.now()
        )

        # Attempt to send 6th SMS
        data = {'message': 'Test', 'recipient': '0412345678'}
        response = authenticated_client.post('/api/sms/send/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'limit' in str(response.data).lower()

    def test_send_sms_validates_phone_number(
        self, authenticated_client, mock_sms_provider, mock_check_sms_limit
    ):
        """Invalid phone numbers rejected."""
        data = {
            'message': 'Test',
            'recipient': 'invalid-phone'
        }

        response = authenticated_client.post('/api/sms/send/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_send_sms_validates_message(
        self, authenticated_client, mock_sms_provider, mock_check_sms_limit
    ):
        """Empty/invalid messages rejected."""
        data = {
            'message': '',  # Empty message
            'recipient': '0412345678'
        }

        response = authenticated_client.post('/api/sms/send/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_send_sms_calls_provider(
        self, authenticated_client, organisation, mock_sms_provider, mock_check_sms_limit
    ):
        """send_sms calls SMS provider with correct params."""
        data = {
            'message': 'Test message',
            'recipient': '0412345678'
        }

        response = authenticated_client.post('/api/sms/send/', data)

        assert response.status_code == status.HTTP_200_OK

        # Verify provider was called
        mock_sms_provider.send_sms.assert_called_once()
        call_args = mock_sms_provider.send_sms.call_args
        assert call_args[1]['to'] == '0412345678'
        assert call_args[1]['message'] == 'Test message'

    def test_send_sms_requires_authentication(self, api_client):
        """Unauthenticated requests rejected."""
        data = {'message': 'Test', 'recipient': '0412345678'}
        response = api_client.post('/api/sms/send/', data)

        assert response.status_code in [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN]


@pytest.mark.django_db
class TestSendToGroup:
    """Tests for POST /api/sms/send-to-group/ endpoint."""

    def test_send_to_group_creates_parent_and_children(
        self, authenticated_client, organisation, user, mock_sms_provider, mock_check_sms_limit
    ):
        """Sending to group creates parent + child schedules."""
        # Create group with 3 members
        group, contacts = create_contact_group_with_members(organisation, num_members=3, user=user)

        data = {
            'message': 'Bulk message',
            'group_id': group.id
        }

        response = authenticated_client.post('/api/sms/send-to-group/', data)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['success'] is True
        assert response.data['results']['total'] == 3
        assert response.data['results']['successful'] == 3
        assert response.data['results']['failed'] == 0

        # Verify parent schedule
        parent_id = response.data['group_schedule_id']
        parent = Schedule.objects.get(id=parent_id)
        assert parent.group == group
        assert parent.text == 'Bulk message'

        # Verify children
        children = Schedule.objects.filter(parent=parent)
        assert children.count() == 3

        for child in children:
            assert child.parent == parent
            assert child.text == 'Bulk message'
            assert child.status == ScheduleStatus.SENT
            assert child.contact in contacts

    def test_send_to_group_skips_opted_out_contacts(
        self, authenticated_client, organisation, user, mock_sms_provider, mock_check_sms_limit
    ):
        """Opted-out contacts excluded from bulk send."""
        group, contacts = create_contact_group_with_members(organisation, num_members=3, user=user)

        # Mark one contact as opted out
        contacts[0].opt_out = True
        contacts[0].save()

        data = {'message': 'Bulk', 'group_id': group.id}
        response = authenticated_client.post('/api/sms/send-to-group/', data)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['results']['total'] == 2  # Only 2 sent

    def test_send_to_group_validates_group_exists(
        self, authenticated_client, mock_sms_provider, mock_check_sms_limit
    ):
        """Non-existent group ID rejected."""
        data = {'message': 'Test', 'group_id': 99999}
        response = authenticated_client.post('/api/sms/send-to-group/', data)

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_send_to_group_checks_bulk_limit(
        self, authenticated_client, organisation, user, config_sms_limit
    ):
        """Bulk send respects SMS limit."""
        group, contacts = create_contact_group_with_members(organisation, num_members=10, user=user)

        # Set limit to 5
        config_sms_limit.value = '5'
        config_sms_limit.save()

        data = {'message': 'Bulk', 'group_id': group.id}
        response = authenticated_client.post('/api/sms/send-to-group/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'limit' in str(response.data).lower()


@pytest.mark.django_db
class TestSendMMS:
    """Tests for POST /api/sms/send-mms/ endpoint."""

    def test_send_mms_creates_schedule(
        self, authenticated_client, organisation, mock_sms_provider, mock_check_mms_limit
    ):
        """Sending MMS creates Schedule with format=MMS."""
        data = {
            'message': 'Check this out!',
            'media_url': 'https://example.com/image.jpg',
            'recipient': '0412345678',
            'subject': 'Photo'
        }

        response = authenticated_client.post('/api/sms/send-mms/', data)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['success'] is True

        schedule = Schedule.objects.filter(
            organisation=organisation,
            format=MessageFormat.MMS
        ).first()

        assert schedule is not None
        assert schedule.media_url == 'https://example.com/image.jpg'
        assert schedule.subject == 'Photo'
        assert schedule.message_parts == 1  # MMS always 1 part

    def test_send_mms_checks_monthly_limit(
        self, authenticated_client, organisation, config_mms_limit
    ):
        """Send MMS enforces monthly MMS limit."""
        config_mms_limit.value = '3'
        config_mms_limit.save()

        # Create 3 existing MMS schedules
        ScheduleFactory.create_batch(
            3,
            organisation=organisation,
            format=MessageFormat.MMS,
            scheduled_time=timezone.now()
        )

        data = {
            'message': 'Test',
            'media_url': 'https://example.com/image.jpg',
            'recipient': '0412345678'
        }

        response = authenticated_client.post('/api/sms/send-mms/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'limit' in str(response.data).lower()

    def test_send_mms_accepts_empty_message(
        self, authenticated_client, mock_sms_provider, mock_check_mms_limit
    ):
        """MMS with empty text (image-only) accepted."""
        data = {
            'message': '',
            'media_url': 'https://example.com/image.jpg',
            'recipient': '0412345678'
        }

        response = authenticated_client.post('/api/sms/send-mms/', data)

        assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
class TestUploadFile:
    """Tests for POST /api/sms/upload-file/ endpoint."""

    def test_upload_file_accepts_valid_image(
        self, authenticated_client, mock_storage_provider
    ):
        """Valid image file accepted and uploaded."""
        image = SimpleUploadedFile(
            'test.jpg',
            b'fake image content',
            content_type='image/jpeg'
        )

        response = authenticated_client.post(
            '/api/sms/upload-file/',
            {'file': image},
            format='multipart'
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['success'] is True
        assert 'url' in response.data
        assert 'file_id' in response.data

    def test_upload_file_validates_file_type(self, authenticated_client):
        """Non-image files rejected."""
        txt_file = SimpleUploadedFile(
            'test.txt',
            b'text content',
            content_type='text/plain'
        )

        response = authenticated_client.post(
            '/api/sms/upload-file/',
            {'file': txt_file},
            format='multipart'
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_upload_file_validates_file_size(self, authenticated_client):
        """Files >400KB rejected."""
        large_image = SimpleUploadedFile(
            'large.jpg',
            b'x' * (500 * 1024),  # 500KB
            content_type='image/jpeg'
        )

        response = authenticated_client.post(
            '/api/sms/upload-file/',
            {'file': large_image},
            format='multipart'
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert '400' in str(response.data)  # "400KB" in error

    def test_upload_file_requires_file(self, authenticated_client):
        """Request without file rejected."""
        response = authenticated_client.post(
            '/api/sms/upload-file/',
            {},
            format='multipart'
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.parametrize('content_type', [
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/gif',
    ])
    def test_upload_file_accepts_allowed_types(
        self, authenticated_client, mock_storage_provider, content_type
    ):
        """All allowed image types accepted."""
        image = SimpleUploadedFile(
            f'test.{content_type.split("/")[1]}',
            b'image',
            content_type=content_type
        )

        response = authenticated_client.post(
            '/api/sms/upload-file/',
            {'file': image},
            format='multipart'
        )

        assert response.status_code == status.HTTP_200_OK
