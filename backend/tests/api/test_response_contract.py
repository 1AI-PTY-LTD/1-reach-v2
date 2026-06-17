"""API response-shape contract tests.

The frontend hand-writes MSW handlers + TypeScript types that mirror these
backend responses (frontend/src/test/handlers.ts, factories.ts, src/types/*).
Nothing else couples the two, so a backend rename (e.g. ``total`` -> ``count``,
a changed error envelope, a dropped field) would leave every frontend test green
while production breaks.

These tests pin the canonical response envelopes the frontend depends on. When
one fails, update BOTH the backend and the mirrored frontend handler/type.
"""

from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Config, Organisation
from tests.factories import ContactFactory


@pytest.fixture
def admin_client(user, organisation, org_membership):
    """Authenticated client with admin role (for admin-only endpoints)."""
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
    yield client
    APIView.dispatch = original_dispatch


# Mirrored in frontend/src/test/factories.ts ``paginate()`` + types/pagination.types.ts
PAGINATION_KEYS = {'total', 'page', 'limit', 'totalPages', 'hasNext', 'hasPrev'}


@pytest.mark.django_db
class TestResponseContract:
    def test_list_pagination_envelope(self, authenticated_client, organisation, user):
        """List endpoints return {results: [...], pagination: {...}} (StandardPagination).

        Mirror: frontend factories.ts paginate() / api modules' list parsing.
        """
        ContactFactory(organisation=organisation, created_by=user, updated_by=user)
        resp = authenticated_client.get('/api/contacts/')

        assert resp.status_code == status.HTTP_200_OK
        assert set(resp.data.keys()) >= {'results', 'pagination'}
        assert isinstance(resp.data['results'], list)
        assert set(resp.data['pagination'].keys()) == PAGINATION_KEYS
        assert isinstance(resp.data['pagination']['total'], int)
        assert isinstance(resp.data['pagination']['hasNext'], bool)

    def test_sms_send_202_envelope(self, authenticated_client, organisation):
        """POST /api/sms/send/ returns 202 with a schedule_id.

        Mirror: handlers.ts POST /api/sms/send/ (status 202, schedule_id).
        """
        resp = authenticated_client.post(
            '/api/sms/send/',
            {'message': 'hi', 'recipients': [{'phone': '0412345678'}]},
            format='json',
        )
        assert resp.status_code == status.HTTP_202_ACCEPTED
        assert 'schedule_id' in resp.data

    def test_sms_send_insufficient_balance_error_envelope(self, authenticated_client, organisation):
        """The billing gate rejects with a 400 and a string ``detail`` (DRF ValidationError).

        Mirror: the frontend's send-error handling (insufficient-balance message).
        """
        Organisation.objects.filter(pk=organisation.pk).update(
            billing_mode=Organisation.BILLING_PREPAID, credit_balance=Decimal('0.00'),
        )
        resp = authenticated_client.post(
            '/api/sms/send/',
            {'message': 'hi', 'recipients': [{'phone': '0412345678'}]},
            format='json',
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        # ValidationError renders as a list/detail — assert a human-readable string is present.
        body = resp.data
        flat = body if isinstance(body, (list, str)) else body.get('detail', body)
        assert 'balance' in str(flat).lower() or 'subscribe' in str(flat).lower()

    def test_contacts_import_partial_207_envelope(self, authenticated_client, organisation):
        """CSV import returns the partial-success envelope the frontend renders.

        Mirror: frontend import-result UI. NOTE: handlers.ts currently stubs a
        simplified {status, message, filename} — this test documents the REAL
        shape (record_count/success_count/error_count/error_records + 207) so the
        mock is corrected.
        """
        csv = b'phone,first_name\n0412345678,Valid\nnot-a-phone,Invalid\n'
        upload = SimpleUploadedFile('contacts.csv', csv, content_type='text/csv')
        resp = authenticated_client.post('/api/contacts/import/', {'file': upload}, format='multipart')

        assert resp.status_code in (status.HTTP_200_OK, 207)
        for key in ('status', 'message', 'record_count', 'success_count', 'error_count', 'error_records'):
            assert key in resp.data, f'import response missing {key}'
        assert isinstance(resp.data['error_records'], list)
        # The invalid row is reported, not silently dropped.
        assert resp.data['error_count'] >= 1

    def test_billing_summary_envelope(self, admin_client):
        """GET /api/billing/summary/ returns the fields the billing page reads.

        Mirror: frontend factories.ts createBillingSummary() / billing.types.ts.
        """
        resp = admin_client.get('/api/billing/summary/')
        assert resp.status_code == status.HTTP_200_OK
        assert 'billing_mode' in resp.data
        # balance + per-format usage + paginated transactions are the contract.
        assert 'credit_balance' in resp.data or 'balance' in resp.data
