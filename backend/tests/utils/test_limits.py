"""
Tests for SMS/MMS limit checking utilities.

Tests:
- check_sms_limit: Monthly SMS limit enforcement
- check_mms_limit: Monthly MMS limit enforcement
- Adelaide timezone handling
"""

import pytest
from datetime import timedelta
from django.utils import timezone
from rest_framework.exceptions import ValidationError
import freezegun

from app.models import MessageFormat, ScheduleStatus
from app.utils.limits import check_mms_limit, check_sms_limit
from tests.factories import ConfigFactory, OrganisationFactory, ScheduleFactory


# ============================================================================
# SMS Limit Tests
# ============================================================================

@pytest.mark.django_db
class TestCheckSMSLimit:
    """Tests for check_sms_limit function."""

    def test_no_limit_if_config_missing(self):
        """No limit enforced if sms_limit config not set."""
        org = OrganisationFactory()

        # Create 100 SMS this month
        ScheduleFactory.create_batch(
            100,
            organisation=org,
            format=MessageFormat.SMS,
            scheduled_time=timezone.now()
        )

        # Should not raise (no limit configured)
        check_sms_limit(org)

    def test_allows_under_limit(self):
        """Sending under limit allowed."""
        org = OrganisationFactory()
        ConfigFactory(organisation=org, name='sms_limit', value='10')

        # Create 5 SMS this month
        ScheduleFactory.create_batch(
            5,
            organisation=org,
            format=MessageFormat.SMS,
            scheduled_time=timezone.now()
        )

        # Should not raise (5 < 10)
        check_sms_limit(org)

    def test_allows_at_limit_minus_one(self):
        """Sending at limit-1 allowed."""
        org = OrganisationFactory()
        ConfigFactory(organisation=org, name='sms_limit', value='10')

        # Create 9 SMS this month
        ScheduleFactory.create_batch(
            9,
            organisation=org,
            format=MessageFormat.SMS,
            scheduled_time=timezone.now()
        )

        # Should not raise (9 < 10)
        check_sms_limit(org)

    def test_denies_at_limit(self):
        """Sending at limit denied."""
        org = OrganisationFactory()
        ConfigFactory(organisation=org, name='sms_limit', value='10')

        # Create 10 SMS this month
        ScheduleFactory.create_batch(
            10,
            organisation=org,
            format=MessageFormat.SMS,
            scheduled_time=timezone.now()
        )

        # Should raise (10 >= 10)
        with pytest.raises(ValidationError) as exc_info:
            check_sms_limit(org)
        assert 'sms limit' in str(exc_info.value).lower()

    def test_denies_over_limit(self):
        """Sending over limit denied."""
        org = OrganisationFactory()
        ConfigFactory(organisation=org, name='sms_limit', value='5')

        # Create 10 SMS this month
        ScheduleFactory.create_batch(
            10,
            organisation=org,
            format=MessageFormat.SMS,
            scheduled_time=timezone.now()
        )

        # Should raise (10 > 5)
        with pytest.raises(ValidationError):
            check_sms_limit(org)

    def test_only_counts_current_month(self):
        """Only counts SMS sent in current month."""
        with freezegun.freeze_time('2024-02-15 10:00:00'):
            org = OrganisationFactory()
            ConfigFactory(organisation=org, name='sms_limit', value='5')

            # Create 3 SMS this month (February)
            ScheduleFactory.create_batch(
                3,
                organisation=org,
                format=MessageFormat.SMS,
                scheduled_time=timezone.now()
            )

            # Create 10 SMS last month (January) - should not count
            last_month = timezone.now() - timedelta(days=31)
            ScheduleFactory.create_batch(
                10,
                organisation=org,
                format=MessageFormat.SMS,
                scheduled_time=last_month
            )

            # Should not raise (only 3 in current month)
            check_sms_limit(org)

    def test_uses_adelaide_timezone(self):
        """Limit checking uses Adelaide timezone for month boundary."""
        # Test at month boundary in Adelaide timezone
        with freezegun.freeze_time('2024-02-01 00:30:00', tz_offset=-10.5):  # Adelaide
            org = OrganisationFactory()
            ConfigFactory(organisation=org, name='sms_limit', value='5')

            # This is Feb 1 in Adelaide, but still Jan 31 in UTC
            # Should count towards February, not January
            ScheduleFactory.create_batch(
                5,
                organisation=org,
                format=MessageFormat.SMS,
                scheduled_time=timezone.now()
            )

            # Should raise (5 in Feb)
            with pytest.raises(ValidationError):
                check_sms_limit(org)

    def test_only_counts_sms_not_mms(self):
        """Only counts SMS format, not MMS."""
        org = OrganisationFactory()
        ConfigFactory(organisation=org, name='sms_limit', value='5')

        # Create 3 SMS
        ScheduleFactory.create_batch(
            3,
            organisation=org,
            format=MessageFormat.SMS,
            scheduled_time=timezone.now()
        )

        # Create 10 MMS (should not count towards SMS limit)
        ScheduleFactory.create_batch(
            10,
            organisation=org,
            format=MessageFormat.MMS,
            scheduled_time=timezone.now()
        )

        # Should not raise (only 3 SMS)
        check_sms_limit(org)


