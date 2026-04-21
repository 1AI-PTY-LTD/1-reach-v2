"""Tests for the Stripe metered billing provider (stripe.py)."""

import json
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock, Mock, patch

import pytest
import stripe

from app.utils.metered_billing import InvoiceLineItem
from app.utils.stripe import StripeMeteredBillingProvider


class TestStripeMeteredBillingProvider:
    def setup_method(self):
        self.provider = StripeMeteredBillingProvider(
            secret_key='sk_test_xxx',
            webhook_secret='whsec_test_xxx',
        )

    def test_requires_secret_key(self):
        with pytest.raises(ValueError, match='STRIPE_SECRET_KEY is required'):
            StripeMeteredBillingProvider(secret_key='')

    @patch('app.utils.stripe.stripe.Customer.search')
    def test_find_customer_by_org_success(self, mock_search):
        mock_customer = Mock()
        mock_customer.id = 'cus_abc123'
        mock_search.return_value = Mock(data=[mock_customer])

        result = self.provider.find_customer_by_org('org_test123')

        assert result.success is True
        assert result.customer_id == 'cus_abc123'
        mock_search.assert_called_once_with(
            query="metadata['organization_id']:'org_test123'",
        )

    @patch('app.utils.stripe.stripe.Customer.search')
    def test_find_customer_by_org_not_found(self, mock_search):
        mock_search.return_value = Mock(data=[])

        result = self.provider.find_customer_by_org('org_missing')

        assert result.success is False
        assert 'No Stripe customer found' in result.error

    @patch('app.utils.stripe.stripe.Customer.search')
    def test_find_customer_by_org_stripe_error(self, mock_search):
        mock_search.side_effect = stripe.StripeError('API error')

        result = self.provider.find_customer_by_org('org_test123')

        assert result.success is False
        assert 'API error' in result.error

    @patch('app.utils.stripe.stripe.Invoice.finalize_invoice')
    @patch('app.utils.stripe.stripe.InvoiceItem.create')
    @patch('app.utils.stripe.stripe.Invoice.create')
    def test_create_invoice_success(self, mock_inv_create, mock_item_create, mock_finalise):
        mock_inv_create.return_value = Mock(id='inv_123')
        mock_finalise.return_value = Mock(
            id='inv_123',
            hosted_invoice_url='https://invoice.stripe.com/inv_123',
            status='open',
        )

        items = [
            InvoiceLineItem('SMS usage: 10 msgs', Decimal('0.50'), 10, Decimal('0.05')),
            InvoiceLineItem('MMS usage: 2 msgs', Decimal('0.40'), 2, Decimal('0.20')),
        ]
        result = self.provider.create_invoice(
            customer_id='cus_abc',
            line_items=items,
            period_start=datetime(2026, 3, 1, tzinfo=timezone.utc),
            period_end=datetime(2026, 4, 1, tzinfo=timezone.utc),
        )

        assert result.success is True
        assert result.invoice_id == 'inv_123'
        assert result.invoice_url == 'https://invoice.stripe.com/inv_123'
        assert mock_item_create.call_count == 2
        # Verify amounts are in cents
        sms_call = mock_item_create.call_args_list[0]
        assert sms_call.kwargs['amount'] == 50  # $0.50 = 50 cents
        mms_call = mock_item_create.call_args_list[1]
        assert mms_call.kwargs['amount'] == 40  # $0.40 = 40 cents

    @patch('app.utils.stripe.stripe.Invoice.create')
    def test_create_invoice_stripe_error(self, mock_create):
        mock_create.side_effect = stripe.StripeError('Card declined')

        items = [InvoiceLineItem('SMS', Decimal('1.00'), 20, Decimal('0.05'))]
        result = self.provider.create_invoice(
            'cus_abc', items,
            datetime(2026, 3, 1, tzinfo=timezone.utc),
            datetime(2026, 4, 1, tzinfo=timezone.utc),
        )

        assert result.success is False
        assert 'Card declined' in result.error

    @patch('app.utils.stripe.stripe.Invoice.retrieve')
    def test_get_invoice_success(self, mock_retrieve):
        mock_retrieve.return_value = Mock(
            id='inv_123', hosted_invoice_url='https://x.com', status='paid',
        )
        result = self.provider.get_invoice('inv_123')
        assert result.success is True
        assert result.status == 'paid'

    @patch('app.utils.stripe.stripe.Invoice.void_invoice')
    def test_void_invoice_success(self, mock_void):
        mock_void.return_value = Mock(id='inv_123', status='void')
        result = self.provider.void_invoice('inv_123')
        assert result.success is True
        assert result.status == 'void'

    @patch('app.utils.stripe.stripe.Webhook.construct_event')
    def test_parse_webhook_success(self, mock_construct):
        mock_event = Mock()
        mock_event.type = 'invoice.paid'
        mock_event.data.object = stripe.StripeObject.construct_from(
            {'id': 'inv_123'}, key=None,
        )
        mock_construct.return_value = mock_event

        result = self.provider.parse_webhook(b'payload', 'sig_header')

        assert result['type'] == 'invoice.paid'
        assert isinstance(result['data'], dict)
        assert result['data']['id'] == 'inv_123'
        mock_construct.assert_called_once_with(b'payload', 'sig_header', 'whsec_test_xxx')

    @patch('app.utils.stripe.stripe.Webhook.construct_event')
    def test_parse_webhook_invalid_signature(self, mock_construct):
        mock_construct.side_effect = stripe.SignatureVerificationError('bad sig', 'sig')

        with pytest.raises(stripe.SignatureVerificationError):
            self.provider.parse_webhook(b'payload', 'bad_sig')
