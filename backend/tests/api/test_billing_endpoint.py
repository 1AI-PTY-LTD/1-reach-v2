"""
Tests for Billing API endpoint (BillingViewSet).

Tests:
- GET /api/billing/summary/ requires admin role
- Returns correct billing_mode, balance, monthly_limit, total_monthly_spend
- monthly_usage_by_format populated from CreditTransactions
- Paginated transaction history
- Multi-tenancy isolation
"""

import pytest
from decimal import Decimal
from unittest.mock import patch

from rest_framework import status
from rest_framework.test import APIClient

from app.models import Organisation, User, OrganisationMembership
from app.utils.billing import grant_credits, record_usage
from tests.factories import ConfigFactory, OrganisationFactory, UserFactory


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_admin_client(user, organisation):
    """Return an APIClient authenticated as an org admin."""
    client = APIClient()
    client.force_authenticate(user=user)

    from rest_framework.views import APIView
    original_dispatch = APIView.dispatch

    def patched_dispatch(self, request, *args, **kwargs):
        request.org = organisation
        request.org_id = organisation.clerk_org_id
        request.org_role = 'admin'
        request.org_permissions = ['*']
        return original_dispatch(self, request, *args, **kwargs)

    APIView.dispatch = patched_dispatch
    return client, original_dispatch


@pytest.mark.django_db
class TestBillingSummaryPermissions:
    """Access control for GET /api/billing/summary/."""

    def test_requires_authentication(self, api_client):
        """Unauthenticated requests denied."""
        response = api_client.get('/api/billing/summary/')
        assert response.status_code in [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN]

    def test_member_denied(self, authenticated_client):
        """Non-admin members receive 403."""
        # authenticated_client uses org_role='member'
        response = authenticated_client.get('/api/billing/summary/')
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_admin_allowed(self, user, organisation, org_membership):
        """Admin members can access billing summary."""
        from rest_framework.views import APIView
        client, original_dispatch = make_admin_client(user, organisation)
        try:
            response = client.get('/api/billing/summary/')
            assert response.status_code == status.HTTP_200_OK
        finally:
            APIView.dispatch = original_dispatch


