"""
Tests for Clerk webhook handler utilities.

Tests:
- handle_user_created: Creates User from webhook
- handle_user_updated: Updates User from webhook
- handle_user_deleted: Soft-deletes User
- handle_organization_created: Creates Organisation
- handle_organization_updated: Updates Organisation
- handle_organization_deleted: Soft-deletes Organisation and cascades
- handle_organization_membership_created: Creates OrganisationMembership
- handle_organization_membership_deleted: Soft-deletes OrganisationMembership
"""

import pytest

from app.models import (
    Contact,
    ContactGroup,
    Organisation,
    OrganisationMembership,
    Schedule,
    User,
)
from app.utils.clerk import (
    _handle_organisation_created as handle_organization_created,
    _handle_organisation_deleted as handle_organization_deleted,
    _handle_membership_created as handle_organization_membership_created,
    _handle_membership_deleted as handle_organization_membership_deleted,
    _handle_organisation_updated as handle_organization_updated,
    _handle_user_created as handle_user_created,
    _handle_user_deleted as handle_user_deleted,
    _handle_user_updated as handle_user_updated,
)
from tests.factories import (
    ContactFactory,
    ContactGroupFactory,
    OrganisationFactory,
    OrganisationMembershipFactory,
    ScheduleFactory,
    UserFactory,
)


# ============================================================================
# User Webhook Handler Tests
# ============================================================================

@pytest.mark.django_db
class TestHandleUserCreated:
    """Tests for handle_user_created webhook handler."""

    def test_creates_user(self):
        """user.created webhook creates User."""
        data = {
            'id': 'user_123',
            'first_name': 'John',
            'last_name': 'Doe',
            'email_addresses': [{'email_address': 'john@example.com'}]
        }

        handle_user_created(data)

        user = User.objects.get(clerk_id='user_123')
        assert user.first_name == 'John'
        assert user.last_name == 'Doe'
        assert user.email == 'john@example.com'

    def test_extracts_primary_email(self):
        """Extracts primary email from email_addresses array."""
        data = {
            'id': 'user_456',
            'first_name': 'Jane',
            'last_name': 'Smith',
            'email_addresses': [
                {'id': 'email_1', 'email_address': 'secondary@example.com'},
                {'id': 'email_2', 'email_address': 'primary@example.com'}
            ],
            'primary_email_address_id': 'email_2'
        }

        handle_user_created(data)

        user = User.objects.get(clerk_id='user_456')
        assert user.email == 'primary@example.com'

    def test_handles_no_email(self):
        """Handles user with no email gracefully."""
        data = {
            'id': 'user_789',
            'first_name': 'No',
            'last_name': 'Email',
            'email_addresses': []
        }

        handle_user_created(data)

        user = User.objects.get(clerk_id='user_789')
        assert user.email == ''


@pytest.mark.django_db
class TestHandleUserUpdated:
    """Tests for handle_user_updated webhook handler."""

    def test_updates_existing_user(self):
        """user.updated webhook updates existing User."""
        user = UserFactory(
            clerk_id='user_123',
            first_name='Old',
            last_name='Name'
        )

        data = {
            'id': 'user_123',
            'first_name': 'New',
            'last_name': 'Name',
            'email_addresses': [{'email_address': 'updated@example.com'}]
        }

        handle_user_updated(data)

        user.refresh_from_db()
        assert user.first_name == 'New'
        assert user.email == 'updated@example.com'

    def test_creates_if_not_exists(self):
        """Creates user if doesn't exist (idempotent)."""
        data = {
            'id': 'user_new',
            'first_name': 'Brand',
            'last_name': 'New',
            'email_addresses': [{'email_address': 'new@example.com'}]
        }

        handle_user_updated(data)

        user = User.objects.get(clerk_id='user_new')
        assert user.first_name == 'Brand'


@pytest.mark.django_db
class TestHandleUserDeleted:
    """Tests for handle_user_deleted webhook handler."""

    def test_soft_deletes_user(self):
        """user.deleted webhook soft-deletes User."""
        user = UserFactory(clerk_id='user_123')
        assert user.is_active is True

        data = {'id': 'user_123'}
        handle_user_deleted(data)

        user.refresh_from_db()
        assert user.is_active is False


