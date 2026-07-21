"""
Tests for the process_inbound_message Celery task (two-way SMS replies).

Covers:
- Schedule/org matching by broadcast_id at any status (incl. DELIVERED)
- Batch child disambiguation by phone; phone-mismatch keeps org, drops schedule link
- inbound_unmatched drop for unknown job ids (never attribute an org by phone alone)
- Contact auto-creation for replies from numbers with no contact record
- Dedup across provider callback redeliveries (dedup_key unique constraint)
- STOP keyword opt-out: org-scoped, one-way, message still stored
- Hazard regression: the task never touches Schedule.status and never refunds
"""

from datetime import timedelta

import pytest
from django.test import override_settings
from django.utils import timezone

from app.celery import process_inbound_message
from app.models import Contact, CreditTransaction, InboundMessage, ScheduleStatus


def _event(schedule=None, **overrides):
    """Build a task event dict shaped like InboundSmsEvent.__dict__."""
    event = {
        'provider_message_id': schedule.provider_message_id if schedule else 'welcorp-job-000',
        'sender_phone': schedule.phone if schedule else '0412345678',
        'text': 'This is a reply',
        'timestamp': '2026-07-10T12:02:52+10:00',
        'reference': '0',
        'raw_data': {'BroadcastID': 'raw', 'Response': 'This is a reply'},
    }
    event.update(overrides)
    return event


@pytest.mark.django_db
class TestScheduleMatching:

    def test_single_send_match(self, organisation, contact, schedule_sent):
        result = process_inbound_message(_event(schedule_sent))

        message = InboundMessage.objects.get(pk=result['inbound_message_id'])
        assert message.organisation == organisation
        assert message.schedule == schedule_sent
        assert message.contact == contact  # existing contact reused, not recreated
        assert message.phone == '0412345678'
        assert message.text == 'This is a reply'
        assert message.broadcast_id == schedule_sent.provider_message_id
        assert message.raw_data == {'BroadcastID': 'raw', 'Response': 'This is a reply'}
        assert Contact.objects.filter(organisation=organisation).count() == 1

    def test_match_at_delivered_status(self, schedule_sent):
        """Replies usually land after the DLR — terminal schedules must match."""
        schedule_sent.status = ScheduleStatus.DELIVERED
        schedule_sent.save(update_fields=['status'])

        result = process_inbound_message(_event(schedule_sent))

        message = InboundMessage.objects.get(pk=result['inbound_message_id'])
        assert message.schedule == schedule_sent

    def test_batch_child_matched_by_phone(self, organisation, batch_sent_schedules):
        _parent, children = batch_sent_schedules

        result = process_inbound_message(_event(
            provider_message_id='welcorp-job-999', sender_phone='0412222222',
        ))

        message = InboundMessage.objects.get(pk=result['inbound_message_id'])
        assert message.schedule == children[1]
        assert message.organisation == organisation

    def test_batch_phone_mismatch_keeps_org_drops_schedule(
        self, organisation, batch_sent_schedules, caplog, propagate_app_logs,
    ):
        with caplog.at_level('WARNING', logger='app.celery'):
            result = process_inbound_message(_event(
                provider_message_id='welcorp-job-999', sender_phone='0499999999',
            ))

        message = InboundMessage.objects.get(pk=result['inbound_message_id'])
        assert message.schedule is None
        assert message.organisation == organisation
        assert any('no row matches' in r.message for r in caplog.records)

    def test_unmatched_job_is_dropped(self, db, caplog, propagate_app_logs):
        with caplog.at_level('WARNING', logger='app.celery'):
            result = process_inbound_message(_event(
                provider_message_id='no-such-job', sender_phone='0412345678',
            ))

        assert result == {'skipped': True, 'reason': 'inbound_unmatched'}
        assert InboundMessage.objects.count() == 0
        assert any('inbound_unmatched' in r.message for r in caplog.records)

    @pytest.mark.parametrize('missing', ['provider_message_id', 'sender_phone', 'text'])
    def test_missing_fields_skipped(self, db, missing):
        result = process_inbound_message(_event(**{missing: None}))

        assert result == {'skipped': True, 'reason': 'missing_fields'}
        assert InboundMessage.objects.count() == 0

    def test_implausible_phone_skipped(self, db, schedule_sent):
        """A junk Destination longer than any phone must not crash-loop the task."""
        result = process_inbound_message(_event(
            schedule_sent, sender_phone='6' * 60))

        assert result == {'skipped': True, 'reason': 'invalid_phone'}
        assert InboundMessage.objects.count() == 0

    def test_task_retries_transient_errors(self):
        """Replies are unrecoverable (no Welcorp pull API) — the task MUST
        autoretry transient failures instead of ack-and-dropping them."""
        assert Exception in process_inbound_message.autoretry_for
        assert process_inbound_message.retry_kwargs['max_retries'] == 5
        assert process_inbound_message.retry_backoff


