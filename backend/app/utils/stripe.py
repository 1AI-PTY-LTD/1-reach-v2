"""
Stripe implementation of the MeteredBillingProvider.

Also includes StripeWebhookView for handling Stripe webhook events
(invoice.paid, invoice.payment_failed, invoice.voided).
"""

import logging
from datetime import datetime
from decimal import Decimal

import stripe
from django.conf import settings
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from app.models import Invoice, Organisation
from app.utils.metered_billing import (
    CustomerResult,
    InvoiceLineItem,
    InvoiceResult,
    MeteredBillingProvider,
    get_billing_provider,
)

logger = logging.getLogger(__name__)


class StripeMeteredBillingProvider(MeteredBillingProvider):
    """Stripe implementation of the metered billing provider."""

    # Pin the Stripe API version to prevent breaking changes from new versions.
    # Update this deliberately when upgrading, after verifying compatibility.
    STRIPE_API_VERSION = '2026-03-25.dahlia'

    def __init__(self, secret_key: str, webhook_secret: str = ''):
        if not secret_key:
            raise ValueError('STRIPE_SECRET_KEY is required for StripeMeteredBillingProvider')
        self._secret_key = secret_key
        self._webhook_secret = webhook_secret
        stripe.api_key = secret_key
        stripe.api_version = self.STRIPE_API_VERSION

    def find_customer_by_org(self, org_id: str) -> CustomerResult:
        """Search Stripe for a customer with metadata.organization_id matching the Clerk org ID."""
        try:
            result = stripe.Customer.search(
                query=f"metadata['organization_id']:'{org_id}'",
            )
            if result.data:
                customer = result.data[0]
                return CustomerResult(success=True, customer_id=customer.id)
            return CustomerResult(
                success=False,
                error=f'No Stripe customer found for org {org_id}',
            )
        except stripe.StripeError as e:
            logger.warning(
                'Stripe customer search failed for org %s: %s',
                org_id, str(e), exc_info=True,
            )
            return CustomerResult(success=False, error=str(e))

    def create_invoice(
        self,
        customer_id: str,
        line_items: list[InvoiceLineItem],
        period_start: datetime,
        period_end: datetime,
        auto_send: bool = True,
    ) -> InvoiceResult:
        """Create a Stripe invoice with calculated line items."""
        try:
            # Create the invoice
            invoice = stripe.Invoice.create(
                customer=customer_id,
                auto_advance=auto_send,
                collection_method='charge_automatically',
                metadata={
                    'period_start': period_start.isoformat(),
                    'period_end': period_end.isoformat(),
                },
            )

            # Add line items
            for item in line_items:
                stripe.InvoiceItem.create(
                    customer=customer_id,
                    invoice=invoice.id,
                    amount=int(item.amount * 100),  # Stripe uses cents
                    currency='aud',
                    description=item.description,
                    metadata={
                        'quantity': str(item.quantity),
                        'unit_amount': str(item.unit_amount),
                    },
                )

            # Finalise the invoice
            finalised = stripe.Invoice.finalize_invoice(invoice.id)

            return InvoiceResult(
                success=True,
                invoice_id=finalised.id,
                invoice_url=finalised.hosted_invoice_url,
                status=finalised.status,
            )
        except stripe.StripeError as e:
            logger.error(
                'Failed to create Stripe invoice for customer %s: %s',
                customer_id, str(e), exc_info=True,
            )
            return InvoiceResult(success=False, error=str(e))

    def get_invoice(self, invoice_id: str) -> InvoiceResult:
        """Fetch current status of a Stripe invoice."""
        try:
            invoice = stripe.Invoice.retrieve(invoice_id)
            return InvoiceResult(
                success=True,
                invoice_id=invoice.id,
                invoice_url=invoice.hosted_invoice_url,
                status=invoice.status,
            )
        except stripe.StripeError as e:
            logger.warning(
                'Failed to retrieve Stripe invoice %s: %s',
                invoice_id, str(e), exc_info=True,
            )
            return InvoiceResult(success=False, error=str(e))

    def void_invoice(self, invoice_id: str) -> InvoiceResult:
        """Void a Stripe invoice."""
        try:
            invoice = stripe.Invoice.void_invoice(invoice_id)
            return InvoiceResult(
                success=True,
                invoice_id=invoice.id,
                status=invoice.status,
            )
        except stripe.StripeError as e:
            logger.warning(
                'Failed to void Stripe invoice %s: %s',
                invoice_id, str(e), exc_info=True,
            )
            return InvoiceResult(success=False, error=str(e))

    def parse_webhook(self, payload: bytes, signature: str) -> dict:
        """Parse and verify a Stripe webhook payload."""
        event = stripe.Webhook.construct_event(
            payload, signature, self._webhook_secret,
        )
        return {
            'type': event.type,
            'data': event.data.object,
        }