# ============================================================================
# Organisation Webhook Handler Tests
# ============================================================================

@pytest.mark.django_db
class TestHandleOrganizationCreated:
    """Tests for handle_organization_created webhook handler."""

    def test_creates_organisation(self):
        """organization.created webhook creates Organisation."""
        data = {
            'id': 'org_123',
            'name': 'Acme Corp',
            'slug': 'acme-corp'
        }

        handle_organization_created(data)

        org = Organisation.objects.get(clerk_org_id='org_123')
        assert org.name == 'Acme Corp'
        assert org.slug == 'acme-corp'


@pytest.mark.django_db
class TestHandleOrganizationUpdated:
    """Tests for handle_organization_updated webhook handler."""

    def test_updates_existing_organisation(self):
        """organization.updated webhook updates Organisation."""
        org = OrganisationFactory(
            clerk_org_id='org_123',
            name='Old Name'
        )

        data = {
            'id': 'org_123',
            'name': 'New Name',
            'slug': 'new-slug'
        }

        handle_organization_updated(data)

        org.refresh_from_db()
        assert org.name == 'New Name'
        assert org.slug == 'new-slug'

    def test_creates_if_not_exists(self):
        """Creates org if doesn't exist (idempotent)."""
        data = {
            'id': 'org_new',
            'name': 'New Org',
            'slug': 'new-org'
        }

        handle_organization_updated(data)

        org = Organisation.objects.get(clerk_org_id='org_new')
        assert org.name == 'New Org'


@pytest.mark.django_db
class TestHandleOrganizationDeleted:
    """Tests for handle_organization_deleted webhook handler."""

    def test_soft_deletes_organisation(self):
        """organization.deleted webhook soft-deletes Organisation."""
        org = OrganisationFactory(clerk_org_id='org_123')
        assert org.is_active is True

        data = {'id': 'org_123'}
        handle_organization_deleted(data)

        org.refresh_from_db()
        assert org.is_active is False

    def test_cascades_to_related_objects(self):
        """Soft-deleting org cascades to contacts, groups, schedules."""
        org = OrganisationFactory(clerk_org_id='org_123')
        contact = ContactFactory(organisation=org)
        group = ContactGroupFactory(organisation=org)
        schedule = ScheduleFactory(organisation=org, for_contact=True)

        data = {'id': 'org_123'}
        handle_organization_deleted(data)

        org.refresh_from_db()
        contact.refresh_from_db()
        group.refresh_from_db()
        schedule.refresh_from_db()

        assert org.is_active is False
        assert contact.is_active is False
        assert group.is_active is False
        # Note: Schedule doesn't have is_active, cascade depends on implementation


# ============================================================================
# OrganisationMembership Webhook Handler Tests
# ============================================================================

@pytest.mark.django_db
class TestHandleOrganizationMembershipCreated:
    """Tests for handle_organization_membership_created webhook handler."""

    def test_creates_membership(self):
        """organizationMembership.created webhook creates membership."""
        user = UserFactory(clerk_id='user_123')
        org = OrganisationFactory(clerk_org_id='org_123')

        data = {
            'organization': {'id': 'org_123'},
            'public_user_data': {'user_id': 'user_123'},
            'role': 'admin'
        }

        handle_organization_membership_created(data)

        membership = OrganisationMembership.objects.get(
            user=user,
            organisation=org
        )
        assert membership.role == 'admin'



@pytest.mark.django_db
class TestHandleOrganizationMembershipDeleted:
    """Tests for handle_organization_membership_deleted webhook handler."""

    def test_soft_deletes_membership(self):
        """organizationMembership.deleted webhook soft-deletes membership."""
        user = UserFactory(clerk_id='user_123')
        org = OrganisationFactory(clerk_org_id='org_123')
        membership = OrganisationMembershipFactory(user=user, organisation=org)

        assert membership.is_active is True

        data = {
            'organization': {'id': 'org_123'},
            'public_user_data': {'user_id': 'user_123'}
        }

        handle_organization_membership_deleted(data)

        membership.refresh_from_db()
        assert membership.is_active is False
