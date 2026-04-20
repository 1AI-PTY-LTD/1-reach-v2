"""Tests for the Stripe webhook endpoint (StripeWebhookView)."""

import json
from decimal import Decimal
from datetime import datetime, timezone
from unittest.mock import patch, Mock

import pytest
import stripe
from rest_framework.test import APIClient

from app.models import Invoice, Organisation


@pytest.fixture
def webhook_client():
    """Unauthenticated client (Stripe webhooks have no auth — signature verified)."""
    return APIClient()


@pytest.fixture
def org_with_invoice(db):
    org = Organisation.objects.create(
        clerk_org_id='org_wh_test',
        name='Webhook Test Org',
        billing_mode=Organisation.BILLING_SUBSCRIBED,
        billing_customer_id='cus_wh_test',
    )
    invoice = Invoice.objects.create(
        organisation=org,
        provider_invoice_id='inv_test_123',
        status=Invoice.STATUS_OPEN,
        amount=Decimal('5.00'),
        period_start=datetime(2026, 3, 1, tzinfo=timezone.utc),
        period_end=datetime(2026, 4, 1, tzinfo=timezone.utc),
    )
    return org, invoice


@pytest.mark.django_db
class TestStripeWebhookView:
    @patch('app.utils.stripe.get_billing_provider')
    def test_invoice_paid_updates_status(self, mock_get_provider, webhook_client, org_with_invoice):
        org, invoice = org_with_invoice
        mock_provider = Mock()
        mock_provider.parse_webhook.return_value = {
            'type': 'invoice.paid',
            'data': {'id': 'inv_test_123'},
        }
        mock_get_provider.return_value = mock_provider

        response = webhook_client.post(
            '/api/webhooks/stripe/',
            data=b'{}',
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig_test',
        )

        assert response.status_code == 200
        invoice.refresh_from_db()
        assert invoice.status == Invoice.STATUS_PAID

    @patch('app.utils.stripe.get_billing_provider')
    def test_invoice_paid_restores_subscribed_from_past_due(self, mock_get_provider, webhook_client, org_with_invoice):
        org, invoice = org_with_invoice
        # Set org to past_due
        Organisation.objects.filter(pk=org.pk).update(billing_mode=Organisation.BILLING_PAST_DUE)

        mock_provider = Mock()
        mock_provider.parse_webhook.return_value = {
            'type': 'invoice.paid',
            'data': {'id': 'inv_test_123'},
        }
        mock_get_provider.return_value = mock_provider

        response = webhook_client.post(
            '/api/webhooks/stripe/',
            data=b'{}',
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig_test',
        )

        assert response.status_code == 200
        org.refresh_from_db()
        assert org.billing_mode == Organisation.BILLING_SUBSCRIBED

    @patch('app.utils.stripe.get_billing_provider')
    def test_invoice_payment_failed_sets_past_due(self, mock_get_provider, webhook_client, org_with_invoice):
        org, invoice = org_with_invoice
        mock_provider = Mock()
        mock_provider.parse_webhook.return_value = {
            'type': 'invoice.payment_failed',
            'data': {'id': 'inv_test_123'},
        }
        mock_get_provider.return_value = mock_provider

        response = webhook_client.post(
            '/api/webhooks/stripe/',
            data=b'{}',
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig_test',
        )

        assert response.status_code == 200
        invoice.refresh_from_db()
        assert invoice.status == Invoice.STATUS_UNCOLLECTABLE
        org.refresh_from_db()
        assert org.billing_mode == Organisation.BILLING_PAST_DUE

    @patch('app.utils.stripe.get_billing_provider')
    def test_invoice_voided_updates_status(self, mock_get_provider, webhook_client, org_with_invoice):
        _, invoice = org_with_invoice
        mock_provider = Mock()
        mock_provider.parse_webhook.return_value = {
            'type': 'invoice.voided',
            'data': {'id': 'inv_test_123'},
        }
        mock_get_provider.return_value = mock_provider

        response = webhook_client.post(
            '/api/webhooks/stripe/',
            data=b'{}',
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig_test',
        )

        assert response.status_code == 200
        invoice.refresh_from_db()
        assert invoice.status == Invoice.STATUS_VOID

    @patch('app.utils.stripe.get_billing_provider')
    def test_invalid_signature_returns_400(self, mock_get_provider, webhook_client):
        mock_provider = Mock()
        mock_provider.parse_webhook.side_effect = stripe.SignatureVerificationError('bad', 'sig')
        mock_get_provider.return_value = mock_provider

        response = webhook_client.post(
            '/api/webhooks/stripe/',
            data=b'{}',
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='bad_sig',
        )

        assert response.status_code == 400

    @patch('app.utils.stripe.get_billing_provider')
    def test_unknown_event_returns_200(self, mock_get_provider, webhook_client):
        mock_provider = Mock()
        mock_provider.parse_webhook.return_value = {
            'type': 'customer.created',
            'data': {'id': 'cus_123'},
        }
        mock_get_provider.return_value = mock_provider

        response = webhook_client.post(
            '/api/webhooks/stripe/',
            data=b'{}',
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig_test',
        )

        assert response.status_code == 200

    @patch('app.utils.stripe.get_billing_provider')
    def test_invoice_paid_unknown_invoice_logs_warning(self, mock_get_provider, webhook_client, db):
        mock_provider = Mock()
        mock_provider.parse_webhook.return_value = {
            'type': 'invoice.paid',
            'data': {'id': 'inv_nonexistent'},
        }
        mock_get_provider.return_value = mock_provider

        response = webhook_client.post(
            '/api/webhooks/stripe/',
            data=b'{}',
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig_test',
        )

        # Should still return 200 (don't retry unknown invoices)
        assert response.status_code == 200
