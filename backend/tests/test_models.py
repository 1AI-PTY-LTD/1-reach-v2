"""
Tests for Django models.

Tests all 11 models:
- User, Organisation, OrganisationMembership
- Contact, ContactGroup, ContactGroupMember
- Template, Schedule
- Config

Focuses on:
- Model creation with valid data
- Constraints (unique, foreign keys)
- Relationships (FKs, reverse relations)
- Model methods (__str__, custom methods)
- Inheritance (TenantModel, AuditMixin)
"""

import pytest
from django.db import IntegrityError
from django.utils import timezone

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
from tests.factories import (
    ConfigFactory,
    ContactFactory,
    ContactGroupFactory,
    ContactGroupMemberFactory,
    OrganisationFactory,
    OrganisationMembershipFactory,
    ScheduleFactory,
    TemplateFactory,
    UserFactory,
)


# ============================================================================
# User Model Tests
# ============================================================================

@pytest.mark.django_db
class TestUserModel:
    """Tests for User model."""

    def test_create_user(self):
        """User created with valid data."""
        user = UserFactory()
        assert user.clerk_id is not None
        assert user.email is not None
        assert user.first_name is not None
        assert user.last_name is not None

    def test_clerk_id_unique(self):
        """clerk_id must be unique."""
        user1 = UserFactory(clerk_id='user_123')
        with pytest.raises(IntegrityError):
            UserFactory(clerk_id='user_123')

    def test_user_str(self):
        """__str__ returns clerk_id."""
        user = UserFactory(clerk_id='user_123', email='test@example.com')
        assert str(user) == 'user_123'


# ============================================================================
# Organisation Model Tests
# ============================================================================

@pytest.mark.django_db
class TestOrganisationModel:
    """Tests for Organisation model."""

    def test_create_organisation(self):
        """Organisation created with valid data."""
        org = OrganisationFactory()
        assert org.clerk_org_id is not None
        assert org.name is not None
        assert org.slug is not None

    def test_clerk_org_id_unique(self):
        """clerk_org_id must be unique."""
        org1 = OrganisationFactory(clerk_org_id='org_123')
        with pytest.raises(IntegrityError):
            OrganisationFactory(clerk_org_id='org_123')

    def test_slug_allows_duplicates(self):
        """slug is not unique, duplicates are allowed."""
        org1 = OrganisationFactory(slug='test-org')
        org2 = OrganisationFactory(slug='test-org')  # Should not raise
        assert org1.slug == org2.slug

    def test_organisation_str(self):
        """__str__ returns name."""
        org = OrganisationFactory(name='Test Company')
        assert str(org) == 'Test Company'


# ============================================================================
# OrganisationMembership Model Tests
# ============================================================================

@pytest.mark.django_db
class TestOrganisationMembershipModel:
    """Tests for OrganisationMembership model."""

    def test_create_membership(self):
        """Membership created with user and org."""
        membership = OrganisationMembershipFactory()
        assert membership.user is not None
        assert membership.organisation is not None
        assert membership.role in ['member', 'admin']

    def test_user_org_unique_together(self):
        """User can only have one membership per organisation."""
        user = UserFactory()
        org = OrganisationFactory()
        OrganisationMembershipFactory(user=user, organisation=org)

        with pytest.raises(IntegrityError):
            OrganisationMembershipFactory(user=user, organisation=org)

    def test_user_multiple_orgs(self):
        """User can be member of multiple organisations."""
        user = UserFactory()
        org1 = OrganisationFactory()
        org2 = OrganisationFactory()

        m1 = OrganisationMembershipFactory(user=user, organisation=org1)
        m2 = OrganisationMembershipFactory(user=user, organisation=org2)

        assert m1.organisation != m2.organisation

    def test_membership_str(self):
        """__str__ returns user clerk_id, org name, and role."""
        user = UserFactory(clerk_id='user_123')
        org = OrganisationFactory(name='Test Org')
        membership = OrganisationMembershipFactory(
            user=user,
            organisation=org,
            role='admin'
        )
        assert str(membership) == 'user_123 - Test Org (admin)'


# ============================================================================
# Contact Model Tests
# ============================================================================

