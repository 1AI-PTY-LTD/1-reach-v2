"""Tests for the alphanumeric-sender validators in app.views.

Two helpers, both keyed on an org's ``allowed_alphanumeric_senders`` Config row
(a JSON list stored as free-form text):

- ``_allowed_alphanumeric_senders(org)``: parse the allowlist, tolerating a
  missing row, malformed JSON, or a non-list payload by returning ``[]``.
- ``_validate_alphanumeric_sender(org, sender)``: raise ValidationError unless
  ``sender`` is a member of that allowlist.
"""

import json

import pytest
from rest_framework.exceptions import ValidationError

from app.models import Config
from app.views import _allowed_alphanumeric_senders, _validate_alphanumeric_sender


def _set_allowlist_config(org, value):
    """Create/overwrite the allowlist Config row with a raw string value."""
    Config.objects.update_or_create(
        organisation=org,
        name='allowed_alphanumeric_senders',
        defaults={'value': value},
    )


@pytest.mark.django_db
class TestAllowedAlphanumericSenders:
    def test_no_config_returns_empty_list(self, organisation):
        """No Config row at all -> empty allowlist."""
        assert _allowed_alphanumeric_senders(organisation) == []

    def test_valid_json_list_parsed(self, organisation):
        _set_allowlist_config(organisation, json.dumps(['ACME', 'PromoCo']))
        assert _allowed_alphanumeric_senders(organisation) == ['ACME', 'PromoCo']

    def test_empty_json_list_returns_empty(self, organisation):
        _set_allowlist_config(organisation, '[]')
        assert _allowed_alphanumeric_senders(organisation) == []

    def test_malformed_json_treated_as_empty(self, organisation):
        """Bad JSON must not raise — it reads as 'no senders allowed'."""
        _set_allowlist_config(organisation, 'ACME, PromoCo')  # not JSON
        assert _allowed_alphanumeric_senders(organisation) == []

    def test_blank_value_treated_as_empty(self, organisation):
        _set_allowlist_config(organisation, '')
        assert _allowed_alphanumeric_senders(organisation) == []

    def test_json_object_not_a_list_returns_empty(self, organisation):
        """Valid JSON that isn't a list (e.g. an object) -> empty."""
        _set_allowlist_config(organisation, json.dumps({'ACME': True}))
        assert _allowed_alphanumeric_senders(organisation) == []

    def test_json_string_not_a_list_returns_empty(self, organisation):
        """Valid JSON scalar (a bare string) -> empty, not iterated char-by-char."""
        _set_allowlist_config(organisation, json.dumps('ACME'))
        assert _allowed_alphanumeric_senders(organisation) == []

    def test_json_null_returns_empty(self, organisation):
        _set_allowlist_config(organisation, 'null')
        assert _allowed_alphanumeric_senders(organisation) == []

    def test_scoped_to_org(self, organisation, another_org):
        """Allowlist is read from the passed org only."""
        _set_allowlist_config(organisation, json.dumps(['ACME']))
        _set_allowlist_config(another_org, json.dumps(['OTHER']))
        assert _allowed_alphanumeric_senders(organisation) == ['ACME']
        assert _allowed_alphanumeric_senders(another_org) == ['OTHER']


@pytest.mark.django_db
class TestValidateAlphanumericSender:
    def test_sender_in_allowlist_passes(self, organisation):
        _set_allowlist_config(organisation, json.dumps(['ACME', 'PromoCo']))
        # Should not raise.
        _validate_alphanumeric_sender(organisation, 'ACME')
        _validate_alphanumeric_sender(organisation, 'PromoCo')

    def test_sender_not_in_allowlist_raises(self, organisation):
        _set_allowlist_config(organisation, json.dumps(['ACME']))
        with pytest.raises(ValidationError) as exc_info:
            _validate_alphanumeric_sender(organisation, 'NotAllowed')
        assert 'not permitted' in str(exc_info.value).lower()

    def test_no_config_rejects_any_sender(self, organisation):
        """With no allowlist, every sender is rejected (default-deny)."""
        with pytest.raises(ValidationError):
            _validate_alphanumeric_sender(organisation, 'ACME')

    def test_malformed_config_rejects_any_sender(self, organisation):
        """Malformed JSON reads as empty -> every sender rejected."""
        _set_allowlist_config(organisation, '{not json')
        with pytest.raises(ValidationError):
            _validate_alphanumeric_sender(organisation, 'ACME')

    def test_empty_allowlist_rejects(self, organisation):
        _set_allowlist_config(organisation, '[]')
        with pytest.raises(ValidationError):
            _validate_alphanumeric_sender(organisation, 'ACME')

    def test_membership_is_exact_match(self, organisation):
        """Substring / case variants are not members."""
        _set_allowlist_config(organisation, json.dumps(['ACME']))
        with pytest.raises(ValidationError):
            _validate_alphanumeric_sender(organisation, 'acme')  # case-sensitive
        with pytest.raises(ValidationError):
            _validate_alphanumeric_sender(organisation, 'ACM')   # substring
