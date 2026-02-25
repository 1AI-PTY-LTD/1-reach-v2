"""
Tests for django-filters filter classes.

Tests:
- ContactFilter: search, exclude_group_id
- ContactGroupFilter: search
- ScheduleFilter: date_from, date_to, status, group_id
- GroupScheduleFilter: date_from, date_to, group_id
"""

import pytest
from datetime import timedelta
from django.utils import timezone
import freezegun

from app.filters import ContactFilter, ContactGroupFilter, ScheduleFilter
from app.models import Contact, ContactGroup, Schedule, ScheduleStatus
from tests.factories import (
    ContactFactory,
    ContactGroupFactory,
    ContactGroupMemberFactory,
    OrganisationFactory,
    ScheduleFactory,
)


# ============================================================================
# ContactFilter Tests
# ============================================================================

@pytest.mark.django_db
class TestContactFilter:
    """Tests for ContactFilter."""

    def test_search_by_phone(self):
        """Search finds contacts by phone."""
        org = OrganisationFactory()
        contact1 = ContactFactory(organisation=org, phone='0412345678')
        contact2 = ContactFactory(organisation=org, phone='0487654321')

        filterset = ContactFilter(
            data={'search': '0412345678'},
            queryset=Contact.objects.filter(organisation=org)
        )

        assert contact1 in filterset.qs
        assert contact2 not in filterset.qs

    def test_search_by_name(self):
        """Search finds contacts by first or last name."""
        org = OrganisationFactory()
        contact1 = ContactFactory(organisation=org, first_name='Alice')
        contact2 = ContactFactory(organisation=org, first_name='Bob')

        filterset = ContactFilter(
            data={'search': 'Alice'},
            queryset=Contact.objects.filter(organisation=org)
        )

        assert contact1 in filterset.qs
        assert contact2 not in filterset.qs

    def test_exclude_group_id(self):
        """exclude_group_id filters out group members."""
        org = OrganisationFactory()
        group = ContactGroupFactory(organisation=org)
        contact1 = ContactFactory(organisation=org)
        contact2 = ContactFactory(organisation=org)

        # Add contact1 to group
        ContactGroupMemberFactory(group=group, contact=contact1)

        filterset = ContactFilter(
            data={'exclude_group_id': group.id},
            queryset=Contact.objects.filter(organisation=org)
        )

        assert contact1 not in filterset.qs  # In group, excluded
        assert contact2 in filterset.qs  # Not in group, included


# ============================================================================
# ContactGroupFilter Tests
# ============================================================================

@pytest.mark.django_db
class TestContactGroupFilter:
    """Tests for ContactGroupFilter."""

    def test_search_by_name(self):
        """Search finds groups by name."""
        org = OrganisationFactory()
        group1 = ContactGroupFactory(organisation=org, name='VIP Clients')
        group2 = ContactGroupFactory(organisation=org, name='Regular Customers')

        filterset = ContactGroupFilter(
            data={'search': 'VIP'},
            queryset=ContactGroup.objects.filter(organisation=org)
        )

        assert group1 in filterset.qs
        assert group2 not in filterset.qs

    def test_search_by_description(self):
        """Search finds groups by description."""
        org = OrganisationFactory()
        group1 = ContactGroupFactory(organisation=org, description='Premium members')
        group2 = ContactGroupFactory(organisation=org, description='Free tier')

        filterset = ContactGroupFilter(
            data={'search': 'Premium'},
            queryset=ContactGroup.objects.filter(organisation=org)
        )

        assert group1 in filterset.qs
        assert group2 not in filterset.qs


# ============================================================================
# ScheduleFilter Tests
# ============================================================================