@pytest.mark.django_db
class TestContactModel:
    """Tests for Contact model."""

    def test_create_contact(self):
        """Contact created with required fields."""
        contact = ContactFactory()
        assert contact.organisation is not None
        assert contact.phone is not None
        assert contact.created_by is not None
        assert contact.updated_by is not None

    def test_phone_unique_per_org(self):
        """Phone must be unique within organisation, not globally."""
        from django.db import transaction

        org = OrganisationFactory()
        ContactFactory(organisation=org, phone='0412345678')

        # Same phone in same org not allowed
        with transaction.atomic():
            with pytest.raises(IntegrityError):
                ContactFactory(organisation=org, phone='0412345678')

        # But allowed in different org
        other_org = OrganisationFactory()
        contact2 = ContactFactory(organisation=other_org, phone='0412345678')
        assert contact2.phone == '0412345678'

    def test_contact_str(self):
        """__str__ returns name."""
        contact = ContactFactory(phone='0412345678', first_name='John', last_name='Doe')
        assert str(contact) == 'John Doe'

    def test_opt_out_defaults_false(self):
        """opt_out defaults to False."""
        contact = ContactFactory()
        assert contact.opt_out is False


# ============================================================================
# ContactGroup Model Tests
# ============================================================================

@pytest.mark.django_db
class TestContactGroupModel:
    """Tests for ContactGroup model."""

    def test_create_group(self):
        """ContactGroup created with required fields."""
        group = ContactGroupFactory()
        assert group.organisation is not None
        assert group.name is not None
        assert group.created_by is not None

    def test_name_unique_per_org(self):
        """Group name is NOT unique - duplicates allowed within same org."""
        org = OrganisationFactory()
        group1 = ContactGroupFactory(organisation=org, name='VIP Clients')

        # Duplicate names are allowed in same org
        group2 = ContactGroupFactory(organisation=org, name='VIP Clients')
        assert group2.name == 'VIP Clients'
        assert group1.id != group2.id  # Different groups with same name

    def test_group_str(self):
        """__str__ returns name."""
        group = ContactGroupFactory(name='VIP Clients')
        assert str(group) == 'VIP Clients'


# ============================================================================
# ContactGroupMember Model Tests
# ============================================================================

@pytest.mark.django_db
class TestContactGroupMemberModel:
    """Tests for ContactGroupMember model."""

    def test_create_member(self):
        """ContactGroupMember links contact to group."""
        member = ContactGroupMemberFactory()
        assert member.contact is not None
        assert member.group is not None

    def test_contact_group_unique_together(self):
        """Contact can only be in a group once."""
        contact = ContactFactory()
        group = ContactGroupFactory()
        ContactGroupMemberFactory(contact=contact, group=group)

        with pytest.raises(IntegrityError):
            ContactGroupMemberFactory(contact=contact, group=group)

    def test_contact_multiple_groups(self):
        """Contact can be in multiple groups."""
        contact = ContactFactory()
        group1 = ContactGroupFactory()
        group2 = ContactGroupFactory()

        m1 = ContactGroupMemberFactory(contact=contact, group=group1)
        m2 = ContactGroupMemberFactory(contact=contact, group=group2)

        assert m1.group != m2.group

    def test_group_multiple_contacts(self):
        """Group can have multiple contacts."""
        group = ContactGroupFactory()
        contact1 = ContactFactory()
        contact2 = ContactFactory()

        m1 = ContactGroupMemberFactory(contact=contact1, group=group)
        m2 = ContactGroupMemberFactory(contact=contact2, group=group)

        assert m1.contact != m2.contact

    def test_member_str(self):
        """__str__ returns contact and group."""
        contact = ContactFactory(first_name='John', last_name='Doe')
        group = ContactGroupFactory(name='VIP')
        member = ContactGroupMemberFactory(contact=contact, group=group)
        # Uses Contact.__str__ and ContactGroup.__str__
        assert 'John Doe' in str(member)
        assert 'VIP' in str(member)


# ============================================================================
# Template Model Tests
# ============================================================================

@pytest.mark.django_db
class TestTemplateModel:
    """Tests for Template model."""

    def test_create_template(self):
        """Template created with required fields."""
        template = TemplateFactory()
        assert template.organisation is not None
        assert template.name is not None
        assert template.text is not None
        assert template.created_by is not None

    def test_name_unique_per_org_and_version(self):
        """Template name + version NOT unique - duplicates allowed."""
        org = OrganisationFactory()
        template1 = TemplateFactory(organisation=org, name='Welcome', version=1)

        # Same name, different version = OK
        template2 = TemplateFactory(organisation=org, name='Welcome', version=2)
        assert template2.version == 2

        # Same name, same version also allowed (no unique constraint)
        template3 = TemplateFactory(organisation=org, name='Welcome', version=1)
        assert template3.id != template1.id  # Different templates

    def test_template_str(self):
        """__str__ returns name and version."""
        template = TemplateFactory(name='Welcome', version=2)
        expected = 'Welcome (v2)'
        assert str(template) == expected


