"""
Tests for billing utilities.

Tests:
- grant_credits: Adds dollar credits to org balance
- get_balance: Reads current balance from DB
- check_can_send: Pre-send gate (monthly limit + trial balance)
- record_usage: Records billable sends (trial deducts, subscribed tracks)
- get_monthly_usage: Sums usage for a format this month
- get_total_monthly_spend: Sums all usage charges this month
"""

import pytest
from decimal import Decimal

from django.utils import timezone

from app.models import Organisation
from app.utils.billing import (
    check_can_send,
    get_balance,
    get_monthly_usage,
    get_total_monthly_spend,
    grant_credits,
    record_usage,
)
from tests.factories import ConfigFactory, OrganisationFactory, UserFactory


@pytest.mark.django_db
class TestGrantCredits:
    def test_adds_to_balance(self):
        org = OrganisationFactory(credit_balance=Decimal('0.00'))
        new_balance = grant_credits(org, Decimal('10.00'), 'Free trial')
        assert new_balance == Decimal('10.00')

    def test_creates_transaction(self):
        from app.models import CreditTransaction
        org = OrganisationFactory(credit_balance=Decimal('0.00'))
        grant_credits(org, Decimal('5.00'), 'Test grant')
        tx = CreditTransaction.objects.get(organisation=org, transaction_type='grant')
        assert tx.amount == Decimal('5.00')
        assert tx.balance_after == Decimal('5.00')
        assert tx.description == 'Test grant'
        assert tx.format is None
        assert tx.created_by is None

    def test_accumulates(self):
        org = OrganisationFactory(credit_balance=Decimal('5.00'))
        new_balance = grant_credits(org, Decimal('3.00'), 'Top-up')
        assert new_balance == Decimal('8.00')


@pytest.mark.django_db
class TestGetBalance:
    def test_reads_from_db(self):
        org = OrganisationFactory(credit_balance=Decimal('7.50'))
        assert get_balance(org) == Decimal('7.50')


@pytest.mark.django_db
class TestCheckCanSend:
    def test_trial_allows_when_sufficient_balance(self):
        org = OrganisationFactory(
            credit_balance=Decimal('1.00'),
            billing_mode=Organisation.BILLING_TRIAL,
        )
        allowed, error = check_can_send(org, units=1, format='sms')
        assert allowed is True
        assert error is None

    def test_trial_blocks_when_insufficient_balance(self):
        org = OrganisationFactory(
            credit_balance=Decimal('0.00'),
            billing_mode=Organisation.BILLING_TRIAL,
        )
        allowed, error = check_can_send(org, units=1, format='sms')
        assert allowed is False
        assert 'Insufficient balance' in error

    def test_subscribed_allows_with_zero_balance(self):
        org = OrganisationFactory(
            credit_balance=Decimal('0.00'),
            billing_mode=Organisation.BILLING_SUBSCRIBED,
        )
        allowed, error = check_can_send(org, units=1, format='sms')
        assert allowed is True
        assert error is None

    def test_monthly_limit_blocks_both_modes(self):
        for mode in [Organisation.BILLING_TRIAL, Organisation.BILLING_SUBSCRIBED]:
            org = OrganisationFactory(
                credit_balance=Decimal('100.00'),
                billing_mode=mode,
            )
            ConfigFactory(organisation=org, name='monthly_limit', value='0.01')
            allowed, error = check_can_send(org, units=1, format='sms')
            assert allowed is False
            assert 'Monthly spending limit' in error

    def test_allows_when_under_monthly_limit(self):
        org = OrganisationFactory(
            credit_balance=Decimal('100.00'),
            billing_mode=Organisation.BILLING_TRIAL,
        )
        ConfigFactory(organisation=org, name='monthly_limit', value='100.00')
        allowed, error = check_can_send(org, units=1, format='sms')
        assert allowed is True

    def test_multi_unit_cost_check(self):
        """Cost = units * rate; 10 SMS at $0.05 = $0.50."""
        org = OrganisationFactory(
            credit_balance=Decimal('0.40'),
            billing_mode=Organisation.BILLING_TRIAL,
        )
        allowed, error = check_can_send(org, units=10, format='sms')
        assert allowed is False
        assert 'Insufficient balance' in error