@pytest.mark.django_db
class TestContactAutoCreation:

    def test_reply_from_unknown_number_creates_contact(self, organisation, schedule_sent):
        """Sending to a raw number (no contact) is valid — its replies must land."""
        schedule_sent.contact = None
        schedule_sent.phone = '0498888888'
        schedule_sent.save(update_fields=['contact', 'phone'])

        result = process_inbound_message(_event(schedule_sent))

        message = InboundMessage.objects.get(pk=result['inbound_message_id'])
        assert message.contact is not None
        assert message.contact.organisation == organisation
        assert message.contact.phone == '0498888888'
        assert message.contact.first_name == ''
        assert message.contact.last_name == ''
        assert message.contact.created_by is None

    def test_second_reply_reuses_auto_created_contact(self, organisation, schedule_sent):
        schedule_sent.contact = None
        schedule_sent.phone = '0498888888'
        schedule_sent.save(update_fields=['contact', 'phone'])

        first = process_inbound_message(_event(schedule_sent, text='first'))
        second = process_inbound_message(_event(schedule_sent, text='second'))

        first_contact = InboundMessage.objects.get(pk=first['inbound_message_id']).contact
        second_contact = InboundMessage.objects.get(pk=second['inbound_message_id']).contact
        assert first_contact == second_contact
        assert Contact.objects.filter(organisation=organisation, phone='0498888888').count() == 1


@pytest.mark.django_db
class TestDeduplication:

    def test_duplicate_event_stored_once(self, schedule_sent):
        event = _event(schedule_sent)

        first = process_inbound_message(dict(event))
        second = process_inbound_message(dict(event))

        assert 'inbound_message_id' in first
        assert second == {'skipped': True, 'reason': 'duplicate'}
        assert InboundMessage.objects.count() == 1

    def test_different_text_is_not_a_duplicate(self, schedule_sent):
        process_inbound_message(_event(schedule_sent, text='first reply'))
        process_inbound_message(_event(schedule_sent, text='second reply'))

        assert InboundMessage.objects.count() == 2

    def test_duplicate_opt_out_does_not_double_propagate(self, contact, schedule_sent):
        """Redelivered STOP aborts on dedup before the opt-out propagation."""
        event = _event(schedule_sent, text='STOP')

        process_inbound_message(dict(event))
        contact.refresh_from_db()
        assert contact.opt_out is True

        result = process_inbound_message(dict(event))
        assert result == {'skipped': True, 'reason': 'duplicate'}
        assert InboundMessage.objects.filter(is_opt_out=True).count() == 1


