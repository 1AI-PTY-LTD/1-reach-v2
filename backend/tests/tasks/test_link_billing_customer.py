"""Tests for the link_billing_customer Celery task."""

from unittest.mock import patch

import pytest

from app.celery import link_billing_customer
from app.models import Organisation


@pytest.mark.django_db
class TestLinkBillingCustomer:
    def test_deleted_org_skips_cleanly(self, caplog, propagate_app_logs):
        """Org deleted while retries were pending — task exits without raising."""
        org = Organisation.objects.create(
            clerk_org_id='org_link_deleted',
            name='Doomed Org',
            slug='doomed-org',
        )
        pk = org.pk
        org.delete()

        with patch('app.celery.get_billing_provider') as mock_provider:
            with caplog.at_level('INFO', logger='app.celery'):
                link_billing_customer(pk)

        mock_provider.assert_not_called()
        assert any('deleted, skipping' in r.message for r in caplog.records)

    def test_already_linked_org_returns_early(self):
        org = Organisation.objects.create(
            clerk_org_id='org_link_done',
            name='Linked Org',
            slug='linked-org',
            billing_customer_id='cus_existing',
        )

        with patch('app.celery.get_billing_provider') as mock_provider:
            link_billing_customer(org.pk)

        mock_provider.assert_not_called()
