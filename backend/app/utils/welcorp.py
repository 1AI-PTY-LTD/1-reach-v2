"""
Welcorp SMS/MMS provider integration.

API docs: https://api.message-service.org/api/v1/
Auth: Basic (username:password)
Endpoint: POST /jobs with job_type "sms" or "mms"

Implemented:
- Delivery status callbacks (callback_url + callback_on_sms_status_update)
- Carrier failure detection via callbacks (FAIL, INVN, BARR, OPTO, etc. → FAILED + refund)
- Note: Welcorp has no handset delivery confirmation — SENT means carrier accepted only

Future features to implement:
- 2-way SMS (replies via callback)
- Custom sender ID (manual_sender_id)
- Merge fields for personalised message content per recipient
- Job status polling (GET /jobs/{job_id}) as reconciliation fallback
"""

import logging
from typing import Optional
from urllib.parse import urljoin

import requests
from django.conf import settings

from app.utils.failure_classifier import classify_failure
from app.utils.sms import DeliveryEvent, SMSProvider, SendResult

logger = logging.getLogger(__name__)


class WelcorpSMSProvider(SMSProvider):
    """Welcorp messaging API provider.

    Creates one Welcorp "job" per send operation. Each job returns a job_id
    which we store as the provider_message_id.
    """

    def __init__(self):
        self.base_url = getattr(settings, 'WELCORP_BASE_URL', 'https://api.message-service.org/api/v1')
        username = getattr(settings, 'WELCORP_USERNAME', '')
        password = getattr(settings, 'WELCORP_PASSWORD', '')

        if not username or not password:
            raise ValueError('WELCORP_USERNAME and WELCORP_PASSWORD must be configured')

        self.session = requests.Session()
        self.session.auth = (username, password)
        self.session.headers.update({
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        })

    def _post_job(self, payload: dict) -> SendResult:
        """POST a job to the Welcorp API and return a normalised SendResult."""
        callback_url = self.get_callback_url()
        if callback_url:
            payload['callback_url'] = callback_url
            payload['callback_on_sms_status_update'] = True

        url = urljoin(self.base_url.rstrip('/') + '/', 'jobs')

        try:
            response = self.session.post(url, json=payload, timeout=30)
        except requests.Timeout:
            error_msg = 'Welcorp API request timed out'
            logger.warning(error_msg, extra={'payload_type': payload.get('job_type')})
            fc, retryable = classify_failure('TIMEOUT', None, error_msg)
            return SendResult(
                success=False,
                error=error_msg,
                error_code='TIMEOUT',
                retryable=retryable,
                failure_category=fc.value,
            )
        except requests.RequestException as exc:
            error_msg = f'Welcorp API connection error: {exc}'
            logger.warning(error_msg, extra={'payload_type': payload.get('job_type')})
            fc, retryable = classify_failure('CONN_ERROR', None, error_msg)
            return SendResult(
                success=False,
                error=error_msg,
                error_code='CONN_ERROR',
                retryable=retryable,
                failure_category=fc.value,
            )

        try:
            data = response.json()
        except ValueError:
            error_msg = f'Welcorp API returned non-JSON response (HTTP {response.status_code})'
            logger.warning(error_msg)
            fc, retryable = classify_failure(str(response.status_code), response.status_code, error_msg)
            return SendResult(
                success=False,
                error=error_msg,
                error_code=str(response.status_code),
                http_status=response.status_code,
                retryable=retryable,
                failure_category=fc.value,
            )

        api_status = data.get('status', response.status_code)

        if api_status == 200:
            job_id = str(data.get('data', ''))
            logger.info(
                'Welcorp job created',
                extra={'job_id': job_id, 'job_type': payload.get('job_type')},
            )
            return SendResult(
                success=True,
                message_id=job_id,
                http_status=api_status,
            )

        errors = data.get('errors', 'Unknown error')
        logger.warning(
            'Welcorp API error',
            extra={'status': api_status, 'errors': errors, 'job_type': payload.get('job_type')},
        )
        fc, retryable = classify_failure(None, api_status, str(errors))
        return SendResult(
            success=False,
            error=str(errors),
            http_status=api_status,
            retryable=retryable,
            failure_category=fc.value,
        )

    def _send_sms_impl(self, to: str, message: str) -> SendResult:
        payload = {
            'job_type': 'sms',
            'message': message,
            'recipients': [{'destination': self._to_international(to)}],
        }
        return self._post_job(payload)

    def _send_bulk_sms_impl(self, recipients: list[dict]) -> dict:
        welcorp_recipients = [
            {
                'destination': self._to_international(r['to']),
                'reference': str(i),
            }
            for i, r in enumerate(recipients)
        ]

        # All recipients share the same message in the current abstraction.
        # If messages differ per-recipient, Welcorp supports merge fields — for
        # now we use the first recipient's message.
        message = recipients[0]['message'] if recipients else ''

        payload = {
            'job_type': 'sms',
            'message': message,
            'recipients': welcorp_recipients,
        }

        result = self._post_job(payload)

        if result.success:
            # Welcorp returns a single job_id at creation time. Per-recipient
            # delivery status is available later via GET /jobs/{job_id} — for
            # now return synthetic per-recipient results.
            per_recipient = [
                {
                    'to': r['to'],
                    'message_parts': r.get('message_parts', 1),
                    'success': True,
                    'message_id': result.message_id,
                    'error': None,
                }
                for r in recipients
            ]
            return {
                'success': True,
                'results': per_recipient,
                'error': None,
            }

        # On failure the whole batch failed
        per_recipient = [
            {
                'to': r['to'],
                'message_parts': r.get('message_parts', 1),
                'success': False,
                'message_id': None,
                'error': result.error,
            }
            for r in recipients
        ]
        return {
            'success': False,
            'results': per_recipient,
            'error': result.error,
            'retryable': result.retryable,
            'failure_category': result.failure_category,
        }

    # --- Delivery callback interface ---

    # Welcorp SENT = carrier acknowledged receipt (NOT handset delivery).
    # We skip this — our schedule is already SENT from the initial API response.
    # There is no handset delivery confirmation in the Welcorp API.
    _CARRIER_ACCEPTED_STATUSES = {'SENT'}

    # Non-terminal statuses to ignore (message still in transit).
    _PENDING_STATUSES = {'QUED'}

    # Everything else is a carrier-reported failure:
    # FAIL, SVRE, BARR, INVN, BADS, EXPD, OPTO, RECE

    def parse_delivery_callback(self, request_data: dict, content_type: str) -> list[DeliveryEvent]:
        """Parse a Welcorp delivery status callback.

        Welcorp POSTs application/x-www-form-urlencoded with fields:
        BroadcastID, Destination, Status, Timestamp, Reference, Recipient, BroadcastName.

        Welcorp's SENT status means "carrier accepted" (not handset delivery),
        so we skip it — the schedule is already SENT from the initial API call.
        The real value of callbacks is catching carrier-level failures.
        """
        # request_data values may be lists (from Django QueryDict) or plain strings
        def _val(key: str) -> str:
            v = request_data.get(key, '')
            return v[0] if isinstance(v, list) else (v or '')

        raw_status = _val('Status').upper()

        if raw_status in self._PENDING_STATUSES or raw_status in self._CARRIER_ACCEPTED_STATUSES:
            return []

        destination = _val('Destination')
        recipient_phone = self._normalise_phone(destination) if destination else None

        return [DeliveryEvent(
            provider_message_id=_val('BroadcastID'),
            status='failed',
            recipient_phone=recipient_phone,
            timestamp=_val('Timestamp') or None,
            error_code=raw_status,
            error_message=f'Welcorp delivery failed: {raw_status}',
            raw_status=raw_status,
            raw_data=dict(request_data),
        )]

    def validate_callback_request(self, request) -> bool:
        """Validate callback using a shared secret token in the URL query string."""
        expected = getattr(settings, 'WELCORP_CALLBACK_SECRET', '')
        if not expected:
            logger.warning('WELCORP_CALLBACK_SECRET not configured, rejecting callback')
            return False
        return request.GET.get('token') == expected

    def get_callback_url(self) -> str | None:
        """Return the delivery callback URL to include in Welcorp job payloads."""
        base_url = getattr(settings, 'CALLBACK_BASE_URL', '')
        secret = getattr(settings, 'WELCORP_CALLBACK_SECRET', '')
        if not base_url or not secret:
            return None
        return f'{base_url.rstrip("/")}/api/webhooks/sms-delivery/?token={secret}'

    def _send_mms_impl(self, to: str, message: str, media_url: str, subject: Optional[str] = None) -> SendResult:
        payload = {
            'job_type': 'mms',
            'message': message,
            'files': [{'name': 'media', 'url': media_url}],
            'recipients': [{'destination': self._to_international(to)}],
        }
        if subject:
            payload['subject'] = subject

        return self._post_job(payload)

    def _send_bulk_mms_impl(self, recipients: list[dict]) -> dict:
        welcorp_recipients = [
            {
                'destination': self._to_international(r['to']),
                'reference': str(i),
            }
            for i, r in enumerate(recipients)
        ]

        # All recipients share the same media and message.
        media_url = recipients[0]['media_url'] if recipients else ''
        message = recipients[0]['message'] if recipients else ''
        subject = recipients[0].get('subject') if recipients else None

        payload: dict = {
            'job_type': 'mms',
            'message': message,
            'files': [{'name': 'media', 'url': media_url}],
            'recipients': welcorp_recipients,
        }
        if subject:
            payload['subject'] = subject

        result = self._post_job(payload)

        if result.success:
            per_recipient = [
                {
                    'to': r['to'],
                    'message_parts': 1,
                    'success': True,
                    'message_id': result.message_id,
                    'error': None,
                }
                for r in recipients
            ]
            return {
                'success': True,
                'results': per_recipient,
                'error': None,
            }

        per_recipient = [
            {
                'to': r['to'],
                'message_parts': 1,
                'success': False,
                'message_id': None,
                'error': result.error,
            }
            for r in recipients
        ]
        return {
            'success': False,
            'results': per_recipient,
            'error': result.error,
            'retryable': result.retryable,
            'failure_category': result.failure_category,
        }
