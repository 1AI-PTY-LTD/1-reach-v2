"""
pytest configuration and shared fixtures for all tests.

This module provides:
- Database setup (pytest-django)
- DRF APIClient fixtures
- Model instance fixtures (users, orgs, contacts, etc.)
- Authentication fixtures (JWT tokens, authenticated clients)
- Mock fixtures (SMS provider, storage provider)
"""

import json
from datetime import timedelta
from unittest.mock import Mock, patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from app.models import (
    Config,
    Contact,
    ContactGroup,
    ContactGroupMember,
    MessageFormat,
    Organisation,
    OrganisationMembership,
    Schedule,
    ScheduleStatus,
    Template,
    User,
)


# ============================================================================
# Database and Client Fixtures
# ============================================================================

@pytest.fixture
def api_client():
    """Return a Django REST Framework APIClient."""
    return APIClient()


@pytest.fixture
def authenticated_client(user, organisation, org_membership):
    """Return an authenticated API client with JWT token and org context."""
    client = APIClient()
    client.force_authenticate(user=user)

    # Monkey-patch DRF's APIView dispatch to inject org context
    from rest_framework.views import APIView
    original_dispatch = APIView.dispatch

    def patched_dispatch(self, request, *args, **kwargs):
        """Dispatch with org context injected."""
        # Inject org context that middleware would normally add
        request.org = organisation
        request.org_id = organisation.clerk_org_id
        request.org_role = 'member'
        request.org_permissions = []
        return original_dispatch(self, request, *args, **kwargs)

    APIView.dispatch = patched_dispatch

    yield client

    # Restore original
    APIView.dispatch = original_dispatch


# ============================================================================
# User and Organisation Fixtures
# ============================================================================

@pytest.fixture
def user(db):
    """Create a test user."""
    return User.objects.create(
        clerk_id='user_test123',
        email='test@example.com',
        first_name='Test',
        last_name='User'
    )


@pytest.fixture
def admin_user(db):
    """Create an admin user."""
    return User.objects.create(
        clerk_id='user_admin123',
        email='admin@example.com',
        first_name='Admin',
        last_name='User'
    )


@pytest.fixture
def organisation(db):
    """Create a test organisation."""
    return Organisation.objects.create(
        clerk_org_id='org_test123',
        name='Test Organisation',
        slug='test-organisation'
    )


@pytest.fixture
def another_org(db):
    """Create a second organisation for multi-tenancy tests."""
    return Organisation.objects.create(
        clerk_org_id='org_other123',
        name='Other Organisation',
        slug='other-organisation'
    )


@pytest.fixture
def org_membership(db, user, organisation):
    """Create organisation membership for test user."""
    return OrganisationMembership.objects.create(
        user=user,
        organisation=organisation,
        role='member'
    )


@pytest.fixture
def admin_membership(db, admin_user, organisation):
    """Create admin organisation membership."""
    return OrganisationMembership.objects.create(
        user=admin_user,
        organisation=organisation,
        role='admin'
    )


# ============================================================================
# Contact and Group Fixtures
# ============================================================================

@pytest.fixture
def contact(db, organisation, user):
    """Create a test contact."""
    return Contact.objects.create(
        organisation=organisation,
        phone='0412345678',
        first_name='John',
        last_name='Doe',
        email='john.doe@example.com',
        created_by=user,
        updated_by=user
    )


@pytest.fixture
def contacts(db, organisation, user):
    """Create multiple test contacts."""
    return [
        Contact.objects.create(
            organisation=organisation,
            phone=f'04123456{i:02d}',
            first_name=f'Contact{i}',
            last_name='Test',
            created_by=user,
            updated_by=user
        )
        for i in range(5)
    ]


@pytest.fixture
def contact_group(db, organisation, user):
    """Create a test contact group."""
    return ContactGroup.objects.create(
        organisation=organisation,
        name='Test Group',
        description='A test contact group',
        created_by=user,
        updated_by=user
    )


@pytest.fixture
def contact_group_with_members(db, contact_group, contacts):
    """Create a contact group with members."""
    for contact in contacts:
        ContactGroupMember.objects.create(
            group=contact_group,
            contact=contact
        )
    return contact_group


# ============================================================================
# Template and Schedule Fixtures
# ============================================================================

@pytest.fixture
def template(db, organisation, user):
    """Create a test template."""
    return Template.objects.create(
        organisation=organisation,
        name='Test Template',
        text='Hello {{name}}, this is a test message.',
        created_by=user,
        updated_by=user
    )