@pytest.mark.django_db
class TestScheduleFilter:
    """Tests for ScheduleFilter."""

    def test_filter_by_date_from(self):
        """date_from filters schedules >= date."""
        org = OrganisationFactory()
        now = timezone.now()
        schedule1 = ScheduleFactory(
            organisation=org,
            scheduled_time=now,
            for_contact=True
        )
        schedule2 = ScheduleFactory(
            organisation=org,
            scheduled_time=now + timedelta(days=2),
            for_contact=True
        )

        # Filter from tomorrow
        filterset = ScheduleFilter(
            data={'date_from': (now + timedelta(days=1)).date().isoformat()},
            queryset=Schedule.objects.filter(organisation=org)
        )

        assert schedule1 not in filterset.qs  # Before date_from
        assert schedule2 in filterset.qs  # After date_from

    def test_filter_by_date_to(self):
        """date_to filters schedules <= date."""
        org = OrganisationFactory()
        now = timezone.now()
        schedule1 = ScheduleFactory(
            organisation=org,
            scheduled_time=now,
            for_contact=True
        )
        schedule2 = ScheduleFactory(
            organisation=org,
            scheduled_time=now + timedelta(days=2),
            for_contact=True
        )

        # Filter up to tomorrow
        filterset = ScheduleFilter(
            data={'date_to': (now + timedelta(days=1)).date().isoformat()},
            queryset=Schedule.objects.filter(organisation=org)
        )

        assert schedule1 in filterset.qs  # Before date_to
        assert schedule2 not in filterset.qs  # After date_to

    def test_filter_by_status(self):
        """Status filter works."""
        org = OrganisationFactory()
        schedule1 = ScheduleFactory(
            organisation=org,
            status=ScheduleStatus.PENDING,
            for_contact=True
        )
        schedule2 = ScheduleFactory(
            organisation=org,
            status=ScheduleStatus.SENT,
            for_contact=True
        )

        filterset = ScheduleFilter(
            data={'status': ScheduleStatus.SENT},
            queryset=Schedule.objects.filter(organisation=org)
        )

        assert schedule1 not in filterset.qs
        assert schedule2 in filterset.qs

    def test_default_today_filter(self):
        """Without date params, defaults to today in Adelaide timezone."""
        with freezegun.freeze_time('2024-01-15 10:00:00', tz_offset=-10.5):  # Adelaide
            org = OrganisationFactory()

            # Create schedules for today, yesterday, tomorrow
            now = timezone.now()
            today = ScheduleFactory(
                organisation=org,
                scheduled_time=now,
                for_contact=True
            )
            yesterday = ScheduleFactory(
                organisation=org,
                scheduled_time=now - timedelta(days=1),
                for_contact=True
            )
            tomorrow = ScheduleFactory(
                organisation=org,
                scheduled_time=now + timedelta(days=1),
                for_contact=True
            )

            # Filter without date params (should default to today)
            filterset = ScheduleFilter(
                data={},
                queryset=Schedule.objects.filter(organisation=org, parent=None)
            )

            assert today in filterset.qs
            assert yesterday not in filterset.qs
            assert tomorrow not in filterset.qs

    def test_invalid_timezone_fallback(self):
        """Invalid timezone parameter falls back to default Adelaide timezone."""
        with freezegun.freeze_time('2024-01-15 10:00:00', tz_offset=-10.5):  # Adelaide
            org = OrganisationFactory()
            now = timezone.now()
            today = ScheduleFactory(
                organisation=org,
                scheduled_time=now,
                for_contact=True
            )

            # Create a mock request with invalid timezone
            from django.test import RequestFactory
            request = RequestFactory().get('/?tz=Invalid/Timezone')

            # Filter with invalid timezone should fall back to Adelaide
            filterset = ScheduleFilter(
                data={},
                queryset=Schedule.objects.filter(organisation=org, parent=None),
                request=request
            )

            # Should still work with default timezone
            assert today in filterset.qs

    def test_default_filter_with_request(self):
        """Default filter uses timezone from request when provided."""
        with freezegun.freeze_time('2024-01-15 10:00:00', tz_offset=-10.5):  # Adelaide
            org = OrganisationFactory()
            now = timezone.now()
            today = ScheduleFactory(
                organisation=org,
                scheduled_time=now,
                for_contact=True
            )

            # Create a mock request with Adelaide timezone
            from django.test import RequestFactory
            request = RequestFactory().get('/?tz=Australia/Adelaide')

            # Filter with valid request should use _get_today with request
            filterset = ScheduleFilter(
                data={},
                queryset=Schedule.objects.filter(organisation=org, parent=None),
                request=request
            )

            # Should work with request timezone
            assert today in filterset.qs
