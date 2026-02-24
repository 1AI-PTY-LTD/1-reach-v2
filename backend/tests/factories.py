"""
factory-boy factories for creating test data.

Provides factories for all models with realistic fake data using Faker.
Factories automatically handle ForeignKey relationships via SubFactory.

Usage:
    # Create with defaults
    user = UserFactory()

    # Override specific fields
    user = UserFactory(first_name='Alice')

    # Create batch
    users = UserFactory.create_batch(10)

    # Build without saving to database
    user = UserFactory.build()
"""

from datetime import timedelta

import factory
from django.utils import timezone
from django.utils.text import slugify
from factory.django import DjangoModelFactory

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


class UserFactory(DjangoModelFactory):
    """Factory for User model."""

    class Meta:
        model = User

    clerk_id = factory.Sequence(lambda n: f'user_{n:05d}')
    email = factory.Faker('email')
    first_name = factory.Faker('first_name')
    last_name = factory.Faker('last_name')


class OrganisationFactory(DjangoModelFactory):
    """Factory for Organisation model."""

    class Meta:
        model = Organisation

    clerk_org_id = factory.Sequence(lambda n: f'org_{n:05d}')
    name = factory.Faker('company')
    slug = factory.LazyAttribute(lambda obj: slugify(obj.name))
    is_active = True


class OrganisationMembershipFactory(DjangoModelFactory):
    """Factory for OrganisationMembership model."""

    class Meta:
        model = OrganisationMembership

    user = factory.SubFactory(UserFactory)
    organisation = factory.SubFactory(OrganisationFactory)
    role = 'member'
    is_active = True


class ContactFactory(DjangoModelFactory):
    """Factory for Contact model."""

    class Meta:
        model = Contact

    organisation = factory.SubFactory(OrganisationFactory)
    phone = factory.Sequence(lambda n: f'04{n:08d}')  # Valid AU mobile format
    first_name = factory.Faker('first_name')
    last_name = factory.Faker('last_name')
    email = factory.Faker('email')
    company = factory.Faker('company')
    is_active = True
    opt_out = False
    created_by = factory.SubFactory(UserFactory)
    updated_by = factory.SelfAttribute('created_by')


class ContactGroupFactory(DjangoModelFactory):
    """Factory for ContactGroup model."""

    class Meta:
        model = ContactGroup

    organisation = factory.SubFactory(OrganisationFactory)
    name = factory.Faker('catch_phrase')
    description = factory.Faker('sentence')
    is_active = True
    created_by = factory.SubFactory(UserFactory)
    updated_by = factory.SelfAttribute('created_by')


class ContactGroupMemberFactory(DjangoModelFactory):
    """Factory for ContactGroupMember model."""

    class Meta:
        model = ContactGroupMember

    contact = factory.SubFactory(ContactFactory)
    group = factory.SubFactory(ContactGroupFactory)


class TemplateFactory(DjangoModelFactory):
    """Factory for Template model."""

    class Meta:
        model = Template

    organisation = factory.SubFactory(OrganisationFactory)
    name = factory.Faker('sentence', nb_words=3)
    text = factory.Faker('sentence', nb_words=15)  # Max 320 chars
    version = 1
    is_active = True
    created_by = factory.SubFactory(UserFactory)
    updated_by = factory.SelfAttribute('created_by')


class ScheduleFactory(DjangoModelFactory):
    """Factory for Schedule model."""

    class Meta:
        model = Schedule

    organisation = factory.SubFactory(OrganisationFactory)
    text = factory.Faker('sentence', nb_words=10)
    scheduled_time = factory.LazyFunction(lambda: timezone.now() + timedelta(hours=1))
    status = ScheduleStatus.PENDING
    format = MessageFormat.SMS
    message_parts = 1
    created_by = factory.SubFactory(UserFactory)
    updated_by = factory.SelfAttribute('created_by')

    # Optional fields - set via Traits or explicit params
    contact = None
    group = None
    parent = None
    template = None
    phone = None
    subject = None
    media_url = None
    error = None
    sent_time = None

    class Params:
        """Traits for common schedule types."""

        # Trait: Contact schedule (individual message)
        for_contact = factory.Trait(
            contact=factory.SubFactory(ContactFactory, organisation=factory.SelfAttribute('..organisation')),
            phone=factory.LazyAttribute(lambda o: o.contact.phone if o.contact else None)
        )

        # Trait: Group schedule (parent)
        for_group = factory.Trait(
            group=factory.SubFactory(ContactGroupFactory, organisation=factory.SelfAttribute('..organisation')),
            name=factory.Faker('sentence', nb_words=3)
        )

        # Trait: MMS schedule
        as_mms = factory.Trait(
            format=MessageFormat.MMS,
            media_url='https://example.com/media/image.jpg',
            subject=factory.Faker('sentence', nb_words=3)
        )

        # Trait: Sent schedule
        sent = factory.Trait(
            status=ScheduleStatus.SENT,
            sent_time=factory.LazyFunction(timezone.now)
        )

        # Trait: Failed schedule
        failed = factory.Trait(
            status=ScheduleStatus.FAILED,
            error='Mock error message'
        )


class ConfigFactory(DjangoModelFactory):
    """Factory for Config model."""

    class Meta:
        model = Config

    organisation = factory.SubFactory(OrganisationFactory)
    name = factory.Sequence(lambda n: f'config_key_{n}')
    value = factory.Faker('word')


# ============================================================================
# Convenience Factory Functions
# ============================================================================

def create_org_with_user(org_name='Test Org', user_email='test@example.com', role='member'):
    """
    Create an organisation with a user membership.

    Returns:
        tuple: (organisation, user, membership)
    """
    org = OrganisationFactory(name=org_name)
    user = UserFactory(email=user_email)
    membership = OrganisationMembershipFactory(
        organisation=org,
        user=user,
        role=role
    )
    return org, user, membership


def create_contact_group_with_members(org, num_members=5, user=None):
    """
    Create a contact group with members.

    Args:
        org: Organisation instance
        num_members: Number of contacts to create
        user: User to set as created_by (optional)

    Returns:
        tuple: (group, list of contacts)
    """
    if not user:
        user = UserFactory()

    group = ContactGroupFactory(organisation=org, created_by=user, updated_by=user)
    contacts = ContactFactory.create_batch(
        num_members,
        organisation=org,
        created_by=user,
        updated_by=user
    )

    for contact in contacts:
        ContactGroupMemberFactory(contact=contact, group=group)

    return group, contacts


def create_group_schedule_with_children(org, num_contacts=5, user=None):
    """
    Create a group schedule with child schedules.

    Args:
        org: Organisation instance
        num_contacts: Number of child schedules to create
        user: User to set as created_by (optional)

    Returns:
        tuple: (parent_schedule, list of child schedules)
    """
    if not user:
        user = UserFactory()

    # Create group with members
    group, contacts = create_contact_group_with_members(org, num_contacts, user)

    # Create parent group schedule
    parent = ScheduleFactory(
        organisation=org,
        group=group,
        name='Bulk Campaign',
        text='Group message',
        created_by=user,
        updated_by=user
    )

    # Create child schedules
    children = []
    for contact in contacts:
        child = ScheduleFactory(
            organisation=org,
            parent=parent,
            contact=contact,
            phone=contact.phone,
            text=parent.text,
            scheduled_time=parent.scheduled_time,
            created_by=user,
            updated_by=user
        )
        children.append(child)

    return parent, children