@pytest.fixture
def schedule(db, organisation, contact, user):
    """Create a test schedule."""
    return Schedule.objects.create(
        organisation=organisation,
        contact=contact,
        text='Test message',
        scheduled_time=timezone.now() + timedelta(hours=1),
        status=ScheduleStatus.PENDING,
        format=MessageFormat.SMS,
        message_parts=1,
        created_by=user,
        updated_by=user
    )


@pytest.fixture
def group_schedule(db, organisation, contact_group, user):
    """Create a group schedule (parent)."""
    return Schedule.objects.create(
        organisation=organisation,
        name='Bulk Campaign',
        group=contact_group,
        text='Group message',
        scheduled_time=timezone.now() + timedelta(hours=1),
        status=ScheduleStatus.PENDING,
        format=MessageFormat.SMS,
        message_parts=1,
        created_by=user,
        updated_by=user
    )


@pytest.fixture
def group_schedule_with_children(db, group_schedule, contacts, user):
    """Create a group schedule with child schedules."""
    children = []
    for contact in contacts:
        child = Schedule.objects.create(
            organisation=group_schedule.organisation,
            parent=group_schedule,
            contact=contact,
            text=group_schedule.text,
            scheduled_time=group_schedule.scheduled_time,
            status=ScheduleStatus.PENDING,
            format=MessageFormat.SMS,
            message_parts=1,
            created_by=user,
            updated_by=user
        )
        children.append(child)
    return group_schedule


# ============================================================================
# Config Fixtures
# ============================================================================

@pytest.fixture
def config_sms_limit(db, organisation):
    """Create SMS limit config."""
    return Config.objects.create(
        organisation=organisation,
        name='sms_limit',
        value='100'
    )


@pytest.fixture
def config_mms_limit(db, organisation):
    """Create MMS limit config."""
    return Config.objects.create(
        organisation=organisation,
        name='mms_limit',
        value='50'
    )


# ============================================================================
# Mock Fixtures
# ============================================================================

@pytest.fixture
def mock_sms_provider():
    """Mock the SMS provider."""
    with patch('app.views.get_sms_provider') as mock:
        provider = Mock()
        provider.send_sms.return_value = {
            'success': True,
            'message_id': 'mock-sms-123',
            'error': None,
            'message_parts': 1
        }
        # Mock send_bulk_sms to dynamically return results based on number of recipients
        def mock_bulk_send(recipients):
            return {
                'success': True,
                'results': [
                    {'success': True, 'message_id': f'mock-sms-{i}', 'error': None, 'message_parts': 1}
                    for i in range(len(recipients))
                ],
                'error': None
            }
        provider.send_bulk_sms.side_effect = mock_bulk_send
        provider.send_mms.return_value = {
            'success': True,
            'message_id': 'mock-mms-123',
            'error': None,
            'message_parts': 1
        }
        mock.return_value = provider
        yield provider


@pytest.fixture
def mock_storage_provider():
    """Mock the storage provider."""
    with patch('app.views.get_storage_provider') as mock:
        provider = Mock()
        provider.upload_file.return_value = {
            'success': True,
            'url': 'https://mock-storage.example.com/media/test.jpg',
            'file_id': 'test.jpg',
            'error': None,
            'size': 1024,
            'content_type': 'image/jpeg'
        }
        mock.return_value = provider
        yield provider


@pytest.fixture
def mock_check_sms_limit():
    """Mock SMS limit info to allow unlimited sending."""
    with patch('app.views.get_sms_limit_info') as mock:
        mock.return_value = {
            'current': 0,
            'limit': None,  # No limit configured = unlimited
            'remaining': None
        }
        yield mock


@pytest.fixture
def mock_check_mms_limit():
    """Mock MMS limit info to allow unlimited sending."""
    with patch('app.views.get_mms_limit_info') as mock:
        mock.return_value = {
            'current': 0,
            'limit': None,  # No limit configured = unlimited
            'remaining': None
        }
        yield mock


# ============================================================================
# JWT Token Fixtures
# ============================================================================

@pytest.fixture
def jwt_payload(user, organisation):
    """Create a JWT payload for testing."""
    return {
        'sub': user.clerk_id,
        'org_id': organisation.clerk_org_id,
        'org_role': 'member',
        'org_permissions': [],
        'azp': 'http://localhost:5173',
        'exp': (timezone.now() + timedelta(hours=1)).timestamp(),
        'iat': timezone.now().timestamp()
    }


@pytest.fixture
def admin_jwt_payload(admin_user, organisation):
    """Create an admin JWT payload."""
    return {
        'sub': admin_user.clerk_id,
        'org_id': organisation.clerk_org_id,
        'org_role': 'admin',
        'org_permissions': ['*'],
        'azp': 'http://localhost:5173',
        'exp': (timezone.now() + timedelta(hours=1)).timestamp(),
        'iat': timezone.now().timestamp()
    }