@pytest.mark.django_db
class TestRecordUsage:
    def test_trial_deducts_balance(self):
        org = OrganisationFactory(
            credit_balance=Decimal('1.00'),
            billing_mode=Organisation.BILLING_TRIAL,
        )
        record_usage(org, 1, format='sms', description='Test SMS')
        assert get_balance(org) == Decimal('0.95')  # 1.00 - 0.05

    def test_trial_creates_deduct_transaction(self):
        from app.models import CreditTransaction
        org = OrganisationFactory(
            credit_balance=Decimal('1.00'),
            billing_mode=Organisation.BILLING_TRIAL,
        )
        record_usage(org, 1, format='sms', description='Test SMS')
        tx = CreditTransaction.objects.get(organisation=org, transaction_type='deduct')
        assert tx.amount == Decimal('0.05')
        assert tx.format == 'sms'

    def test_subscribed_does_not_change_balance(self):
        org = OrganisationFactory(
            credit_balance=Decimal('10.00'),
            billing_mode=Organisation.BILLING_SUBSCRIBED,
        )
        record_usage(org, 1, format='sms', description='Test SMS')
        assert get_balance(org) == Decimal('10.00')

    def test_subscribed_creates_usage_transaction(self):
        from app.models import CreditTransaction
        org = OrganisationFactory(
            credit_balance=Decimal('0.00'),
            billing_mode=Organisation.BILLING_SUBSCRIBED,
        )
        record_usage(org, 1, format='mms', description='Test MMS')
        tx = CreditTransaction.objects.get(organisation=org, transaction_type='usage')
        assert tx.amount == Decimal('0.20')
        assert tx.format == 'mms'

    def test_records_created_by_user(self):
        from app.models import CreditTransaction
        user = UserFactory()
        org = OrganisationFactory(
            credit_balance=Decimal('1.00'),
            billing_mode=Organisation.BILLING_TRIAL,
        )
        record_usage(org, 1, format='sms', description='Test', user=user)
        tx = CreditTransaction.objects.get(organisation=org, transaction_type='deduct')
        assert tx.created_by == user

    def test_mms_rate_applied(self):
        org = OrganisationFactory(
            credit_balance=Decimal('1.00'),
            billing_mode=Organisation.BILLING_TRIAL,
        )
        record_usage(org, 1, format='mms', description='Test MMS')
        assert get_balance(org) == Decimal('0.80')  # 1.00 - 0.20


@pytest.mark.django_db
class TestGetMonthlyUsage:
    def test_sums_deduct_and_usage(self):
        org = OrganisationFactory(
            credit_balance=Decimal('10.00'),
            billing_mode=Organisation.BILLING_TRIAL,
        )
        record_usage(org, 2, format='sms', description='Send 1')
        record_usage(org, 1, format='sms', description='Send 2')
        total = get_monthly_usage(org, 'sms')
        assert total == Decimal('0.15')  # 3 * 0.05

    def test_excludes_other_formats(self):
        org = OrganisationFactory(
            credit_balance=Decimal('10.00'),
            billing_mode=Organisation.BILLING_TRIAL,
        )
        record_usage(org, 1, format='sms', description='SMS')
        record_usage(org, 1, format='mms', description='MMS')
        assert get_monthly_usage(org, 'sms') == Decimal('0.05')
        assert get_monthly_usage(org, 'mms') == Decimal('0.20')

    def test_returns_zero_when_no_usage(self):
        org = OrganisationFactory()
        assert get_monthly_usage(org, 'sms') == Decimal('0.00')


@pytest.mark.django_db
class TestGetTotalMonthlySpend:
    def test_sums_all_formats(self):
        org = OrganisationFactory(
            credit_balance=Decimal('10.00'),
            billing_mode=Organisation.BILLING_TRIAL,
        )
        record_usage(org, 1, format='sms', description='SMS')
        record_usage(org, 1, format='mms', description='MMS')
        total = get_total_monthly_spend(org)
        assert total == Decimal('0.25')  # 0.05 + 0.20

    def test_excludes_grants(self):
        org = OrganisationFactory(credit_balance=Decimal('0.00'))
        grant_credits(org, Decimal('10.00'), 'Grant')
        total = get_total_monthly_spend(org)
        assert total == Decimal('0.00')

    def test_returns_zero_when_no_usage(self):
        org = OrganisationFactory()
        assert get_total_monthly_spend(org) == Decimal('0.00')
