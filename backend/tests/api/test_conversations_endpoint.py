"""
Tests for the conversations API (two-way SMS).

Endpoints:
- GET  /api/conversations/                  — contacts with >=1 inbound reply
- GET  /api/conversations/unread-count/     — org-wide unread badge count
- GET  /api/conversations/{id}/thread/      — merged outbound+inbound, cursor-paginated
- POST /api/conversations/{id}/mark-read/   — mark the conversation read
"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status

from app.models import InboundMessage, MessageFormat, Schedule, ScheduleStatus
from tests.factories import (
    ContactFactory,
    InboundMessageFactory,
    ScheduleFactory,
)


def _inbound(organisation, contact, minutes_ago=0, **overrides):
    return InboundMessageFactory(
        organisation=organisation,
        contact=contact,
        phone=contact.phone,
        received_at=timezone.now() - timedelta(minutes=minutes_ago),
        **overrides,
    )


def _outbound(organisation, contact, minutes_ago=0, **overrides):
    defaults = dict(
        organisation=organisation,
        contact=contact,
        phone=contact.phone if contact else None,
        status=ScheduleStatus.SENT,
        format=MessageFormat.SMS,
        scheduled_time=timezone.now() - timedelta(minutes=minutes_ago),
        sent_time=timezone.now() - timedelta(minutes=minutes_ago),
    )
    defaults.update(overrides)
    return ScheduleFactory(**defaults)


@pytest.mark.django_db
class TestConversationList:
    URL = '/api/conversations/'

    def test_only_contacts_with_inbound_appear(
        self, authenticated_client, organisation, contact, user
    ):
        silent_contact = ContactFactory(
            organisation=organisation, created_by=user, updated_by=user)
        _inbound(organisation, contact)

        response = authenticated_client.get(self.URL)

        assert response.status_code == status.HTTP_200_OK
        contact_ids = [row['contact_id'] for row in response.data['results']]
        assert contact_ids == [contact.id]
        assert silent_contact.id not in contact_ids

    def test_annotations_and_ordering(
        self, authenticated_client, organisation, contacts
    ):
        older, newer = contacts[0], contacts[1]
        _inbound(organisation, older, minutes_ago=60, text='old reply')
        _inbound(organisation, newer, minutes_ago=30, text='first')
        latest = _inbound(organisation, newer, minutes_ago=5, text='latest reply')
        # One of newer's replies is read; one unread
        InboundMessage.objects.filter(contact=newer, text='first').update(
            read_at=timezone.now())

        response = authenticated_client.get(self.URL)

        rows = response.data['results']
        assert [r['contact_id'] for r in rows] == [newer.id, older.id]
        newer_row = rows[0]
        assert newer_row['last_inbound_text'] == 'latest reply'
        assert newer_row['unread_count'] == 1
        assert newer_row['contact_detail']['id'] == newer.id
        assert newer_row['last_inbound_at'] is not None
        assert latest.received_at.isoformat().startswith(
            newer_row['last_inbound_at'][:19])

    def test_envelope_contract(self, authenticated_client, organisation, contact):
        _inbound(organisation, contact)

        response = authenticated_client.get(self.URL)

        assert set(response.data.keys()) == {'results', 'pagination'}
        assert set(response.data['pagination'].keys()) == {
            'total', 'page', 'limit', 'totalPages', 'hasNext', 'hasPrev'}

    def test_tenant_isolation(
        self, authenticated_client, organisation, contact, another_org
    ):
        other_contact = ContactFactory(organisation=another_org)
        InboundMessageFactory(
            organisation=another_org, contact=other_contact,
            phone=other_contact.phone, received_at=timezone.now())
        _inbound(organisation, contact)

        response = authenticated_client.get(self.URL)

        contact_ids = [row['contact_id'] for row in response.data['results']]
        assert contact_ids == [contact.id]

    def test_no_default_date_filter(
        self, authenticated_client, organisation, contact
    ):
        """A reply from last month must still be listed (unlike ScheduleFilter)."""
        _inbound(organisation, contact, minutes_ago=60 * 24 * 40)

        response = authenticated_client.get(self.URL)

        assert len(response.data['results']) == 1

    def test_auto_created_blank_name_contact_listed(
        self, authenticated_client, organisation
    ):
        """Contacts auto-created from replies have blank names but must appear."""
        auto = ContactFactory(
            organisation=organisation, first_name='', last_name='',
            phone='0498888888')
        _inbound(organisation, auto)

        response = authenticated_client.get(self.URL)

        row = response.data['results'][0]
        assert row['contact_id'] == auto.id
        assert row['contact_detail']['first_name'] == ''
        assert row['contact_detail']['phone'] == '0498888888'

    def test_requires_auth(self, api_client, db):
        assert api_client.get(self.URL).status_code in (401, 403)


@pytest.mark.django_db
class TestUnreadCount:
    URL = '/api/conversations/unread-count/'

    def test_counts_unread_for_org_only(
        self, authenticated_client, organisation, contact, another_org
    ):
        _inbound(organisation, contact, text='unread 1')
        _inbound(organisation, contact, text='unread 2')
        read = _inbound(organisation, contact, text='read')
        InboundMessage.objects.filter(pk=read.pk).update(read_at=timezone.now())
        other_contact = ContactFactory(organisation=another_org)
        InboundMessageFactory(
            organisation=another_org, contact=other_contact,
            phone=other_contact.phone, received_at=timezone.now())

        response = authenticated_client.get(self.URL)

        assert response.status_code == status.HTTP_200_OK
        assert response.data == {'unread': 2}

    def test_zero_when_empty(self, authenticated_client, organisation):
        response = authenticated_client.get(self.URL)
        assert response.data == {'unread': 0}

    def test_requires_auth(self, api_client, db):
        assert api_client.get(self.URL).status_code in (401, 403)


@pytest.mark.django_db
class TestThread:

    def _url(self, contact_id):
        return f'/api/conversations/{contact_id}/thread/'

    def test_interleaves_both_directions_newest_first(
        self, authenticated_client, organisation, contact
    ):
        _outbound(organisation, contact, minutes_ago=30, text='outbound first')
        _inbound(organisation, contact, minutes_ago=20, text='reply')
        _outbound(organisation, contact, minutes_ago=10, text='outbound again')

        response = authenticated_client.get(self._url(contact.id))

        assert response.status_code == status.HTTP_200_OK
        results = response.data['results']
        assert [r['direction'] for r in results] == ['outbound', 'inbound', 'outbound']
        assert [r['text'] for r in results] == ['outbound again', 'reply', 'outbound first']
        assert response.data['total'] == 3
        assert response.data['has_more'] is False
        assert response.data['next_before'] is None
        # Every row carries the unified sort timestamp
        assert all('thread_ts' in r for r in results)

    def test_outbound_rows_include_status_and_two_way(
        self, authenticated_client, organisation, contact
    ):
        _outbound(organisation, contact, two_way=True,
                  status=ScheduleStatus.DELIVERED)

        response = authenticated_client.get(self._url(contact.id))

        row = response.data['results'][0]
        assert row['direction'] == 'outbound'
        assert row['two_way'] is True
        assert row['status'] == ScheduleStatus.DELIVERED

    def test_raw_number_sends_appear_in_thread(
        self, authenticated_client, organisation, contact
    ):
        """Sends made to the bare phone (Schedule.contact=None) match by phone."""
        _outbound(organisation, None, phone=contact.phone, text='raw number send')
        _inbound(organisation, contact, text='reply')

        response = authenticated_client.get(self._url(contact.id))

        texts = [r['text'] for r in response.data['results']]
        assert 'raw number send' in texts
        assert response.data['total'] == 2

    def test_batch_parent_excluded(
        self, authenticated_client, organisation, contact
    ):
        """Batch parents have no phone and never belong to a thread."""
        ScheduleFactory(
            organisation=organisation, phone=None, name='Campaign',
            status=ScheduleStatus.SENT, format=MessageFormat.SMS)
        _outbound(organisation, contact, text='real send')

        response = authenticated_client.get(self._url(contact.id))

        assert [r['text'] for r in response.data['results']] == ['real send']

    def test_cursor_walk_no_overlap_no_gap(
        self, authenticated_client, organisation, contact
    ):
        for i in range(4):
            _outbound(organisation, contact, minutes_ago=10 * i + 5,
                      text=f'out {i}')
            _inbound(organisation, contact, minutes_ago=10 * i,
                     text=f'in {i}')

        seen = []
        before = None
        pages = 0
        while True:
            url = self._url(contact.id) + '?limit=3'
            if before:
                url += f'&before={before}'
            response = authenticated_client.get(url)
            assert response.status_code == status.HTTP_200_OK
            seen.extend(r['text'] for r in response.data['results'])
            pages += 1
            if not response.data['has_more']:
                break
            before = response.data['next_before']

        assert pages == 3
        assert len(seen) == 8
        assert len(set(seen)) == 8  # no duplicates
        expected = ['in 0', 'out 0', 'in 1', 'out 1', 'in 2', 'out 2', 'in 3', 'out 3']
        assert seen == expected

    def test_boundary_timestamp_ties_are_not_skipped(
        self, authenticated_client, organisation, contact
    ):
        """Rows tying on the page-boundary timestamp must not be lost.

        next_before filters strictly (<), so the page is extended through ties
        — Welcorp timestamps are second-granularity and batch children share
        one sent_time, making exact ties realistic.
        """
        tied_at = timezone.now() - timedelta(minutes=10)
        for i in range(3):
            InboundMessageFactory(
                organisation=organisation, contact=contact, phone=contact.phone,
                received_at=tied_at, text=f'tied {i}')
        _inbound(organisation, contact, minutes_ago=60, text='older')

        seen = []
        before = None
        while True:
            url = self._url(contact.id) + '?limit=2'
            if before:
                url += f'&before={before}'
            response = authenticated_client.get(url)
            assert response.status_code == status.HTTP_200_OK
            seen.extend(r['text'] for r in response.data['results'])
            if not response.data['has_more']:
                break
            before = response.data['next_before']

        assert sorted(seen) == ['older', 'tied 0', 'tied 1', 'tied 2']

    def test_total_ignores_cursor(self, authenticated_client, organisation, contact):
        for i in range(3):
            _inbound(organisation, contact, minutes_ago=i)

        response = authenticated_client.get(self._url(contact.id) + '?limit=1')

        assert response.data['total'] == 3
        assert len(response.data['results']) == 1
        assert response.data['has_more'] is True

    def test_invalid_before_returns_400(
        self, authenticated_client, organisation, contact
    ):
        response = authenticated_client.get(
            self._url(contact.id) + '?before=not-a-date')
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_cross_org_contact_404(
        self, authenticated_client, organisation, another_org
    ):
        other_contact = ContactFactory(organisation=another_org)

        response = authenticated_client.get(self._url(other_contact.id))

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_requires_auth(self, api_client, contact):
        assert api_client.get(self._url(contact.id)).status_code in (401, 403)


@pytest.mark.django_db
class TestMarkRead:

    def _url(self, contact_id):
        return f'/api/conversations/{contact_id}/mark-read/'

    def test_marks_unread_and_records_reader(
        self, authenticated_client, organisation, contact, user
    ):
        _inbound(organisation, contact, text='a')
        _inbound(organisation, contact, text='b')

        response = authenticated_client.post(self._url(contact.id))

        assert response.status_code == status.HTTP_200_OK
        assert response.data == {'marked': 2}
        rows = InboundMessage.objects.filter(contact=contact)
        assert all(r.read_at is not None for r in rows)
        assert all(r.read_by == user for r in rows)

    def test_idempotent_and_first_reader_preserved(
        self, authenticated_client, organisation, contact, user
    ):
        _inbound(organisation, contact)
        authenticated_client.post(self._url(contact.id))
        first = InboundMessage.objects.get(contact=contact)

        response = authenticated_client.post(self._url(contact.id))

        assert response.data == {'marked': 0}
        again = InboundMessage.objects.get(contact=contact)
        assert again.read_at == first.read_at
        assert again.read_by == first.read_by

    def test_only_this_contacts_rows_marked(
        self, authenticated_client, organisation, contacts
    ):
        target, other = contacts[0], contacts[1]
        _inbound(organisation, target)
        _inbound(organisation, other)

        authenticated_client.post(self._url(target.id))

        assert InboundMessage.objects.get(contact=target).read_at is not None
        assert InboundMessage.objects.get(contact=other).read_at is None

    def test_unread_count_reflects_mark_read(
        self, authenticated_client, organisation, contact
    ):
        _inbound(organisation, contact)
        assert authenticated_client.get(
            '/api/conversations/unread-count/').data == {'unread': 1}

        authenticated_client.post(self._url(contact.id))

        assert authenticated_client.get(
            '/api/conversations/unread-count/').data == {'unread': 0}

    def test_cross_org_contact_404(self, authenticated_client, another_org):
        other_contact = ContactFactory(organisation=another_org)
        response = authenticated_client.post(self._url(other_contact.id))
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_requires_auth(self, api_client, contact):
        assert api_client.post(self._url(contact.id)).status_code in (401, 403)
