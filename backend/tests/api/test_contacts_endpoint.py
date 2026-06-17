"""
Tests for Contact API endpoints (ContactViewSet).

Tests:
- CRUD operations (list, create, retrieve, update, delete)
- Multi-tenancy isolation
- Pagination
- Search filtering
- CSV import (@action import_csv)
- Bulk operations
"""

import io
from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError
from rest_framework import status

from app.models import Contact
from tests.factories import (
    ContactFactory,
    ContactGroupFactory,
    ContactGroupMemberFactory,
    OrganisationFactory,
    UserFactory,
)


@pytest.mark.django_db
class TestContactList:
    """Tests for GET /api/contacts/ endpoint."""

    def test_list_returns_org_contacts(self, authenticated_client, organisation, user):
        """List returns only contacts from user's organisation."""
        # Create contacts in user's org
        contact1 = ContactFactory(organisation=organisation, created_by=user)
        contact2 = ContactFactory(organisation=organisation, created_by=user)

        # Create contact in different org (should not appear)
        other_org = OrganisationFactory()
        ContactFactory(organisation=other_org)

        response = authenticated_client.get('/api/contacts/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 2
        phones = [c['phone'] for c in response.data['results']]
        assert contact1.phone in phones
        assert contact2.phone in phones

    def test_list_pagination(self, authenticated_client, organisation, user):
        """List paginates results."""
        # Create 15 contacts
        ContactFactory.create_batch(
            15,
            organisation=organisation,
            created_by=user,
            updated_by=user
        )

        response = authenticated_client.get('/api/contacts/')

        assert response.status_code == status.HTTP_200_OK
        assert 'pagination' in response.data
        assert 'results' in response.data
        assert response.data['pagination']['total'] == 15
        assert len(response.data['results']) <= 50  # Default page size

    def test_list_search(self, authenticated_client, organisation, user):
        """Search filters contacts by phone/name."""
        contact1 = ContactFactory(
            organisation=organisation,
            phone='0412345678',
            first_name='Alice',
            created_by=user,
            updated_by=user
        )
        contact2 = ContactFactory(
            organisation=organisation,
            phone='0487654321',
            first_name='Bob',
            created_by=user,
            updated_by=user
        )

        response = authenticated_client.get('/api/contacts/?search=Alice')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1
        assert response.data['results'][0]['phone'] == contact1.phone

    def test_list_search_by_phone_digits(self, authenticated_client, organisation, user):
        """Search filters contacts by phone when digits provided."""
        contact1 = ContactFactory(
            organisation=organisation,
            phone='0412345678',
            first_name='Alice',
            created_by=user,
            updated_by=user
        )
        contact2 = ContactFactory(
            organisation=organisation,
            phone='0487654321',
            first_name='Bob',
            created_by=user,
            updated_by=user
        )

        # Search by full phone number
        response = authenticated_client.get('/api/contacts/?search=0412345678')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1
        assert response.data['results'][0]['phone'] == contact1.phone

        # Search by partial phone number
        response = authenticated_client.get('/api/contacts/?search=0412')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1
        assert response.data['results'][0]['phone'] == contact1.phone

    def test_list_search_by_phone_with_spaces(self, authenticated_client, organisation, user):
        """Search handles phone numbers with spaces."""
        contact = ContactFactory(
            organisation=organisation,
            phone='0412345678',
            first_name='Alice',
            created_by=user,
            updated_by=user
        )

        # Phone with spaces should still match (spaces removed by filter)
        response = authenticated_client.get('/api/contacts/?search=041%20234%205678')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1
        assert response.data['results'][0]['phone'] == contact.phone

    def test_list_search_name_not_affected_by_phone_logic(self, authenticated_client, organisation, user):
        """Search still works for names when non-digits present."""
        contact = ContactFactory(
            organisation=organisation,
            phone='0412345678',
            first_name='Alice123',
            created_by=user,
            updated_by=user
        )

        # Mixed alphanumeric should search name, not phone
        response = authenticated_client.get('/api/contacts/?search=Alice')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1

    def test_list_exclude_group(self, authenticated_client, organisation, user):
        """exclude_group_id filters out group members."""
        group = ContactGroupFactory(organisation=organisation, created_by=user)
        contact1 = ContactFactory(organisation=organisation, created_by=user)
        contact2 = ContactFactory(organisation=organisation, created_by=user)

        # Add contact1 to group
        ContactGroupMemberFactory(contact=contact1, group=group)

        response = authenticated_client.get(f'/api/contacts/?exclude_group_id={group.id}')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['pagination']['total'] == 1
        assert response.data['results'][0]['phone'] == contact2.phone

    def test_list_requires_authentication(self, api_client):
        """Unauthenticated requests denied."""
        response = api_client.get('/api/contacts/')
        assert response.status_code in [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN]


@pytest.mark.django_db
class TestContactCreate:
    """Tests for POST /api/contacts/ endpoint."""

    def test_create_contact(self, authenticated_client, organisation):
        """Creating contact succeeds with valid data."""
        data = {
            'phone': '0412345678',
            'first_name': 'John',
            'last_name': 'Doe',
            'email': 'john@example.com'
        }

        response = authenticated_client.post('/api/contacts/', data)

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['phone'] == '0412345678'

        contact = Contact.objects.get(id=response.data['id'])
        assert contact.organisation == organisation
        assert contact.first_name == 'John'

    def test_create_normalizes_phone(self, authenticated_client):
        """Phone number normalized on create."""
        data = {
            'phone': '+61412345678',
            'first_name': 'Test',
            'last_name': 'User'
        }

        response = authenticated_client.post('/api/contacts/', data)

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['phone'] == '0412345678'

    def test_create_validates_phone(self, authenticated_client):
        """Invalid phone rejected."""
        data = {
            'phone': 'invalid',
            'first_name': 'Test'
        }

        response = authenticated_client.post('/api/contacts/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'phone' in response.data

    def test_create_enforces_unique_phone_per_org(self, authenticated_client, organisation, user):
        """Duplicate phone in same org rejected."""
        ContactFactory(organisation=organisation, phone='0412345678', created_by=user)

        data = {
            'phone': '0412345678',
            'first_name': 'Duplicate'
        }

        response = authenticated_client.post('/api/contacts/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestContactRetrieve:
    """Tests for GET /api/contacts/{id}/ endpoint."""

    def test_retrieve_contact(self, authenticated_client, organisation, user):
        """Retrieving contact by ID succeeds."""
        contact = ContactFactory(organisation=organisation, created_by=user)

        response = authenticated_client.get(f'/api/contacts/{contact.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['id'] == contact.id
        assert response.data['phone'] == contact.phone

    def test_retrieve_enforces_org_isolation(self, authenticated_client):
        """Cannot retrieve contact from different org."""
        other_org = OrganisationFactory()
        contact = ContactFactory(organisation=other_org)

        response = authenticated_client.get(f'/api/contacts/{contact.id}/')

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestContactUpdate:
    """Tests for PUT/PATCH /api/contacts/{id}/ endpoint."""

    def test_update_contact(self, authenticated_client, organisation, user):
        """Updating contact succeeds."""
        contact = ContactFactory(organisation=organisation, first_name='Old', created_by=user)

        data = {
            'phone': contact.phone,
            'first_name': 'New',
            'last_name': contact.last_name
        }

        response = authenticated_client.put(f'/api/contacts/{contact.id}/', data)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['first_name'] == 'New'

        contact.refresh_from_db()
        assert contact.first_name == 'New'

    def test_partial_update(self, authenticated_client, organisation, user):
        """PATCH allows partial updates."""
        contact = ContactFactory(organisation=organisation, first_name='Old', created_by=user)

        data = {'first_name': 'Updated'}

        response = authenticated_client.patch(f'/api/contacts/{contact.id}/', data)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['first_name'] == 'Updated'

    def test_update_enforces_org_isolation(self, authenticated_client):
        """Cannot update contact from different org."""
        other_org = OrganisationFactory()
        contact = ContactFactory(organisation=other_org)

        data = {'first_name': 'Hacked'}

        response = authenticated_client.patch(f'/api/contacts/{contact.id}/', data)

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestContactDelete:
    """Tests for DELETE /api/contacts/{id}/ endpoint."""

    def test_delete_contact(self, authenticated_client, organisation, user):
        """Deleting contact succeeds."""
        contact = ContactFactory(organisation=organisation, created_by=user)

        response = authenticated_client.delete(f'/api/contacts/{contact.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT

        contact.refresh_from_db()
        assert contact.is_active is False  # Soft delete

    def test_delete_enforces_org_isolation(self, authenticated_client):
        """Cannot delete contact from different org."""
        other_org = OrganisationFactory()
        contact = ContactFactory(organisation=other_org)

        response = authenticated_client.delete(f'/api/contacts/{contact.id}/')

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestContactImportCSV:
    """Tests for POST /api/contacts/import/ endpoint."""

    def test_import_csv_creates_contacts(self, authenticated_client, organisation):
        """CSV import creates contacts."""
        csv_content = b'phone,first_name,last_name,email\n0412345678,John,Doe,john@example.com\n0487654321,Jane,Smith,jane@example.com'
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        response = authenticated_client.post(
            '/api/contacts/import/',
            {'file': csv_file},
            format='multipart'
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['record_count'] == 2
        assert response.data['success_count'] == 2
        assert response.data['error_count'] == 0
        assert response.data['status'] == 'success'

        # Verify contacts created
        assert Contact.objects.filter(organisation=organisation).count() == 2

    def test_import_csv_rejects_too_many_rows(self, authenticated_client, organisation):
        """Imports beyond the row ceiling are rejected with 413 and import nothing extra.

        Regression test: a 5 MB CSV can hold ~250k rows — unbounded iteration
        tied up a worker and the DB for minutes.
        """
        from unittest.mock import patch as mock_patch

        from app.views import ContactViewSet

        rows = '\n'.join(f'04{i:08d},Bulk' for i in range(5))
        csv_content = f'phone,first_name\n{rows}'.encode()
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        with mock_patch.object(ContactViewSet, 'IMPORT_MAX_ROWS', 3):
            response = authenticated_client.post(
                '/api/contacts/import/', {'file': csv_file}, format='multipart',
            )

        assert response.status_code == status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
        assert 'too many rows' in str(response.data).lower()

    def test_import_csv_skips_invalid_rows(self, authenticated_client, organisation):
        """CSV import skips invalid rows and reports errors."""
        csv_content = b'phone,first_name\n0412345678,Valid\ninvalid-phone,Invalid\n0487654321,Valid2'
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        response = authenticated_client.post(
            '/api/contacts/import/',
            {'file': csv_file},
            format='multipart'
        )

        assert response.status_code == 207  # Multi-Status when there are errors
        assert response.data['record_count'] == 3
        assert response.data['success_count'] == 2  # Only valid rows
        assert response.data['error_count'] == 1
        assert response.data['status'] == 'partial'

    def test_import_csv_requires_file(self, authenticated_client):
        """Import without file rejected."""
        response = authenticated_client.post(
            '/api/contacts/import/',
            {},
            format='multipart'
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_import_phone_normalization_before_duplicate_check(
        self, authenticated_client, organisation
    ):
        """CSV import normalises +61 numbers before checking for duplicates.

        A contact saved as '0412345678' and an import row with '+61412345678'
        (same number, different format) should be flagged as a duplicate, not
        create a second contact.
        """
        from tests.factories import ContactFactory
        ContactFactory(organisation=organisation, phone='0412345678')

        # Import the same number in +61 format
        csv_content = b'phone,first_name\n+61412345678,Duplicate'
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        response = authenticated_client.post(
            '/api/contacts/import/',
            {'file': csv_file},
            format='multipart'
        )

        # 207 Multi-Status when all rows have errors; 200 if mixed
        assert response.status_code in (status.HTTP_200_OK, 207)
        # Should be flagged as duplicate — no new contact created
        assert response.data['error_count'] == 1
        assert Contact.objects.filter(organisation=organisation).count() == 1


@pytest.mark.django_db
class TestContactImportCSVEdgeCases:
    """Duplicate-detection, normalisation, and failure-surfacing edges for CSV import."""

    def test_dup_detection_is_org_scoped(self, authenticated_client, organisation):
        """A phone that exists in ANOTHER org is not a duplicate — it imports cleanly.

        Duplicate detection seeds existing_phones from this org only, so a
        cross-org collision must not be flagged.
        """
        other_org = OrganisationFactory()
        # Same phone, different org — must not block this org's import.
        ContactFactory(organisation=other_org, phone='0412345678')

        csv_content = b'phone,first_name\n0412345678,Mine'
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        response = authenticated_client.post(
            '/api/contacts/import/', {'file': csv_file}, format='multipart',
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['success_count'] == 1
        assert response.data['error_count'] == 0
        # Created in this org; the other org's contact is untouched.
        assert Contact.objects.filter(organisation=organisation, phone='0412345678').count() == 1
        assert Contact.objects.filter(organisation=other_org, phone='0412345678').count() == 1

    def test_cross_org_phone_collision_is_importable(self, authenticated_client, organisation):
        """The (organisation, phone) unique constraint is per-org, so the same number
        can be imported even though it already exists under a different org."""
        other_org = OrganisationFactory()
        ContactFactory(organisation=other_org, phone='0487654321')

        csv_content = b'phone,first_name,last_name\n0487654321,Jane,Smith'
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        response = authenticated_client.post(
            '/api/contacts/import/', {'file': csv_file}, format='multipart',
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['success_count'] == 1
        created = Contact.objects.get(organisation=organisation, phone='0487654321')
        assert created.first_name == 'Jane'

    def test_in_file_duplicate_is_deduplicated(self, authenticated_client, organisation):
        """The same number appearing twice in one file: first imported, second flagged."""
        csv_content = b'phone,first_name\n0412345678,First\n0412345678,Second'
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        response = authenticated_client.post(
            '/api/contacts/import/', {'file': csv_file}, format='multipart',
        )

        assert response.status_code == 207  # mixed: one success, one error
        assert response.data['success_count'] == 1
        assert response.data['error_count'] == 1
        # Only one row persisted despite two file rows for the same number.
        assert Contact.objects.filter(organisation=organisation, phone='0412345678').count() == 1

    def test_in_file_duplicate_across_phone_formats_is_deduplicated(
        self, authenticated_client, organisation,
    ):
        """Two rows for the same number in different formats (+61 vs 04) dedupe to one.

        Normalisation runs BEFORE the in-file dedup set is consulted, so
        '+61412345678' and '0412345678' collapse to a single contact.
        """
        csv_content = b'phone,first_name\n+61 412 345 678,A\n0412345678,B'
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        response = authenticated_client.post(
            '/api/contacts/import/', {'file': csv_file}, format='multipart',
        )

        assert response.status_code == 207
        assert response.data['success_count'] == 1
        assert response.data['error_count'] == 1
        assert Contact.objects.filter(organisation=organisation, phone='0412345678').count() == 1

    def test_plus61_and_spaced_numbers_are_normalised(self, authenticated_client, organisation):
        """`+61` prefixes and embedded spaces are normalised to the canonical 04XXXXXXXX."""
        csv_content = (
            b'phone,first_name\n'
            b'+61412000111,PlusPrefix\n'
            b'04 1200 0222,Spaced\n'
            b'+61 412 000 333,PlusSpaced'
        )
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        response = authenticated_client.post(
            '/api/contacts/import/', {'file': csv_file}, format='multipart',
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['success_count'] == 3
        assert response.data['error_count'] == 0
        phones = set(
            Contact.objects.filter(organisation=organisation).values_list('phone', flat=True)
        )
        assert phones == {'0412000111', '0412000222', '0412000333'}

    def test_bulk_create_race_falls_back_per_row_not_500(self, authenticated_client, organisation):
        """A race that makes bulk_create raise IntegrityError must not 500.

        Simulates a concurrent insert landing between the existing_phones snapshot
        and bulk_create (the snapshot says "new", the DB says "taken"). The view
        catches the IntegrityError and falls back to per-row inserts: valid rows are
        imported and any row that still collides goes into error_records — never an
        unhandled 500.
        """
        csv_content = b'phone,first_name\n0412345678,Racey'
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        with patch.object(
            Contact.objects, 'bulk_create',
            side_effect=IntegrityError('duplicate key value violates unique constraint'),
        ):
            response = authenticated_client.post(
                '/api/contacts/import/', {'file': csv_file}, format='multipart',
            )

        # Graceful per-row fallback: not a 500, and the valid row is actually imported.
        assert response.status_code != status.HTTP_500_INTERNAL_SERVER_ERROR
        assert response.status_code == status.HTTP_200_OK
        assert Contact.objects.filter(organisation=organisation, phone='0412345678').exists()


@pytest.mark.django_db
class TestContactImportCSVNegative:
    """Negative-path CSV imports: missing columns, empty files, and malformed
    encodings. These pin the import endpoint's ACTUAL behaviour (see
    ContactViewSet.import_contacts) so a regression in any of these surfaces.
    """

    def test_no_phone_column_reports_every_row_as_error(self, authenticated_client, organisation):
        """A CSV without a `phone` column imports nothing — every data row is
        reported in error_records (the view reads row.get('phone', '') → '',
        which fails the phone regex), and no contacts are created."""
        csv_content = b'name,email\nAlice,alice@example.com\nBob,bob@example.com'
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        response = authenticated_client.post(
            '/api/contacts/import/', {'file': csv_file}, format='multipart',
        )

        assert response.status_code == 207  # all rows errored
        assert response.data['success_count'] == 0
        assert response.data['error_count'] == 2
        assert response.data['record_count'] == 2
        # Phone is required, so the rows are flagged with the phone-format error.
        assert all('phone' in rec['error'].lower() for rec in response.data['error_records'])
        assert Contact.objects.filter(organisation=organisation).count() == 0

    def test_header_only_csv_imports_nothing_with_success(self, authenticated_client, organisation):
        """A header row with zero data rows is a clean no-op: 200, success_count 0."""
        csv_content = b'phone,first_name,last_name\n'
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        response = authenticated_client.post(
            '/api/contacts/import/', {'file': csv_file}, format='multipart',
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['status'] == 'success'
        assert response.data['success_count'] == 0
        assert response.data['error_count'] == 0
        assert response.data['record_count'] == 0
        assert Contact.objects.filter(organisation=organisation).count() == 0

    def test_completely_empty_csv_imports_nothing_with_success(self, authenticated_client, organisation):
        """An empty file (no header, no rows) yields no rows to iterate: 200, 0/0."""
        csv_file = SimpleUploadedFile('contacts.csv', b'', content_type='text/csv')

        response = authenticated_client.post(
            '/api/contacts/import/', {'file': csv_file}, format='multipart',
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['success_count'] == 0
        assert response.data['error_count'] == 0
        assert Contact.objects.filter(organisation=organisation).count() == 0

    def test_utf8_bom_header_breaks_phone_column_and_rows_error(self, authenticated_client, organisation):
        """A UTF-8 BOM prefixes the first header name with '\\ufeff', so the
        column is read as '\\ufeffphone' not 'phone'. The view decodes with
        plain 'utf-8' (not 'utf-8-sig'), so row.get('phone') misses and every
        row is reported as an error — no contacts created.

        This documents the current (lossy) behaviour: a BOM-prefixed export
        from Excel silently fails every row rather than being normalised. See
        prodCodeChangeNeeded for the encoding='utf-8-sig' fix.
        """
        # UTF-8 BOM + valid header + one valid-looking data row.
        csv_content = '﻿phone,first_name\n0412345678,Bom'.encode('utf-8')
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        response = authenticated_client.post(
            '/api/contacts/import/', {'file': csv_file}, format='multipart',
        )

        assert response.status_code == 207
        assert response.data['success_count'] == 0
        assert response.data['error_count'] == 1
        assert Contact.objects.filter(organisation=organisation).count() == 0

    def test_malformed_utf8_raises_unicode_error_unhandled(self, authenticated_client, organisation):
        """A file with invalid UTF-8 bytes raises UnicodeDecodeError during row
        iteration, which is OUTSIDE the view's try/except (that only wraps
        DictReader construction). The exception propagates as a 500 and is
        re-raised by the test client.

        This pins the ACTUAL behaviour: the import does NOT return a friendly
        400 for malformed encodings. See prodCodeChangeNeeded — the row loop
        should be wrapped so a bad encoding becomes a 400 with guidance.
        """
        # 0xff is never a valid UTF-8 start byte.
        csv_content = b'phone,first_name\n0412345678,Jo\xffhn'
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        with pytest.raises(UnicodeDecodeError):
            authenticated_client.post(
                '/api/contacts/import/', {'file': csv_file}, format='multipart',
            )

        assert Contact.objects.filter(organisation=organisation).count() == 0

    def test_concurrent_same_phone_insert_falls_back_to_error_record(
        self, authenticated_client, organisation,
    ):
        """A concurrent insert that lands AFTER the existing_phones snapshot but
        BEFORE bulk_create makes bulk_create raise IntegrityError. The view
        retries per-row; the colliding row already exists in the DB so its
        per-row save also raises IntegrityError and the row is surfaced in
        error_records — never an unhandled 500.

        Simulated by: pre-creating the contact (so per-row save collides) and
        forcing bulk_create to raise as if the snapshot had been stale.
        """
        # The row's number already exists in the DB (the "concurrent insert").
        ContactFactory(organisation=organisation, phone='0412345678', first_name='Existing')

        csv_content = b'phone,first_name\n0412345678,Racing'
        csv_file = SimpleUploadedFile('contacts.csv', csv_content, content_type='text/csv')

        # Force the IntegrityError fallback path: pretend the snapshot was taken
        # before the concurrent insert, so the row passed the in-memory dup check
        # and only collides at write time.
        with patch.object(
            Contact.objects, 'bulk_create',
            side_effect=IntegrityError('duplicate key value violates unique constraint'),
        ):
            response = authenticated_client.post(
                '/api/contacts/import/', {'file': csv_file}, format='multipart',
            )

        # Per-row fallback surfaces the collision as an error, not a 500.
        assert response.status_code != status.HTTP_500_INTERNAL_SERVER_ERROR
        assert response.status_code == 207
        assert response.data['success_count'] == 0
        assert response.data['error_count'] == 1
        assert response.data['error_records'][0]['phone'] == '0412345678'
        assert 'already exists' in response.data['error_records'][0]['error'].lower()
        # The pre-existing contact is untouched (still one row, original name).
        contacts = Contact.objects.filter(organisation=organisation, phone='0412345678')
        assert contacts.count() == 1
        assert contacts.first().first_name == 'Existing'