@pytest.mark.django_db
class TestBillingSummaryFields:
    """Response structure for GET /api/billing/summary/."""

    def setup_method(self):
        self._original_dispatch = None

    def teardown_method(self):
        if self._original_dispatch:
            from rest_framework.views import APIView
            APIView.dispatch = self._original_dispatch

    def _get_admin_response(self, user, organisation):
        from rest_framework.views import APIView
        client, original_dispatch = make_admin_client(user, organisation)
        self._original_dispatch = original_dispatch
        return client.get('/api/billing/summary/')

    def test_returns_required_fields(self, user, organisation, org_membership):
        """Summary response contains all required fields."""
        response = self._get_admin_response(user, organisation)

        assert response.status_code == status.HTTP_200_OK
        data = response.data
        assert 'billing_mode' in data
        assert 'balance' in data
        assert 'monthly_limit' in data
        assert 'total_monthly_spend' in data
        assert 'monthly_usage_by_format' in data
        assert 'results' in data
        assert 'pagination' in data

    def test_trial_billing_mode(self, user, organisation, org_membership):
        """Trial org shows billing_mode='trial' and current balance."""
        organisation.billing_mode = Organisation.BILLING_TRIAL
        organisation.credit_balance = Decimal('7.50')
        organisation.save()

        response = self._get_admin_response(user, organisation)

        assert response.data['billing_mode'] == 'trial'
        assert response.data['balance'] == '7.50'

    def test_subscribed_billing_mode(self, user, organisation, org_membership):
        """Subscribed org shows billing_mode='subscribed'."""
        organisation.billing_mode = Organisation.BILLING_SUBSCRIBED
        organisation.save()

        response = self._get_admin_response(user, organisation)

        assert response.data['billing_mode'] == 'subscribed'

    def test_monthly_limit_null_when_not_set(self, user, organisation, org_membership):
        """monthly_limit is null when no Config record exists."""
        response = self._get_admin_response(user, organisation)

        assert response.data['monthly_limit'] is None

    def test_monthly_limit_returned_when_set(self, user, organisation, org_membership):
        """monthly_limit matches Config value when set."""
        ConfigFactory(organisation=organisation, name='monthly_limit', value='25.00')

        response = self._get_admin_response(user, organisation)

        assert response.data['monthly_limit'] == '25.00'

    def test_total_monthly_spend_zero_with_no_usage(self, user, organisation, org_membership):
        """total_monthly_spend is '0.00' when no transactions exist."""
        response = self._get_admin_response(user, organisation)

        assert response.data['total_monthly_spend'] == '0.00'

    def test_total_monthly_spend_reflects_usage(self, user, organisation, org_membership):
        """total_monthly_spend sums usage transactions."""
        organisation.billing_mode = Organisation.BILLING_TRIAL
        organisation.credit_balance = Decimal('10.00')
        organisation.save()
        record_usage(organisation, 2, format='sms', description='SMS send', user=user)

        response = self._get_admin_response(user, organisation)

        # 2 × $0.05 = $0.10
        assert response.data['total_monthly_spend'] == '0.10'

    def test_monthly_usage_by_format_populated(self, user, organisation, org_membership):
        """monthly_usage_by_format contains entries for each format used."""
        organisation.billing_mode = Organisation.BILLING_TRIAL
        organisation.credit_balance = Decimal('10.00')
        organisation.save()
        record_usage(organisation, 1, format='sms', description='SMS', user=user)
        record_usage(organisation, 1, format='mms', description='MMS', user=user)

        response = self._get_admin_response(user, organisation)

        usage = response.data['monthly_usage_by_format']
        assert 'sms' in usage
        assert 'mms' in usage
        assert usage['sms']['spend'] == '0.05'
        assert usage['sms']['rate'] == '0.05'
        assert usage['mms']['spend'] == '0.20'
        assert usage['mms']['rate'] == '0.20'

    def test_empty_results_when_no_transactions(self, user, organisation, org_membership):
        """results list is empty when no transactions exist."""
        response = self._get_admin_response(user, organisation)

        assert response.data['results'] == []
        assert response.data['pagination']['total'] == 0

    def test_transaction_history_returned(self, user, organisation, org_membership):
        """Transaction history includes created transactions."""
        grant_credits(organisation, Decimal('5.00'), 'Test grant')

        response = self._get_admin_response(user, organisation)

        assert response.data['pagination']['total'] == 1
        tx = response.data['results'][0]
        assert tx['transaction_type'] == 'grant'
        assert tx['amount'] == '5.00'
        assert 'created_at' in tx

    def test_transaction_history_ordered_newest_first(self, user, organisation, org_membership):
        """Transactions ordered by newest first."""
        organisation.billing_mode = Organisation.BILLING_TRIAL
        organisation.credit_balance = Decimal('10.00')
        organisation.save()
        grant_credits(organisation, Decimal('1.00'), 'First')
        record_usage(organisation, 1, format='sms', description='Second', user=user)

        response = self._get_admin_response(user, organisation)

        results = response.data['results']
        assert len(results) == 2
        # Most recent (deduct) first
        assert results[0]['transaction_type'] == 'deduct'
        assert results[1]['transaction_type'] == 'grant'


@pytest.mark.django_db
class TestBillingSummaryMultiTenancy:
    """Billing summary only exposes data from the request org."""

    def teardown_method(self):
        from rest_framework.views import APIView
        if hasattr(self, '_original_dispatch'):
            APIView.dispatch = self._original_dispatch

    def test_other_org_transactions_excluded(self, user, organisation, org_membership):
        """Transactions from other orgs are not returned."""
        from rest_framework.views import APIView

        # Transactions in user's org
        grant_credits(organisation, Decimal('5.00'), 'My grant')

        # Transactions in another org
        other_org = OrganisationFactory()
        grant_credits(other_org, Decimal('100.00'), 'Other grant')

        client, original_dispatch = make_admin_client(user, organisation)
        self._original_dispatch = original_dispatch
        response = client.get('/api/billing/summary/')

        assert response.data['pagination']['total'] == 1
        assert response.data['results'][0]['amount'] == '5.00'
