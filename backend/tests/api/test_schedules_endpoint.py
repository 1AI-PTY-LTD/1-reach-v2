"""
Tests for Schedule API endpoints (ScheduleViewSet).

Tests:
- CRUD operations (individual schedules only, not groups)
- Multi-tenancy isolation
- Date filtering
- Status filtering
"""

import pytest
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework import status

from app.models import CreditTransaction, Schedule, ScheduleStatus
from tests.factories import (
    ContactFactory,
    OrganisationFactory,
    ScheduleFactory,
)


def _fund(organisation, amount='10.00'):
    organisation.credit_balance = Decimal(amount)
    organisation.save(update_fields=['credit_balance'])


@pytest.mark.django_db
class TestScheduleList:
    """Tests for GET /api/schedules/ endpoint."""

    def test_list_returns_org_schedules(self, authenticated_client, organisation, user):
        """List returns only schedules from user's organisation."""
        schedule1 = ScheduleFactory(organisation=organisation, for_contact=True, created_by=user)
        schedule2 = ScheduleFactory(organisation=organisation, for_contact=True, created_by=user)

        # Other org schedule
        other_org = OrganisationFactory()
        ScheduleFactory(organisation=other_org, for_contact=True)

        response = authenticated_client.get('/api/schedules/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 2

    def test_list_excludes_children(self, authenticated_client, organisation, user):
        """List excludes child schedules (parent != None) but includes group parent."""
        # Parent schedule (group)
        parent = ScheduleFactory(organisation=organisation, for_group=True, created_by=user)

        # Child schedules
        ScheduleFactory(organisation=organisation, parent=parent, for_contact=True, created_by=user)
        ScheduleFactory(organisation=organisation, parent=parent, for_contact=True, created_by=user)

        response = authenticated_client.get('/api/schedules/')

        # Parent appears, children do not
        assert response.data['pagination']['total'] == 1
        assert response.data['results'][0]['id'] == parent.id

    def test_list_filter_by_date_from(self, authenticated_client, organisation, user):
        """date_from filters schedules."""
        now = timezone.now()
        schedule1 = ScheduleFactory(
            organisation=organisation,
            scheduled_time=now,
            for_contact=True,
            created_by=user
        )
        schedule2 = ScheduleFactory(
            organisation=organisation,
            scheduled_time=now + timedelta(days=2),
            for_contact=True,
            created_by=user
        )

        date_filter = (now + timedelta(days=1)).date().isoformat()
        response = authenticated_client.get(f'/api/schedules/?date_from={date_filter}')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1

    def test_cancelled_schedule_appears_in_list(self, authenticated_client, organisation, user):
        """Cancelled schedules remain visible in the list."""
        ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.CANCELLED,
            for_contact=True,
            created_by=user
        )

        response = authenticated_client.get('/api/schedules/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1
        assert response.data['results'][0]['status'] == ScheduleStatus.CANCELLED

    def test_delete_schedule_remains_in_list_as_cancelled(self, authenticated_client, organisation, user):
        """After deleting a pending schedule, it still appears in list with cancelled status."""
        schedule = ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.PENDING,
            for_contact=True,
            created_by=user
        )

        # Delete (soft-cancel) the schedule
        delete_response = authenticated_client.delete(f'/api/schedules/{schedule.id}/')
        assert delete_response.status_code == status.HTTP_204_NO_CONTENT

        # It should still appear in the list
        list_response = authenticated_client.get('/api/schedules/')
        assert list_response.status_code == status.HTTP_200_OK
        assert list_response.data['pagination']['total'] == 1
        assert list_response.data['results'][0]['status'] == ScheduleStatus.CANCELLED

    def test_list_filter_by_status(self, authenticated_client, organisation, user):
        """Status filter works."""
        schedule1 = ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.PENDING,
            for_contact=True,
            created_by=user
        )
        schedule2 = ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.SENT,
            for_contact=True,
            created_by=user
        )

        response = authenticated_client.get(f'/api/schedules/?status={ScheduleStatus.SENT}')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1

    def test_list_includes_group_schedules(self, authenticated_client, organisation, user):
        """Group schedule parents appear in the list with group_detail populated."""
        parent = ScheduleFactory(organisation=organisation, for_group=True, created_by=user)

        response = authenticated_client.get('/api/schedules/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1
        result = response.data['results'][0]
        assert result['id'] == parent.id
        assert result['group_detail'] is not None
        assert result['group_detail']['name'] == parent.group.name

    def test_list_group_schedule_no_duplicate_children(self, authenticated_client, organisation, user):
        """Group schedule with children: only parent row appears, not children."""
        parent = ScheduleFactory(organisation=organisation, for_group=True, created_by=user)
        ScheduleFactory(organisation=organisation, parent=parent, for_contact=True, created_by=user)
        ScheduleFactory(organisation=organisation, parent=parent, for_contact=True, created_by=user)
        ScheduleFactory(organisation=organisation, parent=parent, for_contact=True, created_by=user)

        response = authenticated_client.get('/api/schedules/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1
        assert response.data['results'][0]['id'] == parent.id


@pytest.mark.django_db
class TestScheduleCreate:
    """Tests for POST /api/schedules/ endpoint."""

    def test_create_schedule(self, authenticated_client, organisation, user):
        """Creating schedule succeeds."""
        _fund(organisation)
        contact = ContactFactory(organisation=organisation, created_by=user)
        future = timezone.now() + timedelta(hours=1)

        data = {
            'contact_id': contact.id,
            'text': 'Test message',
            'scheduled_time': future.isoformat()
        }

        response = authenticated_client.post('/api/schedules/', data)

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['text'] == 'Test message'

    def test_create_prepaid_reserves_credits(self, authenticated_client, organisation, user):
        """Prepaid orgs are charged at creation, like group schedules and immediate sends."""
        _fund(organisation)
        future = timezone.now() + timedelta(hours=1)

        data = {'text': 'Test', 'phone': '0412345678', 'scheduled_time': future.isoformat()}
        response = authenticated_client.post('/api/schedules/', data)

        assert response.status_code == status.HTTP_201_CREATED
        organisation.refresh_from_db()
        assert organisation.credit_balance == Decimal('9.90')  # $10 - 1 part × $0.10
        charge = CreditTransaction.objects.get(
            organisation=organisation, schedule_id=response.data['id'],
            transaction_type=CreditTransaction.DEDUCT,
        )
        assert charge.amount == Decimal('0.10')

    def test_create_blocked_when_insufficient_balance(self, authenticated_client, organisation, user):
        """Scheduled sends are billing-gated like immediate sends.

        Regression test: POST /api/schedules/ previously bypassed billing
        entirely, so prepaid orgs could schedule sends for free.
        """
        _fund(organisation, '0.00')
        future = timezone.now() + timedelta(hours=1)
        data = {'text': 'Test', 'phone': '0412345678', 'scheduled_time': future.isoformat()}

        response = authenticated_client.post('/api/schedules/', data)  # balance is $0

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'balance' in str(response.data).lower()
        assert Schedule.objects.count() == 0

    def test_create_ignores_client_message_parts_and_status(self, authenticated_client, organisation, user):
        """message_parts and status are server-controlled (billing depends on them)."""
        _fund(organisation)
        future = timezone.now() + timedelta(hours=1)

        data = {
            'text': 'x' * 200,  # 2 parts
            'phone': '0412345678',
            'scheduled_time': future.isoformat(),
            'message_parts': 1,        # must be ignored
            'status': 'delivered',     # must be ignored
        }
        response = authenticated_client.post('/api/schedules/', data)

        assert response.status_code == status.HTTP_201_CREATED
        schedule = Schedule.objects.get(pk=response.data['id'])
        assert schedule.message_parts == 2
        assert schedule.status == ScheduleStatus.PENDING
        organisation.refresh_from_db()
        assert organisation.credit_balance == Decimal('9.80')  # charged for 2 parts

    def test_create_subscribed_does_not_charge(self, authenticated_client, organisation, user):
        """Subscribed orgs are charged on successful send, not at creation."""
        organisation.billing_mode = organisation.BILLING_SUBSCRIBED
        organisation.save(update_fields=['billing_mode'])
        future = timezone.now() + timedelta(hours=1)

        data = {'text': 'Test', 'phone': '0412345678', 'scheduled_time': future.isoformat()}
        response = authenticated_client.post('/api/schedules/', data)

        assert response.status_code == status.HTTP_201_CREATED
        assert not CreditTransaction.objects.filter(organisation=organisation).exists()

    def test_create_validates_scheduled_time_future(self, authenticated_client, user):
        """Scheduled time must be in future."""
        past = timezone.now() - timedelta(hours=1)

        data = {
            'text': 'Test',
            'phone': '0412345678',
            'scheduled_time': past.isoformat()
        }

        response = authenticated_client.post('/api/schedules/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestScheduleRetrieve:
    """Tests for GET /api/schedules/{id}/ endpoint."""

    def test_retrieve_schedule(self, authenticated_client, organisation, user):
        """Retrieving schedule succeeds."""
        schedule = ScheduleFactory(organisation=organisation, for_contact=True, created_by=user)

        response = authenticated_client.get(f'/api/schedules/{schedule.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['id'] == schedule.id

    def test_retrieve_enforces_org_isolation(self, authenticated_client):
        """Cannot retrieve schedule from different org."""
        other_org = OrganisationFactory()
        schedule = ScheduleFactory(organisation=other_org, for_contact=True)

        response = authenticated_client.get(f'/api/schedules/{schedule.id}/')

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestScheduleUpdate:
    """Tests for PUT/PATCH /api/schedules/{id}/ endpoint."""

    def test_update_pending_schedule(self, authenticated_client, organisation, user):
        """Updating pending schedule succeeds."""
        future = timezone.now() + timedelta(hours=2)
        schedule = ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.PENDING,
            for_contact=True,
            created_by=user
        )

        data = {
            'text': 'Updated text',
            'phone': schedule.phone,
            'scheduled_time': future.isoformat()
        }

        response = authenticated_client.put(f'/api/schedules/{schedule.id}/', data)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['text'] == 'Updated text'

    def test_update_to_longer_text_reprices_reservation(self, authenticated_client, organisation, user):
        """Editing a pending schedule's text swaps the prepaid reservation to the new cost."""
        _fund(organisation)
        future = timezone.now() + timedelta(hours=1)
        create = authenticated_client.post('/api/schedules/', {
            'text': 'Short', 'phone': '0412345678', 'scheduled_time': future.isoformat(),
        })
        assert create.status_code == status.HTTP_201_CREATED  # balance now 9.90

        response = authenticated_client.patch(
            f'/api/schedules/{create.data["id"]}/', {'text': 'x' * 200},  # 2 parts
        )

        assert response.status_code == status.HTTP_200_OK
        schedule = Schedule.objects.get(pk=create.data['id'])
        assert schedule.message_parts == 2
        organisation.refresh_from_db()
        assert organisation.credit_balance == Decimal('9.80')  # net charge = 2 parts
        types = list(CreditTransaction.objects.filter(
            organisation=organisation, schedule=schedule,
        ).order_by('created_at').values_list('transaction_type', flat=True))
        assert types == [
            CreditTransaction.DEDUCT, CreditTransaction.REFUND, CreditTransaction.DEDUCT,
        ]

    def test_update_blocked_when_new_cost_exceeds_balance(self, authenticated_client, organisation, user):
        """Re-pricing is gated: the edit is rolled back if the org cannot afford it."""
        _fund(organisation, '0.10')
        future = timezone.now() + timedelta(hours=1)
        create = authenticated_client.post('/api/schedules/', {
            'text': 'Short', 'phone': '0412345678', 'scheduled_time': future.isoformat(),
        })
        assert create.status_code == status.HTTP_201_CREATED  # balance now 0.00

        response = authenticated_client.patch(
            f'/api/schedules/{create.data["id"]}/', {'text': 'x' * 200},  # needs 0.20
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        schedule = Schedule.objects.get(pk=create.data['id'])
        assert schedule.text == 'Short'  # rollback
        assert schedule.message_parts == 1
        organisation.refresh_from_db()
        assert organisation.credit_balance == Decimal('0.00')  # original reservation intact

    def test_cannot_update_sent_schedule(self, authenticated_client, organisation, user):
        """Cannot update sent schedule."""
        schedule = ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.SENT,
            sent=True,
            for_contact=True,
            created_by=user
        )

        data = {'text': 'Updated'}

        response = authenticated_client.patch(f'/api/schedules/{schedule.id}/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestScheduleDelete:
    """Tests for DELETE /api/schedules/{id}/ endpoint."""

    def test_delete_pending_schedule(self, authenticated_client, organisation, user):
        """Deleting pending schedule succeeds."""
        schedule = ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.PENDING,
            for_contact=True,
            created_by=user
        )

        response = authenticated_client.delete(f'/api/schedules/{schedule.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT

    def test_delete_sets_status_to_cancelled(self, authenticated_client, organisation, user):
        """Deleting a pending schedule sets its status to cancelled."""
        schedule = ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.PENDING,
            for_contact=True,
            created_by=user
        )

        response = authenticated_client.delete(f'/api/schedules/{schedule.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        schedule.refresh_from_db()
        assert schedule.status == ScheduleStatus.CANCELLED

    def test_delete_refunds_prepaid_reservation(self, authenticated_client, organisation, user):
        """Cancelling a pending scheduled send releases the credits reserved at creation."""
        _fund(organisation)
        future = timezone.now() + timedelta(hours=1)
        create = authenticated_client.post('/api/schedules/', {
            'text': 'Test', 'phone': '0412345678', 'scheduled_time': future.isoformat(),
        })
        assert create.status_code == status.HTTP_201_CREATED
        organisation.refresh_from_db()
        assert organisation.credit_balance == Decimal('9.90')

        response = authenticated_client.delete(f'/api/schedules/{create.data["id"]}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        organisation.refresh_from_db()
        assert organisation.credit_balance == Decimal('10.00')
        assert CreditTransaction.objects.filter(
            organisation=organisation, schedule_id=create.data['id'],
            transaction_type=CreditTransaction.REFUND,
        ).count() == 1

    def test_cannot_delete_sent_schedule(self, authenticated_client, organisation, user):
        """Cannot delete sent schedule."""
        schedule = ScheduleFactory(
            organisation=organisation,
            status=ScheduleStatus.SENT,
            sent=True,
            for_contact=True,
            created_by=user
        )

        response = authenticated_client.delete(f'/api/schedules/{schedule.id}/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