# ============================================================================
# MMS Limit Tests
# ============================================================================

@pytest.mark.django_db
class TestCheckMMSLimit:
    """Tests for check_mms_limit function."""

    def test_no_limit_if_config_missing(self):
        """No limit enforced if mms_limit config not set."""
        org = OrganisationFactory()

        # Create 100 MMS this month
        ScheduleFactory.create_batch(
            100,
            organisation=org,
            format=MessageFormat.MMS,
            scheduled_time=timezone.now()
        )

        # Should not raise (no limit configured)
        check_mms_limit(org)

    def test_allows_under_limit(self):
        """Sending under limit allowed."""
        org = OrganisationFactory()
        ConfigFactory(organisation=org, name='mms_limit', value='10')

        # Create 5 MMS this month
        ScheduleFactory.create_batch(
            5,
            organisation=org,
            format=MessageFormat.MMS,
            scheduled_time=timezone.now()
        )

        # Should not raise (5 < 10)
        check_mms_limit(org)

    def test_denies_at_limit(self):
        """Sending at limit denied."""
        org = OrganisationFactory()
        ConfigFactory(organisation=org, name='mms_limit', value='10')

        # Create 10 MMS this month
        ScheduleFactory.create_batch(
            10,
            organisation=org,
            format=MessageFormat.MMS,
            scheduled_time=timezone.now()
        )

        # Should raise (10 >= 10)
        with pytest.raises(ValidationError) as exc_info:
            check_mms_limit(org)
        assert 'mms limit' in str(exc_info.value).lower()

    def test_only_counts_mms_not_sms(self):
        """Only counts MMS format, not SMS."""
        org = OrganisationFactory()
        ConfigFactory(organisation=org, name='mms_limit', value='5')

        # Create 3 MMS
        ScheduleFactory.create_batch(
            3,
            organisation=org,
            format=MessageFormat.MMS,
            scheduled_time=timezone.now()
        )

        # Create 10 SMS (should not count towards MMS limit)
        ScheduleFactory.create_batch(
            10,
            organisation=org,
            format=MessageFormat.SMS,
            scheduled_time=timezone.now()
        )

        # Should not raise (only 3 MMS)
        check_mms_limit(org)

    def test_uses_adelaide_timezone(self):
        """MMS limit checking uses Adelaide timezone."""
        with freezegun.freeze_time('2024-02-01 00:30:00', tz_offset=-10.5):  # Adelaide
            org = OrganisationFactory()
            ConfigFactory(organisation=org, name='mms_limit', value='5')

            ScheduleFactory.create_batch(
                5,
                organisation=org,
                format=MessageFormat.MMS,
                scheduled_time=timezone.now()
            )

            # Should raise (5 in current month)
            with pytest.raises(ValidationError):
                check_mms_limit(org)