# ---------------------------------------------------------------------------
# Webhook view
# ---------------------------------------------------------------------------

class StripeWebhookView(APIView):
    """Handle Stripe webhook events for invoice status updates.

    Events handled:
      - invoice.paid → Invoice.status = 'paid'; restore org to subscribed if no other unpaid invoices
      - invoice.payment_failed → Invoice.status = 'uncollectable'; Organisation.billing_mode = 'past_due'
      - invoice.overdue → same as payment_failed (blocks sends before Stripe exhausts charge retries)
      - invoice.voided → Invoice.status = 'void'
    """
    authentication_classes = []
    permission_classes = []

    def post(self, request: Request) -> Response:
        payload = request.body
        signature = request.META.get('HTTP_STRIPE_SIGNATURE', '')

        provider = get_billing_provider()
        try:
            event = provider.parse_webhook(payload, signature)
        except (ValueError, stripe.SignatureVerificationError) as e:
            logger.warning('Stripe webhook signature verification failed: %s', e)
            return Response({'error': 'Invalid signature'}, status=400)

        event_type = event['type']
        invoice_data = event['data']
        invoice_id = invoice_data.get('id', '')

        if event_type == 'invoice.paid':
            self._handle_invoice_paid(invoice_id)
        elif event_type in ('invoice.payment_failed', 'invoice.overdue'):
            self._handle_invoice_payment_failed(invoice_id)
        elif event_type == 'invoice.voided':
            self._handle_invoice_voided(invoice_id)
        else:
            logger.debug('Ignoring Stripe event: %s', event_type)

        return Response({'status': 'ok'})

    def _handle_invoice_paid(self, invoice_id: str) -> None:
        updated = Invoice.objects.filter(
            provider_invoice_id=invoice_id,
        ).update(status=Invoice.STATUS_PAID)

        if updated:
            invoice = Invoice.objects.select_related('organisation').get(
                provider_invoice_id=invoice_id,
            )
            org = invoice.organisation
            if org.billing_mode == Organisation.BILLING_PAST_DUE:
                # Only restore to subscribed if no other uncollectable invoices
                # remain for this org. This prevents incorrectly restoring when:
                # - Clerk set past_due (subscription fee unpaid, not a Stripe invoice)
                # - Multiple invoices failed but only one was paid
                has_other_unpaid = Invoice.objects.filter(
                    organisation=org,
                    status=Invoice.STATUS_UNCOLLECTABLE,
                ).exclude(provider_invoice_id=invoice_id).exists()
                if not has_other_unpaid:
                    Organisation.objects.filter(pk=org.pk).update(
                        billing_mode=Organisation.BILLING_SUBSCRIBED,
                    )
                    logger.info(
                        'Restored org %s to subscribed after invoice %s paid',
                        org.clerk_org_id, invoice_id,
                    )
                else:
                    logger.info(
                        'Invoice %s paid for org %s but other unpaid invoices remain — keeping past_due',
                        invoice_id, org.clerk_org_id,
                    )
        else:
            logger.warning('invoice.paid: no matching invoice for %s', invoice_id)

    def _handle_invoice_payment_failed(self, invoice_id: str) -> None:
        updated = Invoice.objects.filter(
            provider_invoice_id=invoice_id,
        ).update(status=Invoice.STATUS_UNCOLLECTABLE)

        if updated:
            invoice = Invoice.objects.select_related('organisation').get(
                provider_invoice_id=invoice_id,
            )
            Organisation.objects.filter(pk=invoice.organisation.pk).update(
                billing_mode=Organisation.BILLING_PAST_DUE,
            )
            logger.warning(
                'Invoice payment failed for org %s (invoice %s) — set to past_due',
                invoice.organisation.clerk_org_id, invoice_id,
            )
        else:
            logger.warning('invoice.payment_failed: no matching invoice for %s', invoice_id)

    def _handle_invoice_voided(self, invoice_id: str) -> None:
        updated = Invoice.objects.filter(
            provider_invoice_id=invoice_id,
        ).update(status=Invoice.STATUS_VOID)
        if not updated:
            logger.warning('invoice.voided: no matching invoice for %s', invoice_id)