@pytest.mark.django_db
class TestOptOutKeyword:

    @pytest.mark.parametrize('text', ['STOP', 'stop', 'Stop', ' stop ', 'STOP\n'])
    def test_stop_variants_flip_contact(self, contact, schedule_sent, text):
        result = process_inbound_message(_event(schedule_sent, text=text))

        message = InboundMessage.objects.get(pk=result['inbound_message_id'])
        assert message.is_opt_out is True
        assert message.text == text  # stored verbatim, still visible in the thread
        contact.refresh_from_db()
        assert contact.opt_out is True

    @pytest.mark.parametrize('text', ['please stop', 'STOP IT', 'ok', 'unsubscribe'])
    def test_non_keyword_text_does_not_flip(self, contact, schedule_sent, text):
        result = process_inbound_message(_event(schedule_sent, text=text))

        assert InboundMessage.objects.get(pk=result['inbound_message_id']).is_opt_out is False
        contact.refresh_from_db()
        assert contact.opt_out is False

    @override_settings(INBOUND_OPT_OUT_KEYWORDS=['STOP', 'UNSUBSCRIBE'])
    def test_keyword_list_is_settings_driven(self, contact, schedule_sent):
        process_inbound_message(_event(schedule_sent, text='unsubscribe'))

        contact.refresh_from_db()
        assert contact.opt_out is True

    def test_stop_does_not_touch_other_orgs(
        self, contact, schedule_sent, another_org, user,
    ):
        other_contact = Contact.objects.create(
            organisation=another_org,
            phone=contact.phone,  # same number, different tenant
            first_name='Other',
            last_name='Org',
            created_by=user,
            updated_by=user,
        )

        process_inbound_message(_event(schedule_sent, text='STOP'))

        contact.refresh_from_db()
        other_contact.refresh_from_db()
        assert contact.opt_out is True
        assert other_contact.opt_out is False

    def test_opt_out_is_never_unset(self, contact, schedule_sent):
        """A later normal reply must not opt the contact back in — one-way only."""
        process_inbound_message(_event(schedule_sent, text='STOP'))
        process_inbound_message(_event(schedule_sent, text='actually keep me posted'))

        contact.refresh_from_db()
        assert contact.opt_out is True


@pytest.mark.django_db
class TestTimestampHandling:

    def test_provider_timestamp_used(self, schedule_sent):
        result = process_inbound_message(
            _event(schedule_sent, timestamp='2026-07-10T12:02:52+10:00'))

        message = InboundMessage.objects.get(pk=result['inbound_message_id'])
        assert message.received_at.isoformat() == '2026-07-10T02:02:52+00:00'

    @pytest.mark.parametrize('timestamp', [None, '', 'not-a-date'])
    def test_bad_timestamp_falls_back_to_now(self, schedule_sent, timestamp):
        before = timezone.now()
        result = process_inbound_message(_event(schedule_sent, timestamp=timestamp))

        message = InboundMessage.objects.get(pk=result['inbound_message_id'])
        assert before - timedelta(seconds=5) <= message.received_at <= timezone.now()

    def test_naive_timestamp_made_aware(self, schedule_sent):
        result = process_inbound_message(
            _event(schedule_sent, timestamp='2026-07-10T12:02:52'))

        message = InboundMessage.objects.get(pk=result['inbound_message_id'])
        assert timezone.is_aware(message.received_at)


@pytest.mark.django_db
class TestNeverTouchesDeliveryPipeline:
    """Hazard regression: a reply is not a delivery outcome.

    Before the parser fix, a reply arriving while the schedule was still SENT
    was misread as an empty-status failure — FAILED + refund. The task layer
    must uphold the same invariant.
    """

    def test_schedule_status_and_billing_untouched(self, organisation, schedule_sent):
        balance_before = organisation.credit_balance

        process_inbound_message(_event(schedule_sent))

        schedule_sent.refresh_from_db()
        organisation.refresh_from_db()
        assert schedule_sent.status == ScheduleStatus.SENT
        assert organisation.credit_balance == balance_before
        assert not CreditTransaction.objects.filter(
            transaction_type=CreditTransaction.REFUND).exists()

    def test_stop_reply_does_not_fail_schedule(self, schedule_sent):
        """Even an opt-out reply is not a delivery failure (unlike carrier OPTO)."""
        process_inbound_message(_event(schedule_sent, text='STOP'))

        schedule_sent.refresh_from_db()
        assert schedule_sent.status == ScheduleStatus.SENT
        assert not CreditTransaction.objects.filter(
            transaction_type=CreditTransaction.REFUND).exists()
