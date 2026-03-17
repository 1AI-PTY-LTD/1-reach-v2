import logging

from django.conf import settings

from app.utils.billing import grant_credits
from ..models import *

logger = logging.getLogger(__name__)


# Webhooks
def _handle_user_created(data):
    email = ''
    email_addresses = data.get('email_addresses', [])
    for addr in email_addresses:
        if addr.get('id') == data.get('primary_email_address_id'):
            email = addr.get('email_address', '')
            break

    User.objects.update_or_create(
        clerk_id=data['id'],
        defaults={
            'email': email,
            'first_name': data.get('first_name', ''),
            'last_name': data.get('last_name', ''),
            'is_active': True,
        },
    )


def _handle_user_updated(data):
    _handle_user_created(data)


def _handle_user_deleted(data):
    User.objects.filter(clerk_id=data['id']).update(is_active=False)


def _handle_organisation_created(data):
    org, created = Organisation.objects.update_or_create(
        clerk_org_id=data['id'],
        defaults={
            'name': data.get('name', ''),
            'slug': data.get('slug', ''),
            'is_active': True
        },
    )

    if created:
        free_amount = getattr(settings, 'FREE_CREDIT_AMOUNT', 10)
        grant_credits(
            org,
            amount=free_amount,
            description=f'Free trial credits on signup',
        )
        logger.info('Granted $%s free credits to new org %s', free_amount, org.clerk_org_id)


def _handle_organisation_updated(data):
    _handle_organisation_created(data)


def _handle_organisation_deleted(data):
    # Soft-delete the organisation
    Organisation.objects.filter(clerk_org_id=data['id']).update(is_active=False)

    # Cascade soft-delete to related tenant objects that have is_active
    Contact.objects.filter(organisation__clerk_org_id=data['id']).update(is_active=False)
    ContactGroup.objects.filter(organisation__clerk_org_id=data['id']).update(is_active=False)
    Template.objects.filter(organisation__clerk_org_id=data['id']).update(is_active=False)

    # Soft-delete memberships
    memberships = OrganisationMembership.objects.filter(organisation__clerk_org_id=data['id'], is_active=True)
    memberships.update(is_active=False)

    # Soft-delete users who have no other active memberships
    user_ids = list(memberships.values_list('user_id', flat=True))
    User.objects.filter(
        id__in=user_ids,
    ).exclude(
        organisationmembership__is_active=True,
    ).update(is_active=False)


def _handle_membership_created(data):
    user = User.objects.filter(clerk_id=data.get('public_user_data', {}).get('user_id')).first()
    org = Organisation.objects.filter(clerk_org_id=data.get('organization', {}).get('id')).first()

    if user and org:
        OrganisationMembership.objects.update_or_create(
            user=user,
            organisation=org,
            defaults={'role': data.get('role', 'member'), 'is_active': True},
        )
        # Ensure the user account is active (handles reactivation case)
        if not user.is_active:
            User.objects.filter(pk=user.pk).update(is_active=True)


def _handle_membership_updated(data):
    _handle_membership_created(data)


def _handle_membership_deleted(data):
    user_id = data.get('public_user_data', {}).get('user_id')
    org_id = data.get('organization', {}).get('id')

    if user_id and org_id:
        OrganisationMembership.objects.filter(
            user__clerk_id=user_id,
            organisation__clerk_org_id=org_id,
        ).update(is_active=False)

        # Deactivate user if they have no other active memberships
        User.objects.filter(
            clerk_id=user_id,
        ).exclude(
            organisationmembership__is_active=True,
        ).update(is_active=False)


# ---------------------------------------------------------------------------
# Clerk Billing webhook stubs
# The exact event type strings must be confirmed from Clerk docs when the
# corporate Clerk account with Billing enabled is set up.
# ---------------------------------------------------------------------------

def _handle_subscription_active(data):
    """Transition org to subscribed mode when a Clerk Billing subscription becomes active."""
    org_id = data.get('organization_id') or data.get('organization', {}).get('id')
    if not org_id:
        logger.warning('subscription.active: no org id in payload %s', data)
        return
    updated = Organisation.objects.filter(clerk_org_id=org_id).update(
        billing_mode=Organisation.BILLING_SUBSCRIBED
    )
    if updated:
        logger.info('Org %s transitioned to subscribed billing mode', org_id)
    else:
        logger.warning('subscription.active: org %s not found', org_id)


def _handle_subscription_canceled(data):
    """Revert org to trial mode when a Clerk Billing subscription item is cancelled or ended."""
    org_id = data.get('organization_id') or data.get('organization', {}).get('id')
    if not org_id:
        logger.warning('subscriptionItem.canceled/ended: no org id in payload %s', data)
        return
    updated = Organisation.objects.filter(clerk_org_id=org_id).update(
        billing_mode=Organisation.BILLING_TRIAL
    )
    if updated:
        logger.info('Org %s reverted to trial billing mode (subscription cancelled)', org_id)
    else:
        logger.warning('subscriptionItem.canceled/ended: org %s not found', org_id)


def _handle_subscription_past_due(data):
    """Log a past-due subscription. TODO: decide policy (notify admin, suspend, etc.)."""
    # TODO: implement notification or suspension when policy is decided
    logger.warning('subscription.past_due received: %s', data.get('id'))


# Clerk API event type strings must use US spelling (Clerk's API convention)
WEBHOOK_HANDLERS = {
    'user.created': _handle_user_created,
    'user.updated': _handle_user_updated,
    'user.deleted': _handle_user_deleted,
    'organization.created': _handle_organisation_created,
    'organization.updated': _handle_organisation_updated,
    'organization.deleted': _handle_organisation_deleted,
    'organizationMembership.created': _handle_membership_created,
    'organizationMembership.updated': _handle_membership_updated,
    'organizationMembership.deleted': _handle_membership_deleted,
    # Clerk Billing events
    'subscription.active': _handle_subscription_active,
    'subscriptionItem.canceled': _handle_subscription_canceled,
    'subscriptionItem.ended': _handle_subscription_canceled,
    'subscription.past_due': _handle_subscription_past_due,
}
