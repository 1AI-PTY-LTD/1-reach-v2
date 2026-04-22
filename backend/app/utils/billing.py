"""
Billing utilities for the credit/usage system.

Two billing modes:
  - 'trial':      org has a dollar balance; sends are blocked when balance is exhausted.
  - 'subscribed': org has an active Clerk Billing subscription; sends are never balance-gated,
                  but usage is tracked per-format for end-of-month metered billing.

All monetary amounts are Decimal in dollars. The `format` parameter is a free-form string
('sms', 'mms', 'email_to_sms', ...) so new message types need no schema changes — only a
corresponding `{FORMAT}_RATE` setting and a new call site.
"""

import logging
import zoneinfo
from datetime import datetime
from decimal import Decimal

from django.conf import settings
from django.db import transaction as db_transaction
from django.db.models import F, Sum

from app.models import CreditTransaction, Config
from app.utils.metered_billing import InvoiceLineItem

logger = logging.getLogger(__name__)

ADELAIDE_TZ = zoneinfo.ZoneInfo('Australia/Adelaide')


def _month_start() -> datetime:
    now = datetime.now(ADELAIDE_TZ)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def grant_credits(org, amount: Decimal, description: str) -> Decimal:
    """Add dollar credit to org balance. Always succeeds. Returns the new balance."""
    with db_transaction.atomic():
        org.__class__.objects.filter(pk=org.pk).update(
            credit_balance=F('credit_balance') + amount
        )
        org.refresh_from_db(fields=['credit_balance'])

        CreditTransaction.objects.create(
            organisation=org,
            transaction_type=CreditTransaction.GRANT,
            amount=amount,
            balance_after=org.credit_balance,
            description=description,
            format=None,
            schedule=None,
            created_by=None,
        )

    logger.info(
        'Granted $%s to org %s. New balance: $%s',
        amount, org.clerk_org_id, org.credit_balance,
    )
    return org.credit_balance


def get_balance(org) -> Decimal:
    """Read the current credit_balance fresh from DB."""
    return org.__class__.objects.values_list('credit_balance', flat=True).get(pk=org.pk)


def get_rate(format: str) -> Decimal:
    """Return the per-unit billing rate for a message format (from settings)."""
    attr = f'{format.upper()}_RATE'
    rate = getattr(settings, attr, None)
    if rate is None:
        raise ValueError(f'No billing rate configured for format "{format}". Add {attr} to settings.')
    return Decimal(str(rate))


def get_monthly_usage(org, format: str) -> Decimal:
    """
    Sum CreditTransaction dollar amounts for a given format (eg SMS) this calendar month (Adelaide TZ).
    Covers both type=deduct and type=usage rows (not grants or refunds).
    """
    result = CreditTransaction.objects.filter(
        organisation=org,
        format=format,
        transaction_type__in=[CreditTransaction.DEDUCT, CreditTransaction.USAGE],
        created_at__gte=_month_start(),
    ).aggregate(total=Sum('amount'))['total']

    return result or Decimal('0.00')


def get_total_monthly_spend(org) -> Decimal:
    """
    Sum ALL CreditTransaction dollar amounts this month across all formats.
    Covers only per-message usage charges (type=deduct or type=usage).
    The flat Clerk Billing subscription fee is managed entirely by Clerk and is NOT included.
    """
    result = CreditTransaction.objects.filter(
        organisation=org,
        transaction_type__in=[CreditTransaction.DEDUCT, CreditTransaction.USAGE],
        created_at__gte=_month_start(),
    ).aggregate(total=Sum('amount'))['total']

    return result or Decimal('0.00')


def get_monthly_limit_info(org) -> dict:
    """
    Returns {current, limit, remaining} for the org's monthly spending cap.
    Reads Config(name='monthly_limit') — a single dollar cap for the whole org.
    current = total usage charges this month (not subscription fee).
    limit/remaining are None if no cap is configured (uncapped).
    """
    current = get_total_monthly_spend(org)

    config = Config.objects.filter(organisation=org, name='monthly_limit').first()
    if not config:
        return {'current': current, 'limit': None, 'remaining': None}

    limit = Decimal(config.value)
    return {
        'current': current,
        'limit': limit,
        'remaining': limit - current,
    }


def check_can_send(org, units: int, format: str) -> tuple:
    """
    Unified pre-send gate for any message format. Returns (allowed: bool, error: str | None).

    cost = units * get_rate(format)

    Checks (in order):
    0. Past-due billing — blocks all sends when subscription payment is overdue
    1. Monthly spending limit (both modes) — Config(name='monthly_limit')
    2. Dollar balance (trial mode only)

    Adding a new message type requires no changes here — just pass the new format string
    and ensure a corresponding {FORMAT}_RATE setting exists.
    """
    if org.billing_mode == org.BILLING_PAST_DUE:
        return False, 'Subscription payment is past due. Please update your billing details.'

    cost = Decimal(units) * get_rate(format)
    info = get_monthly_limit_info(org)

    if info['limit'] is not None and info['remaining'] < cost:
        return False, (
            f'Monthly spending limit reached '
            f'(${info["current"]:.2f} of ${info["limit"]:.2f})'
        )

    if org.billing_mode == org.BILLING_TRIAL:
        if get_balance(org) < cost:
            return False, 'Insufficient balance. Subscribe to continue sending.'

    return True, None


