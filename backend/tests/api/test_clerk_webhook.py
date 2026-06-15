"""
Tests for Clerk webhook endpoint.

Tests:
- POST /api/webhooks/clerk/ handles all event types
- Signature verification
- Event processing (user, organization, membership events)
"""

import json
import pytest
from django.test import override_settings
from unittest.mock import patch
from rest_framework import status

from app.models import Organisation, OrganisationMembership, User
from tests.factories import OrganisationFactory, OrganisationMembershipFactory, UserFactory


# Helper to mock webhook signature verification
def mock_webhook_verify(body, headers):
    """Mock svix.Webhook.verify() - parses and returns the JSON payload."""
    return json.loads(body)


@pytest.mark.django_db
class TestClerkWebhookSignature:
    """Signature verification outside TEST mode — previously untested.

    The endpoint must reject forged payloads: a signature failure returns 400
    and produces no side effects.
    """

    _payload = {
        'type': 'organization.created',
        'data': {'id': 'org_forged', 'name': 'Forged Org', 'slug': 'forged'},
    }

    @override_settings(TEST=False, CLERK_WEBHOOK_SIGNING_SECRET='whsec_dGVzdA==')
    @patch('svix.Webhook.verify')
    def test_invalid_signature_rejected_with_no_side_effects(self, mock_verify, api_client):
        from svix.webhooks import WebhookVerificationError
        mock_verify.side_effect = WebhookVerificationError('bad signature')

        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(self._payload),
            content_type='application/json',
            HTTP_SVIX_ID='msg_forged',
            HTTP_SVIX_TIMESTAMP='1700000000',
            HTTP_SVIX_SIGNATURE='v1,forged',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not Organisation.objects.filter(clerk_org_id='org_forged').exists()

    @override_settings(TEST=False, CLERK_WEBHOOK_SIGNING_SECRET='whsec_dGVzdA==')
    def test_missing_signature_headers_rejected(self, api_client):
        """Absent svix headers must fail verification, not be processed."""
        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(self._payload),
            content_type='application/json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not Organisation.objects.filter(clerk_org_id='org_forged').exists()

    @override_settings(TEST=False, CLERK_WEBHOOK_SIGNING_SECRET='')
    def test_missing_signing_secret_returns_500(self, api_client):
        """An unconfigured secret must fail closed, never skip verification."""
        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(self._payload),
            content_type='application/json',
        )

        assert response.status_code == 500
        assert not Organisation.objects.filter(clerk_org_id='org_forged').exists()


@pytest.mark.django_db
class TestClerkWebhookDedup:
    """Replay/duplicate suppression on the svix message id."""

    def _post(self, api_client, payload, svix_id):
        return api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(payload),
            content_type='application/json',
            HTTP_SVIX_ID=svix_id,
        )

    @patch('svix.Webhook.verify')
    def test_duplicate_delivery_processed_once(self, mock_verify, api_client):
        """Svix retries (same svix-id) must not re-run side effects like credit grants."""
        mock_verify.side_effect = mock_webhook_verify
        payload = {
            'type': 'organization.created',
            'data': {'id': 'org_dedup_1', 'name': 'Dedup Org', 'slug': 'dedup-org'},
        }

        first = self._post(api_client, payload, 'msg_dedup_1')
        second = self._post(api_client, payload, 'msg_dedup_1')

        assert first.status_code == status.HTTP_200_OK
        assert second.status_code == status.HTTP_200_OK
        assert second.data.get('duplicate') is True
        org = Organisation.objects.get(clerk_org_id='org_dedup_1')
        # Free signup credits granted exactly once
        grant = org.credittransaction_set.get(transaction_type='grant')
        assert org.credit_balance == grant.amount

    @patch('svix.Webhook.verify')
    def test_failed_handler_rolls_back_dedup_so_retry_reprocesses(self, mock_verify, api_client):
        """A 422 (deferred) delivery must remain retryable — the dedup row rolls back."""
        mock_verify.side_effect = mock_webhook_verify
        # membership for an unknown user → handler raises WebhookProcessingError (422)
        payload = {
            'type': 'organizationMembership.created',
            'data': {
                'public_user_data': {'user_id': 'user_not_synced_yet'},
                'organization': {'id': 'org_dedup_2', 'name': 'Org', 'slug': 'org'},
                'role': 'member',
            },
        }

        first = self._post(api_client, payload, 'msg_dedup_2')
        assert first.status_code == 422

        # User arrives, Svix redelivers the same message id — must be processed
        UserFactory(clerk_id='user_not_synced_yet')
        retry = self._post(api_client, payload, 'msg_dedup_2')

        assert retry.status_code == status.HTTP_200_OK
        assert retry.data.get('duplicate') is None
        assert OrganisationMembership.objects.filter(
            user__clerk_id='user_not_synced_yet',
            organisation__clerk_org_id='org_dedup_2',
        ).exists()


