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
from decimal import Decimal

from app.models import (
    Contact,
    ContactGroup,
    CreditTransaction,
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
    _handle_subscription_active as handle_billing_subscription_created,
    _handle_subscription_canceled as handle_billing_subscription_deleted,
    _handle_subscription_past_due as handle_billing_payment_failed,
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


# ============================================================================
# Organisation Created — Free Credits
# ============================================================================

@pytest.mark.django_db
class TestHandleOrganizationCreatedGrantsCredits:
    """Tests that organization.created grants free trial credits."""

    def test_grants_credits_on_create(self):
        """New org receives free trial credits."""
        data = {'id': 'org_new_billing', 'name': 'Billing Test Org', 'slug': 'billing-test'}

        handle_organization_created(data)

        org = Organisation.objects.get(clerk_org_id='org_new_billing')
        assert org.credit_balance > Decimal('0.00')

    def test_creates_grant_transaction(self):
        """A CreditTransaction(type=grant) is created for new org."""
        data = {'id': 'org_grant_tx', 'name': 'Grant Tx Org', 'slug': 'grant-tx'}

        handle_organization_created(data)

        org = Organisation.objects.get(clerk_org_id='org_grant_tx')
        tx = CreditTransaction.objects.filter(organisation=org, transaction_type='grant').first()
        assert tx is not None
        assert tx.amount > Decimal('0.00')

    def test_does_not_grant_credits_on_update(self):
        """Updating an existing org does not grant additional credits."""
        org = OrganisationFactory(clerk_org_id='org_existing', credit_balance=Decimal('5.00'))
        initial_balance = org.credit_balance

        data = {'id': 'org_existing', 'name': 'Updated Name', 'slug': 'updated'}
        handle_organization_created(data)

        org.refresh_from_db()
        # update_or_create with created=False should not add credits
        assert org.credit_balance == initial_balance


# ============================================================================
# Clerk Billing Webhook Handler Tests
# ============================================================================

@pytest.mark.django_db
class TestHandleSubscriptionActive:
    """Tests for subscription.active webhook handler."""

    def test_transitions_org_to_subscribed(self):
        """Org billing_mode is set to 'subscribed' when subscription created."""
        org = OrganisationFactory(
            clerk_org_id='org_sub_123',
            billing_mode=Organisation.BILLING_TRIAL,
        )

        handle_billing_subscription_created({'organization_id': 'org_sub_123'})

        org.refresh_from_db()
        assert org.billing_mode == Organisation.BILLING_SUBSCRIBED

    def test_handles_nested_org_id(self):
        """Handles payload with organization.id instead of organization_id."""
        org = OrganisationFactory(
            clerk_org_id='org_sub_nested',
            billing_mode=Organisation.BILLING_TRIAL,
        )

        handle_billing_subscription_created({'organization': {'id': 'org_sub_nested'}})

        org.refresh_from_db()
        assert org.billing_mode == Organisation.BILLING_SUBSCRIBED

    def test_noop_when_org_not_found(self):
        """No error raised when org does not exist."""
        # Should not raise
        handle_billing_subscription_created({'organization_id': 'org_nonexistent'})

    def test_noop_when_no_org_id(self):
        """No error raised when payload has no org id."""
        handle_billing_subscription_created({})


@pytest.mark.django_db
class TestHandleSubscriptionCanceled:
    """Tests for subscriptionItem.canceled/ended webhook handler."""

    def test_reverts_org_to_trial(self):
        """Org billing_mode is reverted to 'trial' when subscription cancelled."""
        org = OrganisationFactory(
            clerk_org_id='org_cancel_123',
            billing_mode=Organisation.BILLING_SUBSCRIBED,
        )

        handle_billing_subscription_deleted({'organization_id': 'org_cancel_123'})

        org.refresh_from_db()
        assert org.billing_mode == Organisation.BILLING_TRIAL

    def test_credit_balance_unchanged_on_cancellation(self):
        """Cancelling subscription does not touch credit_balance."""
        org = OrganisationFactory(
            clerk_org_id='org_cancel_balance',
            billing_mode=Organisation.BILLING_SUBSCRIBED,
            credit_balance=Decimal('3.50'),
        )

        handle_billing_subscription_deleted({'organization_id': 'org_cancel_balance'})

        org.refresh_from_db()
        assert org.credit_balance == Decimal('3.50')

    def test_noop_when_org_not_found(self):
        """No error raised when org does not exist."""
        handle_billing_subscription_deleted({'organization_id': 'org_nonexistent'})


@pytest.mark.django_db
class TestHandleSubscriptionPastDue:
    """Tests for subscription.past_due webhook handler."""

    def test_does_not_raise(self):
        """payment.failed stub completes without error."""
        handle_billing_payment_failed({'id': 'payment_123', 'organization_id': 'org_123'})

    def test_does_not_change_billing_mode(self):
        """payment.failed does not change org billing_mode (stub behaviour)."""
        org = OrganisationFactory(
            clerk_org_id='org_pay_fail',
            billing_mode=Organisation.BILLING_SUBSCRIBED,
        )

        handle_billing_payment_failed({'id': 'payment_fail', 'organization_id': 'org_pay_fail'})

        org.refresh_from_db()
        assert org.billing_mode == Organisation.BILLING_SUBSCRIBED