def record_usage(org, units: int, format: str, description: str, user=None, schedule=None) -> None:
    """
    Record a successful send. Cost = units * get_rate(format).

    trial mode:      SELECT FOR UPDATE → deduct credit_balance → INSERT type=deduct
    subscribed mode: INSERT type=usage, balance unchanged (tracked for Clerk Billing reporting)

    user: the User who initiated the send (request.user); None for system/webhook actions.
    """
    cost = Decimal(units) * get_rate(format)

    if org.billing_mode == org.BILLING_TRIAL:
        with db_transaction.atomic():
            locked_org = org.__class__.objects.select_for_update().get(pk=org.pk)
            new_balance = locked_org.credit_balance - cost
            org.__class__.objects.filter(pk=org.pk).update(
                credit_balance=F('credit_balance') - cost
            )
            CreditTransaction.objects.create(
                organisation=org,
                transaction_type=CreditTransaction.DEDUCT,
                amount=cost,
                balance_after=new_balance,
                description=description,
                format=format,
                schedule=schedule,
                created_by=user,
            )
    else:
        # subscribed mode — track usage without touching balance
        current_balance = get_balance(org)
        CreditTransaction.objects.create(
            organisation=org,
            transaction_type=CreditTransaction.USAGE,
            amount=cost,
            balance_after=current_balance,
            description=description,
            format=format,
            schedule=schedule,
            created_by=user,
        )

    logger.debug(
        'Recorded %s usage: %s units × $%s = $%s for org %s',
        format, units, get_rate(format), cost, org.clerk_org_id,
    )


def refund_usage(org, schedule) -> None:
    """Reverse the credit charge for a failed or undelivered send.

    Idempotent: if a REFUND transaction already exists for this schedule,
    this function is a no-op.

    trial mode:      SELECT FOR UPDATE → credit_balance += amount → INSERT type=refund
    subscribed mode: INSERT type=refund only (balance unchanged, corrects usage reporting)
    """
    if CreditTransaction.objects.filter(
        organisation=org,
        schedule=schedule,
        transaction_type=CreditTransaction.REFUND,
    ).exists():
        logger.debug('refund_usage: refund already exists for schedule %d, skipping', schedule.pk)
        return

    # Find the original charge for this schedule
    original_tx = CreditTransaction.objects.filter(
        organisation=org,
        schedule=schedule,
        transaction_type__in=[CreditTransaction.DEDUCT, CreditTransaction.USAGE],
    ).order_by('-created_at').first()

    if not original_tx:
        logger.warning(
            'refund_usage: no original charge found for schedule %d — nothing to refund',
            schedule.pk,
        )
        return

    amount = original_tx.amount
    failure_category = getattr(schedule, 'failure_category', None) or 'unknown'
    description = f'Refund: send failed ({failure_category})'

    if org.billing_mode == org.BILLING_TRIAL:
        with db_transaction.atomic():
            org.__class__.objects.filter(pk=org.pk).update(
                credit_balance=F('credit_balance') + amount
            )
            new_balance = org.__class__.objects.values_list('credit_balance', flat=True).get(pk=org.pk)
            CreditTransaction.objects.create(
                organisation=org,
                transaction_type=CreditTransaction.REFUND,
                amount=amount,
                balance_after=new_balance,
                description=description,
                format=getattr(schedule, 'format', None),
                schedule=schedule,
                created_by=None,
            )
    else:
        current_balance = get_balance(org)
        CreditTransaction.objects.create(
            organisation=org,
            transaction_type=CreditTransaction.REFUND,
            amount=amount,
            balance_after=current_balance,
            description=description,
            format=getattr(schedule, 'format', None),
            schedule=schedule,
            created_by=None,
        )

    logger.info(
        'Refunded $%s to org %s for failed schedule %d (%s)',
        amount, org.clerk_org_id, schedule.pk, failure_category,
    )


def build_line_items(org, period_start: datetime, period_end: datetime) -> list[InvoiceLineItem]:
    """Aggregate CreditTransaction records into invoice line items.

    Groups by format, nets usage minus refunds. Returns a list of
    InvoiceLineItem dataclasses, or an empty list if net usage is zero.
    """
    usage_qs = CreditTransaction.objects.filter(
        organisation=org,
        created_at__gte=period_start,
        created_at__lt=period_end,
        transaction_type__in=[CreditTransaction.USAGE, CreditTransaction.REFUND],
        format__isnull=False,
    )

    formats = usage_qs.values_list('format', flat=True).distinct()
    line_items = []

    for fmt in formats:
        usage_total = usage_qs.filter(
            format=fmt,
            transaction_type=CreditTransaction.USAGE,
        ).aggregate(total=Sum('amount'))['total'] or Decimal('0')

        refund_total = usage_qs.filter(
            format=fmt,
            transaction_type=CreditTransaction.REFUND,
        ).aggregate(total=Sum('amount'))['total'] or Decimal('0')

        net_amount = usage_total - refund_total
        if net_amount <= 0:
            continue

        rate = get_rate(fmt)
        quantity = int(net_amount / rate) if rate > 0 else 0

        line_items.append(InvoiceLineItem(
            description=f'{fmt.upper()} usage: {quantity} messages @ ${rate}',
            amount=net_amount,
            quantity=quantity,
            unit_amount=rate,
        ))

    return line_items


def get_current_month_preview(org) -> dict:
    """Build a preview of what the current month's invoice would look like.

    Uses the same aggregation logic as monthly invoice generation but for the
    current month-to-date (1st of month → now in Adelaide TZ).
    """
    period_start = _month_start()
    period_end = datetime.now(ADELAIDE_TZ)

    line_items = build_line_items(org, period_start, period_end)

    total = sum(item.amount for item in line_items)

    return {
        'total': str(total),
        'period_start': period_start.isoformat(),
        'period_end': period_end.isoformat(),
        'line_items': [
            {
                'format': item.description.split(' ')[0].lower(),
                'quantity': item.quantity,
                'rate': str(item.unit_amount),
                'amount': str(item.amount),
            }
            for item in line_items
        ],
    }
