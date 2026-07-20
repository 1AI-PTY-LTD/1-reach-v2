"""
Welcorp SMS/MMS provider integration.

API docs: https://api.message-service.org/api/v1/
Auth: Basic (username:password)
Endpoint: POST /jobs with job_type "sms" or "mms"

Implemented:
- Delivery status callbacks (callback_url + callback_on_sms_status_update).
  NOTE: GET /jobs/{id} does NOT echo the stored callback fields (always
  null/false — confirmed with Welcorp support July 2026 on a job whose
  callback demonstrably fired), so registration cannot be verified via the
  API; SendResult.callback_registered reflects what we attached at send time
- Carrier failure detection via callbacks (FAIL, INVN, BARR, OPTO, etc. → FAILED + refund)
- Job status polling (GET /jobs/{job_id}) as reconciliation fallback
- Welcorp SENT = carrier accepted (best available confirmation) → mapped to DELIVERED
- Custom sender ID (manual_sender_id)
- 2-way SMS replies. Reply callbacks arrive on the SAME callback_url as
  delivery reports with the SAME field set, except they carry Response (the
  reply text) instead of Status — there is no type discriminator. Replies are
  callback-only: no Welcorp endpoint exists to list or re-fetch them, so a
  missed webhook is a lost reply (GET /jobs/{id} never includes reply text).

Future features to implement:
- Merge fields for personalised message content per recipient
- 2-way MMS (inbound media payload is undocumented)
"""

import hmac
import logging
from typing import Optional
from pathlib import PurePosixPath
from urllib.parse import quote, urljoin, urlparse

import requests
from django.conf import settings