@pytest.mark.django_db
class TestClerkWebhook:
    """Tests for POST /api/webhooks/clerk/ endpoint."""

    @patch('svix.Webhook.verify')
    def test_user_created_event(self, mock_verify, api_client):
        """user.created webhook creates User."""
        mock_verify.side_effect = mock_webhook_verify

        payload = {
            'type': 'user.created',
            'data': {
                'id': 'user_123',
                'first_name': 'John',
                'last_name': 'Doe',
                'email_addresses': [{'email_address': 'john@example.com'}]
            }
        }

        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(payload),
            content_type='application/json'
        )

        assert response.status_code == status.HTTP_200_OK

        user = User.objects.get(clerk_id='user_123')
        assert user.first_name == 'John'
        assert user.email == 'john@example.com'

    @patch('svix.Webhook.verify')
    def test_user_updated_event(self, mock_verify, api_client):
        """user.updated webhook updates User."""
        mock_verify.side_effect = mock_webhook_verify

        user = UserFactory(clerk_id='user_123', first_name='Old')

        payload = {
            'type': 'user.updated',
            'data': {
                'id': 'user_123',
                'first_name': 'New',
                'last_name': 'Name',
                'email_addresses': [{'email_address': 'updated@example.com'}]
            }
        }

        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(payload),
            content_type='application/json'
        )

        assert response.status_code == status.HTTP_200_OK

        user.refresh_from_db()
        assert user.first_name == 'New'
        assert user.email == 'updated@example.com'

    @patch('svix.Webhook.verify')
    def test_user_deleted_event(self, mock_verify, api_client):
        """user.deleted webhook soft-deletes User."""
        mock_verify.side_effect = mock_webhook_verify

        user = UserFactory(clerk_id='user_123')

        payload = {
            'type': 'user.deleted',
            'data': {'id': 'user_123'}
        }

        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(payload),
            content_type='application/json'
        )

        assert response.status_code == status.HTTP_200_OK

        user.refresh_from_db()
        assert user.is_active is False

    @patch('svix.Webhook.verify')
    def test_organization_created_event(self, mock_verify, api_client):
        """organization.created webhook creates Organisation."""
        mock_verify.side_effect = mock_webhook_verify

        payload = {
            'type': 'organization.created',
            'data': {
                'id': 'org_123',
                'name': 'Acme Corp',
                'slug': 'acme-corp'
            }
        }

        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(payload),
            content_type='application/json'
        )

        assert response.status_code == status.HTTP_200_OK

        org = Organisation.objects.get(clerk_org_id='org_123')
        assert org.name == 'Acme Corp'
        assert org.slug == 'acme-corp'

    @patch('svix.Webhook.verify')
    def test_organization_updated_event(self, mock_verify, api_client):
        """organization.updated webhook updates Organisation."""
        mock_verify.side_effect = mock_webhook_verify

        org = OrganisationFactory(clerk_org_id='org_123', name='Old')

        payload = {
            'type': 'organization.updated',
            'data': {
                'id': 'org_123',
                'name': 'New Name',
                'slug': 'new-slug'
            }
        }

        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(payload),
            content_type='application/json'
        )

        assert response.status_code == status.HTTP_200_OK

        org.refresh_from_db()
        assert org.name == 'New Name'

    @patch('svix.Webhook.verify')
    def test_organization_deleted_event(self, mock_verify, api_client):
        """organization.deleted webhook soft-deletes Organisation."""
        mock_verify.side_effect = mock_webhook_verify

        org = OrganisationFactory(clerk_org_id='org_123')

        payload = {
            'type': 'organization.deleted',
            'data': {'id': 'org_123'}
        }

        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(payload),
            content_type='application/json'
        )

        assert response.status_code == status.HTTP_200_OK

        org.refresh_from_db()
        assert org.is_active is False

    @patch('svix.Webhook.verify')
    def test_organization_membership_created_event(self, mock_verify, api_client):
        """organizationMembership.created webhook creates membership."""
        mock_verify.side_effect = mock_webhook_verify

        user = UserFactory(clerk_id='user_123')
        org = OrganisationFactory(clerk_org_id='org_123')

        payload = {
            'type': 'organizationMembership.created',
            'data': {
                'organization': {'id': 'org_123'},
                'public_user_data': {'user_id': 'user_123'},
                'role': 'admin'
            }
        }

        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(payload),
            content_type='application/json'
        )

        assert response.status_code == status.HTTP_200_OK

        membership = OrganisationMembership.objects.get(user=user, organisation=org)
        assert membership.role == 'admin'

    @patch('svix.Webhook.verify')
    def test_organization_membership_updated_event(self, mock_verify, api_client):
        """organizationMembership.updated webhook updates membership."""
        mock_verify.side_effect = mock_webhook_verify

        user = UserFactory(clerk_id='user_123')
        org = OrganisationFactory(clerk_org_id='org_123')
        OrganisationMembershipFactory(user=user, organisation=org, role='member')

        payload = {
            'type': 'organizationMembership.updated',
            'data': {
                'organization': {'id': 'org_123'},
                'public_user_data': {'user_id': 'user_123'},
                'role': 'admin'
            }
        }

        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(payload),
            content_type='application/json'
        )

        assert response.status_code == status.HTTP_200_OK

        membership = OrganisationMembership.objects.get(user=user, organisation=org)
        assert membership.role == 'admin'

    @patch('svix.Webhook.verify')
    def test_organization_membership_deleted_event(self, mock_verify, api_client):
        """organizationMembership.deleted webhook soft-deletes membership."""
        mock_verify.side_effect = mock_webhook_verify

        user = UserFactory(clerk_id='user_123')
        org = OrganisationFactory(clerk_org_id='org_123')
        from tests.factories import OrganisationMembershipFactory
        membership = OrganisationMembershipFactory(user=user, organisation=org)

        payload = {
            'type': 'organizationMembership.deleted',
            'data': {
                'organization': {'id': 'org_123'},
                'public_user_data': {'user_id': 'user_123'}
            }
        }

        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(payload),
            content_type='application/json'
        )

        assert response.status_code == status.HTTP_200_OK

        membership.refresh_from_db()
        assert membership.is_active is False

    @override_settings(TEST=False)
    def test_webhook_requires_valid_signature(self, api_client):
        """Webhook rejects requests with invalid signature."""
        payload = {
            'type': 'user.created',
            'data': {'id': 'user_123'}
        }

        # Without signature verification mock, should fail
        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(payload),
            content_type='application/json'
        )

        # Should either be 401/403 or 400 depending on implementation
        assert response.status_code in [
            status.HTTP_400_BAD_REQUEST,
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN
        ]

    @patch('svix.Webhook.verify')
    def test_webhook_handles_unknown_event_type(self, mock_verify, api_client):
        """Unknown event types handled gracefully."""
        mock_verify.side_effect = mock_webhook_verify

        payload = {
            'type': 'unknown.event',
            'data': {}
        }

        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(payload),
            content_type='application/json'
        )

        # Should return 200 (idempotent) or 400
        assert response.status_code in [
            status.HTTP_200_OK,
            status.HTTP_400_BAD_REQUEST
        ]

    @patch('svix.Webhook.verify')
    def test_subscription_active_transitions_org_to_subscribed(self, mock_verify, api_client):
        """subscription.active webhook sets org billing_mode to subscribed."""
        mock_verify.side_effect = mock_webhook_verify

        org = OrganisationFactory(clerk_org_id='org_billing_active', billing_mode=Organisation.BILLING_PREPAID)

        payload = {
            'type': 'subscription.active',
            'data': {'payer': {'organization_id': 'org_billing_active'}},
        }

        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(payload),
            content_type='application/json',
        )

        assert response.status_code == status.HTTP_200_OK
        org.refresh_from_db()
        assert org.billing_mode == Organisation.BILLING_SUBSCRIBED

    @patch('svix.Webhook.verify')
    def test_subscription_updated_canceled_reverts_org_to_prepaid(self, mock_verify, api_client):
        """subscription.updated with status=canceled reverts org billing_mode to prepaid."""
        mock_verify.side_effect = mock_webhook_verify

        org = OrganisationFactory(clerk_org_id='org_billing_cancel', billing_mode=Organisation.BILLING_SUBSCRIBED)

        payload = {
            'type': 'subscription.updated',
            'data': {'payer': {'organization_id': 'org_billing_cancel'}, 'status': 'canceled'},
        }

        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(payload),
            content_type='application/json',
        )

        assert response.status_code == status.HTTP_200_OK
        org.refresh_from_db()
        assert org.billing_mode == Organisation.BILLING_PREPAID

    @patch('svix.Webhook.verify')
    def test_subscription_updated_ended_reverts_org_to_prepaid(self, mock_verify, api_client):
        """subscription.updated with status=ended reverts org billing_mode to prepaid."""
        mock_verify.side_effect = mock_webhook_verify

        org = OrganisationFactory(clerk_org_id='org_billing_ended', billing_mode=Organisation.BILLING_SUBSCRIBED)

        payload = {
            'type': 'subscription.updated',
            'data': {'payer': {'organization_id': 'org_billing_ended'}, 'status': 'ended'},
        }

        response = api_client.post(
            '/api/webhooks/clerk/',
            data=json.dumps(payload),
            content_type='application/json',
        )

        assert response.status_code == status.HTTP_200_OK
        org.refresh_from_db()
        assert org.billing_mode == Organisation.BILLING_PREPAID

    @patch('svix.Webhook.verify')
    def test_subscription_past_due_sets_past_due_billing_mode(self, mock_verify, api_client):
        """subscription.pastDue webhook sets billing_mode to past_due and blocks sends."""
        mock_verify.side_effect = mock_webhook_verify

        org = OrganisationFactory(clerk_org_id='org_billing_pastdue', billing_mode=Organisation.BILLING_SUBSCRIBED)

        payload = {
            'type': 'subscription.pastDue',
            'data': {'id': 'sub_123', 'payer': {'organization_id': 'org_billing_pastdue'}},
        }

        with patch('app.utils.clerk.Clerk'):
            response = api_client.post(
                '/api/webhooks/clerk/',
                data=json.dumps(payload),
                content_type='application/json',
            )

        assert response.status_code == status.HTTP_200_OK
        org.refresh_from_db()
        assert org.billing_mode == Organisation.BILLING_PAST_DUE
