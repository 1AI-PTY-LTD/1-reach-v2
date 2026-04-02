"""
Tests for the process_delivery_event Celery task.

The task is provider-agnostic and supports both 'delivered' and 'failed' events.
Welcorp only produces 'failed' callbacks (their SENT status is skipped at the
provider layer), but other future providers may support true delivery confirmation.

Tests:
- Single send: SENT → DELIVERED on delivered event
- Single send: SENT → FAILED on failed event with refund
- Batch send: correct child found by phone
- Batch send: parent status sync (DELIVERED, FAILED, SENT)
- Idempotent: already-DELIVERED schedule skipped
- Edge cases: schedule not found, missing ID, unknown status
"""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import Mock, patch

import pytest
from django.utils import timezone

from app.celery import process_delivery_event
from app.models import CreditTransaction, Schedule, ScheduleStatus
from app.utils.billing import grant_credits


@pytest.mark.django_db
class TestProcessDeliveryEventSingleSend:
    """Delivery events for single-recipient sends."""

    def test_delivered_event_sets_delivered_status(self, schedule_sent):
        result = process_delivery_event({
            'provider_message_id': schedule_sent.provider_message_id,
            'status': 'delivered',
            'recipient_phone': schedule_sent.phone,
            'timestamp': '2026-04-02T10:30:00+10:00',
        })

        schedule_sent.refresh_from_db()
        assert schedule_sent.status == ScheduleStatus.DELIVERED
        assert schedule_sent.delivered_time is not None
        assert result == {'schedule_id': schedule_sent.pk, 'status': 'delivered'}

    def test_delivered_event_without_timestamp_uses_now(self, schedule_sent):
        before = timezone.now()
        process_delivery_event({
            'provider_message_id': schedule_sent.provider_message_id,
            'status': 'delivered',
            'recipient_phone': schedule_sent.phone,
        })

        schedule_sent.refresh_from_db()
        assert schedule_sent.delivered_time >= before

    def test_failed_event_sets_failed_status(self, schedule_sent, organisation):
        # Grant credits so refund has something to reverse
        grant_credits(organisation, Decimal('10.00'), 'test')

        # Record initial usage
        from app.utils.billing import record_usage
        record_usage(organisation, 1, 'sms', 'test send', schedule=schedule_sent)

        result = process_delivery_event({
            'provider_message_id': schedule_sent.provider_message_id,
            'status': 'failed',
            'recipient_phone': schedule_sent.phone,
            'error_code': 'INVN',
            'error_message': 'Welcorp delivery failed: INVN',
        })

        schedule_sent.refresh_from_db()
        assert schedule_sent.status == ScheduleStatus.FAILED
        assert schedule_sent.failure_category is not None
        assert schedule_sent.error == 'Welcorp delivery failed: INVN'
        assert result == {'schedule_id': schedule_sent.pk, 'status': 'failed'}

    def test_failed_event_calls_refund(self, schedule_sent, organisation):
        grant_credits(organisation, Decimal('10.00'), 'test')
        from app.utils.billing import record_usage
        record_usage(organisation, 1, 'sms', 'test send', schedule=schedule_sent)

        process_delivery_event({
            'provider_message_id': schedule_sent.provider_message_id,
            'status': 'failed',
            'error_code': 'BARR',
            'error_message': 'Welcorp delivery failed: BARR',
        })

        assert CreditTransaction.objects.filter(
            schedule=schedule_sent,
            transaction_type=CreditTransaction.REFUND,
        ).exists()

    def test_idempotent_already_delivered(self, schedule_sent):
        schedule_sent.status = ScheduleStatus.DELIVERED
        schedule_sent.delivered_time = timezone.now()
        schedule_sent.save()

        result = process_delivery_event({
            'provider_message_id': schedule_sent.provider_message_id,
            'status': 'delivered',
            'recipient_phone': schedule_sent.phone,
        })

        assert result['skipped'] is True
        assert result['reason'] == 'schedule_not_found'

    def test_schedule_not_found(self):
        result = process_delivery_event({
            'provider_message_id': 'nonexistent-id',
            'status': 'delivered',
        })

        assert result['skipped'] is True
        assert result['reason'] == 'schedule_not_found'

    def test_missing_provider_message_id(self):
        result = process_delivery_event({
            'status': 'delivered',
        })

        assert result['skipped'] is True
        assert result['reason'] == 'missing provider_message_id'

    def test_unknown_status_skipped(self, schedule_sent):
        result = process_delivery_event({
            'provider_message_id': schedule_sent.provider_message_id,
            'status': 'unknown_status',
            'recipient_phone': schedule_sent.phone,
        })

        assert result['skipped'] is True
        schedule_sent.refresh_from_db()
        assert schedule_sent.status == ScheduleStatus.SENT


