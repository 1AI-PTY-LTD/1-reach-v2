"""
True concurrency tests for the money-handling paths.

These use real threads against the real database (transaction=True so each
thread sees committed rows), verifying the row locks and constraints that the
single-threaded billing tests cannot exercise:

- concurrent prepaid deductions can never drive the balance below zero
- concurrent refund attempts (delivery callback racing the reconciliation
  poll) can never refund the same charge twice
"""

import threading
from decimal import Decimal

import pytest
from django.db import connection
from django.utils import timezone

from app.models import CreditTransaction, MessageFormat, Organisation, Schedule, ScheduleStatus
from app.utils.billing import InsufficientBalanceError, record_usage, refund_usage
from tests.factories import OrganisationFactory, UserFactory


def _run_threads(target, count):
    """Run `target` in `count` threads; each closes its DB connection after."""
    errors = []

    def wrapped():
        try:
            target()
        except Exception as exc:  # surfaced via the errors list, not swallowed
            errors.append(exc)
        finally:
            connection.close()

    threads = [threading.Thread(target=wrapped) for _ in range(count)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return errors


@pytest.mark.django_db(transaction=True)
class TestBillingConcurrency:
    def test_concurrent_deductions_never_go_negative(self):
        """Four sends race for a balance that covers exactly one of them."""
        org = OrganisationFactory(
            billing_mode=Organisation.BILLING_PREPAID,
            credit_balance=Decimal('0.10'),  # exactly one SMS part
        )
        outcomes = []
        lock = threading.Lock()

        def attempt():
            try:
                record_usage(org, 1, 'sms', 'race deduction')
                with lock:
                    outcomes.append('charged')
            except InsufficientBalanceError:
                with lock:
                    outcomes.append('blocked')

        errors = _run_threads(attempt, 4)

        assert not errors, errors
        assert outcomes.count('charged') == 1
        assert outcomes.count('blocked') == 3
        org.refresh_from_db()
        assert org.credit_balance == Decimal('0.00')
        assert CreditTransaction.objects.filter(
            organisation=org, transaction_type=CreditTransaction.DEDUCT,
        ).count() == 1

    def test_concurrent_refunds_refund_the_charge_once(self):
        """A delivery callback racing the reconciliation poll must not double-refund."""
        org = OrganisationFactory(
            billing_mode=Organisation.BILLING_PREPAID,
            credit_balance=Decimal('10.00'),
        )
        user = UserFactory()
        schedule = Schedule.objects.create(
            organisation=org, phone='0412345678', text='Race',
            scheduled_time=timezone.now(), status=ScheduleStatus.FAILED,
            format=MessageFormat.SMS, message_parts=1,
            failure_category='invalid_number', created_by=user, updated_by=user,
        )
        record_usage(org, 1, 'sms', 'dispatch', user, schedule)

        errors = _run_threads(lambda: refund_usage(org, schedule), 4)

        assert not errors, errors
        org.refresh_from_db()
        assert org.credit_balance == Decimal('10.00')  # refunded exactly once
        assert CreditTransaction.objects.filter(
            organisation=org, schedule=schedule,
            transaction_type=CreditTransaction.REFUND,
        ).count() == 1