from app.utils.failure_classifier import classify_failure
from app.utils.sms import DeliveryEvent, InboundSmsEvent, SMSProvider, SendResult

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
        else:
            logger.warning(
                'Welcorp job submitted without delivery callback '
                '(BASE_URL or WELCORP_CALLBACK_SECRET unset); '
                'delivery status will rely on reconciliation polling',
            )

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
                callback_registered=bool(callback_url),
            )

        errors = data.get('errors')
        error_detail = f'Welcorp {payload.get("job_type")} error (HTTP {api_status}): {errors or data}'
        logger.warning(
            'Welcorp API error: status=%s job_type=%s errors=%s response=%s',
            api_status, payload.get('job_type'), errors, data,
        )
        fc, retryable = classify_failure(None, api_status, str(errors or ''))
        return SendResult(
            success=False,
            error=error_detail,
            http_status=api_status,
            retryable=retryable,
            failure_category=fc.value,
        )

    def _apply_sms_sender_options(
        self, payload: dict, alphanumeric_sender: str | None, two_way: bool,
    ) -> None:
        """Apply job_type/sender fields for an SMS job payload in place.

        Two-way jobs use the pooled reply-capable sender and a reply window
        (`expires`, hours). NEVER set Welcorp's `optout_code` here: it adds
        repliers to the ACCOUNT-level opt-out list, and 1Reach is multi-tenant
        on a single Welcorp account — STOP replies are handled locally per-org
        by process_inbound_message instead.
        """
        if two_way and alphanumeric_sender:
            # Serializer-gated upstream; an alphanumeric sender can't receive
            # replies, so two-way wins and the sender id is dropped.
            logger.warning(
                'two_way and alphanumeric_sender are mutually exclusive — '
                'dropping sender id %r', alphanumeric_sender,
            )
            alphanumeric_sender = None

        if two_way:
            payload['job_type'] = settings.WELCORP_TWO_WAY_JOB_TYPE
            payload['expires'] = settings.TWO_WAY_REPLY_WINDOW_HOURS
        if alphanumeric_sender:
            payload['manual_sender_id'] = alphanumeric_sender

    def _send_sms_impl(self, to: str, message: str, alphanumeric_sender: str | None = None,
                       two_way: bool = False) -> SendResult:
        payload = {
            'job_type': 'sms',
            'message': message,
            'recipients': [{'destination': self._to_international(to)}],
        }
        self._apply_sms_sender_options(payload, alphanumeric_sender, two_way)
        return self._post_job(payload)

    def _send_bulk_sms_impl(self, recipients: list[dict], alphanumeric_sender: str | None = None,
                            two_way: bool = False) -> dict:
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
        self._apply_sms_sender_options(payload, alphanumeric_sender, two_way)

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
                'callback_registered': result.callback_registered,
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

    # Welcorp SENT = carrier acknowledged receipt. This is the best delivery
    # confirmation Welcorp provides (no handset-level delivery status exists).
    # We map it to 'delivered' so the schedule transitions SENT → DELIVERED,
    # preventing reconcile_stale_sent from re-polling completed jobs.
    _DELIVERED_STATUSES = {'SENT'}

    # Non-terminal statuses to ignore (message still in transit).
    _PENDING_STATUSES = {'QUED'}

    # Everything else is a carrier-reported failure:
    # FAIL, SVRE, BARR, INVN, BADS, EXPD, OPTO, RECE

    @staticmethod
    def _val(request_data: dict, key: str) -> str:
        """Unwrap a callback form field that may be a QueryDict list or a plain string."""
        v = request_data.get(key, '')
        return v[0] if isinstance(v, list) else (v or '')

    def parse_delivery_callback(self, request_data: dict, content_type: str) -> list[DeliveryEvent]:
        """Parse a Welcorp delivery status callback.

        Welcorp POSTs application/x-www-form-urlencoded with fields:
        BroadcastID, Destination, Status, Timestamp, Reference, Recipient, BroadcastName.

        Welcorp's SENT = carrier accepted (best confirmation available).
        Mapped to 'delivered' so schedules move to terminal DELIVERED status.

        A payload with no Status is NOT a delivery report and must never be
        parsed as one: 2-way reply callbacks share this URL and carry Response
        instead of Status. Treating a reply as an empty-status failure would
        flip a still-SENT schedule to FAILED and refund it (replies typically
        arrive before the carrier DLR).
        """
        raw_status = self._val(request_data, 'Status').upper()

        if not raw_status:
            if not self._val(request_data, 'Response'):
                logger.warning(
                    'Welcorp callback with neither Status nor Response ignored: %r',
                    request_data,
                )
            return []

        if raw_status in self._PENDING_STATUSES:
            return []

        destination = self._val(request_data, 'Destination')
        recipient_phone = self._normalise_phone(destination) if destination else None

        if raw_status in self._DELIVERED_STATUSES:
            return [DeliveryEvent(
                provider_message_id=self._val(request_data, 'BroadcastID'),
                status='delivered',
                recipient_phone=recipient_phone,
                timestamp=self._val(request_data, 'Timestamp') or None,
                raw_status=raw_status,
                raw_data=dict(request_data),
            )]

        return [DeliveryEvent(
            provider_message_id=self._val(request_data, 'BroadcastID'),
            status='failed',
            recipient_phone=recipient_phone,
            timestamp=self._val(request_data, 'Timestamp') or None,
            error_code=raw_status,
            error_message=f'Welcorp delivery failed: {raw_status}',
            raw_status=raw_status,
            raw_data=dict(request_data),
        )]

    def parse_inbound_callback(self, request_data: dict, content_type: str) -> list[InboundSmsEvent]:
        """Parse a Welcorp 2-way SMS reply callback.

        Reply callbacks POST to the delivery-callback URL with fields:
        BroadcastID, Timestamp, Reference, Recipient, Destination, Response,
        BroadcastName. Response holds the reply text; a payload carrying a
        Status is a delivery report and is left to parse_delivery_callback.
        """
        if self._val(request_data, 'Status'):
            return []

        text = self._val(request_data, 'Response')
        if not text:
            # Neither Status nor Response — parse_delivery_callback logs this.
            return []

        destination = self._val(request_data, 'Destination')
        return [InboundSmsEvent(
            provider_message_id=self._val(request_data, 'BroadcastID'),
            sender_phone=self._normalise_phone(destination) if destination else None,
            text=text,
            timestamp=self._val(request_data, 'Timestamp') or None,
            reference=self._val(request_data, 'Reference') or None,
            raw_data=dict(request_data),
        )]

    def validate_callback_request(self, request) -> bool:
        """Validate callback using a shared secret token in the URL query string."""
        expected = getattr(settings, 'WELCORP_CALLBACK_SECRET', '')
        if not expected:
            logger.warning('WELCORP_CALLBACK_SECRET not configured, rejecting callback')
            return False
        return hmac.compare_digest(request.GET.get('token', ''), expected)

    def get_callback_url(self) -> str | None:
        """Return the delivery callback URL to include in Welcorp job payloads."""
        base_url = getattr(settings, 'BASE_URL', '')
        secret = getattr(settings, 'WELCORP_CALLBACK_SECRET', '')
        if not base_url or not secret:
            return None
        if '://' not in base_url:
            logger.warning('BASE_URL %r has no scheme; assuming https://', base_url)
            base_url = f'https://{base_url}'
        return f'{base_url.rstrip("/")}/api/webhooks/sms-delivery/?token={quote(secret)}'

    def poll_job_status(self, provider_message_id: str) -> list[DeliveryEvent]:
        """Poll Welcorp GET /jobs/{job_id} for delivery reports.

        Only processes reports with stage=Confirmed (carrier has responded).
        Maps SENT → delivered, failure codes → failed. Skips QUED (pending).
        """
        url = urljoin(self.base_url.rstrip('/') + '/', f'jobs/{provider_message_id}')

        try:
            response = self.session.get(url, timeout=30)
        except requests.RequestException as exc:
            logger.warning('Welcorp poll failed for job %s: %s', provider_message_id, exc)
            return []

        try:
            data = response.json()
        except ValueError:
            logger.warning('Welcorp poll returned non-JSON for job %s (HTTP %s)', provider_message_id, response.status_code)
            return []

        if data.get('status') != 200:
            logger.warning('Welcorp poll error for job %s: %s', provider_message_id, data.get('errors', 'unknown'))
            return []

        reports = data.get('data', {}).get('reports', [])
        events = []
        skipped_unconfirmed = 0

        for report in reports:
            stage = (report.get('stage') or '').lower()
            if stage != 'confirmed':
                skipped_unconfirmed += 1
                continue

            raw_status = (report.get('status') or '').upper()

            if raw_status in self._PENDING_STATUSES:
                continue

            destination = report.get('destination', '')
            recipient_phone = self._normalise_phone(destination) if destination else None

            if raw_status in self._DELIVERED_STATUSES:
                events.append(DeliveryEvent(
                    provider_message_id=provider_message_id,
                    status='delivered',
                    recipient_phone=recipient_phone,
                    timestamp=report.get('send_date_time'),
                    raw_status=raw_status,
                    raw_data=report,
                ))
            else:
                events.append(DeliveryEvent(
                    provider_message_id=provider_message_id,
                    status='failed',
                    recipient_phone=recipient_phone,
                    timestamp=report.get('send_date_time'),
                    error_code=raw_status,
                    error_message=f'Welcorp delivery failed: {raw_status}',
                    raw_status=raw_status,
                    raw_data=report,
                ))

        if skipped_unconfirmed:
            logger.info(
                'Welcorp poll job %s: %d report(s) skipped (stage not Confirmed)',
                provider_message_id, skipped_unconfirmed,
            )

        return events

    @staticmethod
    def _media_filename(media_url: str) -> str | None:
        """Extract extension from media URL and return 'media.ext'.

        Returns None if the URL has no file extension.
        """
        path = urlparse(media_url).path
        ext = PurePosixPath(path).suffix.lower()
        return f'media{ext}' if ext else None

    def _send_mms_impl(self, to: str, message: str, media_url: str, subject: Optional[str] = None,
                        alphanumeric_sender: str | None = None) -> SendResult:
        filename = self._media_filename(media_url)
        if not filename:
            return SendResult(
                success=False,
                error=f'media_url missing file extension: {media_url}',
                failure_category='invalid_request',
            )

        payload = {
            'job_type': 'mms',
            'message': message,
            'files': [{'name': filename, 'url': media_url}],
            'recipients': [{'destination': self._to_international(to)}],
        }
        if subject:
            payload['subject'] = subject
        if alphanumeric_sender:
            payload['manual_sender_id'] = alphanumeric_sender

        return self._post_job(payload)

    def _send_bulk_mms_impl(self, recipients: list[dict], alphanumeric_sender: str | None = None) -> dict:
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

        filename = self._media_filename(media_url)
        if not filename:
            return {
                'success': False,
                'results': [
                    {'to': r['to'], 'message_parts': 1, 'success': False, 'message_id': None, 'error': 'media_url missing file extension'}
                    for r in recipients
                ],
                'error': f'media_url missing file extension: {media_url}',
                'retryable': False,
                'failure_category': 'invalid_request',
            }

        payload: dict = {
            'job_type': 'mms',
            'message': message,
            'files': [{'name': filename, 'url': media_url}],
            'recipients': welcorp_recipients,
        }
        if subject:
            payload['subject'] = subject
        if alphanumeric_sender:
            payload['manual_sender_id'] = alphanumeric_sender

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
                'callback_registered': result.callback_registered,
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