@pytest.mark.django_db
class TestProcessDeliveryEventBatchSend:
    """Delivery events for batch (multi-recipient) sends."""

    def test_correct_child_found_by_phone(self, batch_sent_schedules):
        parent, children = batch_sent_schedules

        result = process_delivery_event({
            'provider_message_id': 'welcorp-job-999',
            'status': 'delivered',
            'recipient_phone': '0412222222',
            'timestamp': '2026-04-02T10:30:00+10:00',
        })

        # Only the matching child should be updated
        children[1].refresh_from_db()
        assert children[1].status == ScheduleStatus.DELIVERED

        children[0].refresh_from_db()
        assert children[0].status == ScheduleStatus.SENT

    def test_parent_delivered_when_all_children_delivered(self, batch_sent_schedules):
        parent, children = batch_sent_schedules

        for child in children:
            process_delivery_event({
                'provider_message_id': 'welcorp-job-999',
                'status': 'delivered',
                'recipient_phone': child.phone,
            })

        parent.refresh_from_db()
        assert parent.status == ScheduleStatus.DELIVERED

    def test_parent_stays_sent_when_partial_delivered(self, batch_sent_schedules):
        parent, children = batch_sent_schedules

        # Deliver only the first child — rest are still SENT
        process_delivery_event({
            'provider_message_id': 'welcorp-job-999',
            'status': 'delivered',
            'recipient_phone': children[0].phone,
        })

        parent.refresh_from_db()
        # Mix of DELIVERED + SENT — all terminal but not all DELIVERED
        assert parent.status == ScheduleStatus.SENT

    def test_parent_failed_when_any_child_fails(self, batch_sent_schedules):
        parent, children = batch_sent_schedules

        # Deliver first two
        for child in children[:2]:
            process_delivery_event({
                'provider_message_id': 'welcorp-job-999',
                'status': 'delivered',
                'recipient_phone': child.phone,
            })

        # Fail the third
        process_delivery_event({
            'provider_message_id': 'welcorp-job-999',
            'status': 'failed',
            'recipient_phone': children[2].phone,
            'error_code': 'INVN',
            'error_message': 'Welcorp delivery failed: INVN',
        })

        parent.refresh_from_db()
        assert parent.status == ScheduleStatus.FAILED

    def test_parent_sent_with_mixed_sent_delivered(self, batch_sent_schedules):
        """If some children are DELIVERED and others still SENT, parent is SENT (all terminal, not all delivered)."""
        parent, children = batch_sent_schedules

        # Deliver two of three — third stays SENT
        for child in children[:2]:
            process_delivery_event({
                'provider_message_id': 'welcorp-job-999',
                'status': 'delivered',
                'recipient_phone': child.phone,
            })

        parent.refresh_from_db()
        assert parent.status == ScheduleStatus.SENT


@pytest.mark.django_db
class TestReconcileStaleSent:
    """Tests for the reconcile_stale_sent beat task (polls provider for status)."""

    def test_stale_schedule_triggers_poll(self, schedule_sent):
        from app.celery import reconcile_stale_sent
        from app.utils.sms import DeliveryEvent

        schedule_sent.sent_time = timezone.now() - timedelta(hours=25)
        schedule_sent.save()

        mock_event = DeliveryEvent(
            provider_message_id=schedule_sent.provider_message_id,
            status='failed',
            recipient_phone=schedule_sent.phone,
            error_code='EXPD',
            error_message='Welcorp delivery failed: EXPD',
            raw_status='EXPD',
        )

        with patch('app.celery.get_sms_provider') as mock_get, \
             patch('app.celery.process_delivery_event') as mock_task:
            provider = Mock()
            provider.poll_job_status.return_value = [mock_event]
            mock_get.return_value = provider

            result = reconcile_stale_sent()

        assert result['polled'] == 1
        assert result['events'] == 1
        mock_task.delay.assert_called_once()

    def test_no_stale_schedules(self, schedule_sent):
        from app.celery import reconcile_stale_sent

        # Recently sent — not stale
        with patch('app.celery.get_sms_provider') as mock_get:
            result = reconcile_stale_sent()

        assert result == {'polled': 0, 'events': 0}
        mock_get.assert_not_called()

    def test_provider_without_polling_skips(self, schedule_sent):
        from app.celery import reconcile_stale_sent

        schedule_sent.sent_time = timezone.now() - timedelta(hours=25)
        schedule_sent.save()

        with patch('app.celery.get_sms_provider') as mock_get:
            provider = Mock()
            provider.poll_job_status.side_effect = NotImplementedError
            mock_get.return_value = provider

            result = reconcile_stale_sent()

        assert result['reason'] == 'not_supported'

    def test_api_error_continues_to_next(self, schedule_sent, organisation, user, contact):
        from app.celery import reconcile_stale_sent

        # Create two stale schedules with different job IDs
        schedule_sent.sent_time = timezone.now() - timedelta(hours=25)
        schedule_sent.save()

        other = Schedule.objects.create(
            organisation=organisation,
            contact=contact,
            phone='0412999999',
            text='Other message',
            scheduled_time=timezone.now(),
            status=ScheduleStatus.SENT,
            format='sms',
            message_parts=1,
            provider_message_id='other-job-id',
            sent_time=timezone.now() - timedelta(hours=25),
            created_by=user,
            updated_by=user,
        )

        with patch('app.celery.get_sms_provider') as mock_get, \
             patch('app.celery.process_delivery_event') as mock_task:
            provider = Mock()
            # First job errors, second succeeds with no events
            provider.poll_job_status.side_effect = [
                Exception('API error'),
                [],
            ]
            mock_get.return_value = provider

            result = reconcile_stale_sent()

        # Should have polled both despite first failing
        assert result['polled'] == 2
        assert result['events'] == 0
        assert provider.poll_job_status.call_count == 2