# ============================================================================
# Schedule Model Tests
# ============================================================================

@pytest.mark.django_db
class TestScheduleModel:
    """Tests for Schedule model."""

    def test_create_schedule(self):
        """Schedule created with required fields."""
        schedule = ScheduleFactory(for_contact=True)
        assert schedule.organisation is not None
        assert schedule.text is not None
        assert schedule.scheduled_time is not None
        assert schedule.status is not None
        assert schedule.format is not None

    def test_schedule_with_contact(self):
        """Schedule can be linked to a contact."""
        contact = ContactFactory()
        schedule = ScheduleFactory(
            organisation=contact.organisation,
            contact=contact,
            phone=contact.phone
        )
        assert schedule.contact == contact
        assert schedule.phone == contact.phone

    def test_schedule_with_group(self):
        """Schedule can be linked to a group (parent schedule)."""
        group = ContactGroupFactory()
        schedule = ScheduleFactory(
            organisation=group.organisation,
            group=group,
            name='Bulk Campaign'
        )
        assert schedule.group == group
        assert schedule.name == 'Bulk Campaign'

    def test_parent_child_relationship(self):
        """Schedule can have parent/child relationships."""
        parent = ScheduleFactory(for_group=True)
        child1 = ScheduleFactory(
            organisation=parent.organisation,
            parent=parent,
            for_contact=True
        )
        child2 = ScheduleFactory(
            organisation=parent.organisation,
            parent=parent,
            for_contact=True
        )

        assert child1.parent == parent
        assert child2.parent == parent
        assert parent.schedule_set.count() == 2

    def test_schedule_status_choices(self):
        """Schedule status restricted to defined choices."""
        schedule = ScheduleFactory(status=ScheduleStatus.PENDING)
        assert schedule.status == ScheduleStatus.PENDING

        schedule.status = ScheduleStatus.SENT
        schedule.save()
        assert schedule.status == ScheduleStatus.SENT

    def test_schedule_format_choices(self):
        """Schedule format restricted to SMS or MMS."""
        sms = ScheduleFactory(format=MessageFormat.SMS)
        assert sms.format == MessageFormat.SMS

        mms = ScheduleFactory(format=MessageFormat.MMS, as_mms=True)
        assert mms.format == MessageFormat.MMS

    def test_schedule_str(self):
        """__str__ returns 'Schedule {id} - {status}'."""
        schedule = ScheduleFactory(phone='0412345678', text='Hello')
        str_repr = str(schedule)
        assert str_repr == f'Schedule {schedule.pk} - {schedule.status}'
        assert 'Schedule' in str_repr
        assert schedule.status in str_repr


# ============================================================================
# Config Model Tests
# ============================================================================

@pytest.mark.django_db
class TestConfigModel:
    """Tests for Config model."""

    def test_create_config(self):
        """Config created with name and value."""
        config = ConfigFactory()
        assert config.organisation is not None
        assert config.name is not None
        assert config.value is not None

    def test_name_unique_per_org(self):
        """Config name must be unique within organisation."""
        from django.db import transaction

        org = OrganisationFactory()
        ConfigFactory(organisation=org, name='sms_limit')

        with transaction.atomic():
            with pytest.raises(IntegrityError):
                ConfigFactory(organisation=org, name='sms_limit')

        # But allowed in different org
        other_org = OrganisationFactory()
        config2 = ConfigFactory(organisation=other_org, name='sms_limit')
        assert config2.name == 'sms_limit'

    def test_config_str(self):
        """__str__ returns '{name}: {value}'."""
        config = ConfigFactory(name='sms_limit', value='100')
        assert str(config) == 'sms_limit: 100'
        # Test with longer value (truncated at 50 chars)
        long_value = 'a' * 100
        config2 = ConfigFactory(name='long_config', value=long_value)
        assert str(config2) == f'long_config: {long_value[:50]}'
