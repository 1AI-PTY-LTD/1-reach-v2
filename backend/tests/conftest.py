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
import logging
from datetime import timedelta
from decimal import Decimal
from unittest.mock import Mock, patch
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from app.models import (
    Config,
    Contact,
    ContactGroup,
    ContactGroupMember,
    FailureCategory,
    MessageFormat,
    Organisation,
    OrganisationMembership,
    Schedule,
    ScheduleStatus,
    Template,
    User,
)
from app.utils.sms import SendResult
from app.utils.storage import MockStorageProvider


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
    """Create a test organisation.

    Funded by default (real orgs get free credits at signup) so prepaid
    deductions don't trip the record_usage balance floor in tests that
    aren't about billing. Balance-sensitive tests set their own value.
    """
    return Organisation.objects.create(
        clerk_org_id='org_test123',
        name='Test Organisation',
        slug='test-organisation',
        credit_balance=Decimal('100.00'),
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
def schedule_queued(db, organisation, contact, user):
    """A QUEUED schedule ready for Celery processing."""
    return Schedule.objects.create(
        organisation=organisation,
        contact=contact,
        phone='0412345678',
        text='Test message',
        scheduled_time=timezone.now(),
        status=ScheduleStatus.QUEUED,
        format=MessageFormat.SMS,
        message_parts=1,
        max_retries=3,
        created_by=user,
        updated_by=user,
    )


@pytest.fixture
def schedule_sent(db, schedule_queued):
    """A SENT schedule with a provider_message_id (awaiting delivery receipt)."""
    schedule_queued.status = ScheduleStatus.SENT
    schedule_queued.provider_message_id = 'mock-sms-test-abc123'
    schedule_queued.sent_time = timezone.now()
    schedule_queued.save()
    return schedule_queued


@pytest.fixture
def batch_sent_schedules(db, organisation, contacts, user):
    """A batch parent + 3 children, all SENT with the same provider_message_id."""
    parent = Schedule.objects.create(
        organisation=organisation,
        name='Batch Campaign',
        text='Hello batch',
        scheduled_time=timezone.now(),
        status=ScheduleStatus.SENT,
        format=MessageFormat.SMS,
        message_parts=1,
        provider_message_id='welcorp-job-999',
        sent_time=timezone.now(),
        created_by=user,
        updated_by=user,
    )
    children = []
    phones = ['0412111111', '0412222222', '0412333333']
    for i, contact in enumerate(contacts[:3]):
        child = Schedule.objects.create(
            organisation=organisation,
            parent=parent,
            contact=contact,
            phone=phones[i],
            text='Hello batch',
            scheduled_time=timezone.now(),
            status=ScheduleStatus.SENT,
            format=MessageFormat.SMS,
            message_parts=1,
            provider_message_id='welcorp-job-999',
            sent_time=timezone.now(),
            created_by=user,
            updated_by=user,
        )
        children.append(child)
    return parent, children


@pytest.fixture
def schedule_queued_at_max_retries(db, schedule_queued):
    """A RETRYING schedule that has hit max_retries."""
    schedule_queued.status = ScheduleStatus.RETRYING
    schedule_queued.retry_count = schedule_queued.max_retries
    schedule_queued.save()
    return schedule_queued


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

_SMS_SUCCESS = SendResult(
    success=True,
    message_id='mock-sms-123',
    message_parts=1,
)

_MMS_SUCCESS = SendResult(
    success=True,
    message_id='mock-mms-123',
    message_parts=1,
)


@pytest.fixture
def mock_sms_provider():
    """Mock the SMS provider (patched at app.celery where it is imported).

    Each send returns a UNIQUE provider message_id (uuid4) rather than a
    constant, so tests can exercise Schedule.provider_message_id uniqueness
    and delivery-callback idempotency. Still a Mock so call-count assertions
    (send_sms.assert_called_once()/assert_not_called()) keep working.
    """
    with patch('app.celery.get_sms_provider') as mock:
        provider = Mock()

        def mock_send_sms(*args, **kwargs):
            return SendResult(
                success=True, message_id=f'mock-sms-{uuid4().hex[:12]}', message_parts=1,
            )
        provider.send_sms.side_effect = mock_send_sms

        def mock_send_mms(*args, **kwargs):
            return SendResult(
                success=True, message_id=f'mock-mms-{uuid4().hex[:12]}', message_parts=1,
            )
        provider.send_mms.side_effect = mock_send_mms

        def mock_bulk_send(recipients, **kwargs):
            return {
                'success': True,
                'results': [
                    {'success': True, 'message_id': f'mock-sms-{uuid4().hex[:12]}', 'to': r['to']}
                    for r in recipients
                ],
                'error': None,
            }
        provider.send_bulk_sms.side_effect = mock_bulk_send

        def mock_bulk_mms_send(recipients, **kwargs):
            return {
                'success': True,
                'results': [
                    {'success': True, 'message_id': f'mock-mms-{uuid4().hex[:12]}', 'to': r['to']}
                    for r in recipients
                ],
                'error': None,
            }
        provider.send_bulk_mms.side_effect = mock_bulk_mms_send
        mock.return_value = provider
        yield provider


@pytest.fixture
def mock_sms_provider_transient_fail():
    """Mock provider that always returns a transient (retryable) failure."""
    with patch('app.celery.get_sms_provider') as mock:
        provider = Mock()
        result = SendResult(
            success=False,
            error='Service Unavailable',
            message_parts=1,
            http_status=503,
            retryable=True,
            failure_category='server_error',
        )
        provider.send_sms.return_value = result
        provider.send_mms.return_value = result
        mock.return_value = provider
        yield provider


@pytest.fixture
def mock_sms_provider_permanent_fail():
    """Mock provider that always returns a permanent (non-retryable) failure."""
    with patch('app.celery.get_sms_provider') as mock:
        provider = Mock()
        result = SendResult(
            success=False,
            error='Invalid phone number',
            message_parts=1,
            error_code='21211',
            http_status=400,
            failure_category='invalid_number',
        )
        provider.send_sms.return_value = result
        provider.send_mms.return_value = result
        mock.return_value = provider
        yield provider


@pytest.fixture
def mock_send_message_task():
    """Prevent Celery tasks from being dispatched in endpoint tests."""
    with patch('app.views.send_message_task') as mock:
        mock.delay = Mock()
        yield mock


@pytest.fixture
def mock_send_batch_message_task():
    """Prevent batch Celery tasks from being dispatched in endpoint tests."""
    with patch('app.views.send_batch_message_task') as mock:
        mock.delay = Mock()
        yield mock


@pytest.fixture
def mock_storage_provider():
    """Mock the storage provider with a real MockStorageProvider.

    Uses the real MockStorageProvider so file validation (type, size) works
    correctly, while avoiding Azure credentials.
    """
    real_provider = MockStorageProvider()
    with patch('app.views.get_storage_provider', return_value=real_provider):
        yield real_provider


@pytest.fixture
def propagate_app_logs():
    """Let pytest's caplog see records from the 'app.*' loggers.

    settings.LOGGING sets propagate=False on the 'app' logger (records go to its
    own console handler, not the root where caplog attaches). Tests that assert
    on real log output via caplog enable propagation for their duration.
    """
    app_logger = logging.getLogger('app')
    original = app_logger.propagate
    app_logger.propagate = True
    try:
        yield
    finally:
        app_logger.propagate = original


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
