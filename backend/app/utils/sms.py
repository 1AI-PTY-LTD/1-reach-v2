import logging
import math
import re
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, cast

from django.conf import settings


logger = logging.getLogger(__name__)


@dataclass
class SendResult:
    """Standardised result from a single SMS/MMS send operation.

    Returned by all provider send_sms / send_mms methods and consumed by the
    Celery task pipeline (celery.py) for status tracking, retry decisions, and
    failure classification.
    """
    success: bool
    message_id: str | None = None
    error: str | None = None
    message_parts: int = 0
    error_code: str | None = None
    http_status: int | None = None
    retryable: bool = False
    failure_category: str | None = None


@dataclass
class DeliveryEvent:
    """Provider-agnostic delivery status event.

    Returned by SMSProvider.parse_delivery_callback() and consumed by the
    process_delivery_event Celery task to update Schedule status.
    """
    provider_message_id: str
    status: str                          # 'delivered' or 'failed'
    recipient_phone: str | None = None   # normalised 04XXXXXXXX
    timestamp: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    raw_status: str | None = None        # original provider status code
    raw_data: dict | None = field(default=None, repr=False)


class SMSProvider(ABC):
    """Abstract base class for SMS/MMS providers.

    Handles phone validation/normalisation in the base class, so concrete
    implementations only need to focus on the actual sending logic.

    All public methods (send_sms, send_bulk_sms, send_mms) handle normalisation
    automatically before calling the abstract implementation methods.

    Providers that support delivery callbacks should override:
    - parse_delivery_callback() to parse provider-specific callback payloads
    - validate_callback_request() for request authentication
    - get_callback_url() to return the URL the provider should POST callbacks to
    """

    def _validate_phone(self, phone: str) -> bool:
        """Validate phone number format (04XXXXXXXX or +614XXXXXXXX)."""
        cleaned = re.sub(r'\s+', '', phone)
        if cleaned.startswith('+614'):
            cleaned = '0' + cleaned[3:]
        return bool(re.match(r'^04\d{8}$', cleaned))

    def _normalise_phone(self, phone: str) -> str:
        """Normalise phone to 04XXXXXXXX format."""
        cleaned = re.sub(r'\s+', '', phone)
        if cleaned.startswith('+614'):
            cleaned = '0' + cleaned[3:]
        return cleaned

    @staticmethod
    def _to_international(phone: str) -> str:
        """Convert 04XXXXXXXX to +614XXXXXXXX (international format)."""
        if phone.startswith('04'):
            return '+61' + phone[1:]
        return phone

    def _calculate_sms_parts(self, message: str) -> int:
        """Calculate the number of SMS parts for a message.

        Single SMS: 1-160 characters = 1 part
        Concatenated SMS: 161+ characters = ceil(length / 153) parts
        (Each part in concatenated SMS has 7 bytes reserved for headers)
        """
        length = len(message)
        if length <= 160:
            return 1
        return math.ceil(length / 153)

    def send_sms(self, to: str, message: str) -> SendResult:
        """Send a single SMS message.

        Validates and normalises the phone number, then calls _send_sms_impl().
        """
        if not self._validate_phone(to):
            return SendResult(
                success=False,
                error='Invalid phone number format',
                failure_category='invalid_number',
            )

        normalised = self._normalise_phone(to)
        result = self._send_sms_impl(normalised, message)
        result.message_parts = self._calculate_sms_parts(message)
        return result

    def send_bulk_sms(self, recipients: list[dict]) -> dict:
        """Send SMS to multiple recipients.

        Validates and normalises all phone numbers, then calls _send_bulk_sms_impl().

        Returns:
            dict with keys: success (bool), results (list), error (str)
        """
        normalised_recipients = []
        for recipient in recipients:
            if not self._validate_phone(recipient['to']):
                continue
            normalised_recipients.append({
                'to': self._normalise_phone(recipient['to']),
                'message': recipient['message'],
                'message_parts': self._calculate_sms_parts(recipient['message']),
            })

        return self._send_bulk_sms_impl(normalised_recipients)

    def send_mms(self, to: str, message: str, media_url: str, subject: Optional[str] = None) -> SendResult:
        """Send an MMS message with media.

        Validates and normalises the phone number, then calls _send_mms_impl().
        """
        if not self._validate_phone(to):
            return SendResult(
                success=False,
                error='Invalid phone number format',
                failure_category='invalid_number',
            )

        normalised = self._normalise_phone(to)
        result = self._send_mms_impl(normalised, message, media_url, subject)
        result.message_parts = 1  # MMS is always 1 part
        return result

    def send_bulk_mms(self, recipients: list[dict]) -> dict:
        """Send MMS to multiple recipients.

        Validates and normalises all phone numbers, then calls _send_bulk_mms_impl().
        Recipient dicts: {to, message, media_url, subject?}

        Returns:
            dict with keys: success (bool), results (list), error (str)
        """
        normalised_recipients = []
        for recipient in recipients:
            if not self._validate_phone(recipient['to']):
                continue
            normalised_recipients.append({
                'to': self._normalise_phone(recipient['to']),
                'message': recipient['message'],
                'media_url': recipient['media_url'],
                'subject': recipient.get('subject'),
                'message_parts': 1,  # MMS is always 1 part
            })

        return self._send_bulk_mms_impl(normalised_recipients)

    @abstractmethod
    def _send_sms_impl(self, to: str, message: str) -> SendResult:
        """Implementation method for sending SMS.

        Phone number is already validated and normalised to 04XXXXXXXX format.
        """
        pass

    def _send_bulk_sms_impl(self, recipients: list[dict]) -> dict:
        """Implementation method for sending bulk SMS.

        Default: loops over _send_sms_impl() individually.
        Providers with native bulk SMS support (e.g. Welcorp) can override this.
        """
        results = []
        first_failure: SendResult | None = None
        for r in recipients:
            result = self._send_sms_impl(r['to'], r['message'])
            results.append({
                'to': r['to'],
                'message_parts': r.get('message_parts', self._calculate_sms_parts(r['message'])),
                'success': result.success,
                'message_id': result.message_id,
                'error': result.error,
            })
            if not result.success and first_failure is None:
                first_failure = result

        failed = sum(1 for r in results if not r['success'])
        result_dict: dict = {
            'success': failed == 0,
            'results': results,
            'error': f'{failed} messages failed' if failed > 0 else None,
        }
        if first_failure:
            result_dict['retryable'] = first_failure.retryable
            result_dict['failure_category'] = first_failure.failure_category
        return result_dict

    @abstractmethod
    def _send_mms_impl(self, to: str, message: str, media_url: str, subject: Optional[str] = None) -> SendResult:
        """Implementation method for sending MMS.

        Phone number is already validated and normalised to 04XXXXXXXX format.
        """
        pass

    def _send_bulk_mms_impl(self, recipients: list[dict]) -> dict:
        """Implementation method for sending bulk MMS.

        Default: loops over _send_mms_impl() individually.
        Providers with native bulk MMS support (e.g. Welcorp) can override this.
        """
        results = []
        first_failure: SendResult | None = None
        for r in recipients:
            result = self._send_mms_impl(r['to'], r['message'], r['media_url'], r.get('subject'))
            results.append({
                'to': r['to'],
                'message_parts': 1,
                'success': result.success,
                'message_id': result.message_id,
                'error': result.error,
            })
            if not result.success and first_failure is None:
                first_failure = result

        failed = sum(1 for r in results if not r['success'])
        result_dict: dict = {
            'success': failed == 0,
            'results': results,
            'error': f'{failed} messages failed' if failed > 0 else None,
        }
        if first_failure:
            result_dict['retryable'] = first_failure.retryable
            result_dict['failure_category'] = first_failure.failure_category
        return result_dict

    # --- Delivery callback interface ---

    def parse_delivery_callback(self, request_data: dict, content_type: str) -> list[DeliveryEvent]:
        """Parse a delivery status callback into provider-agnostic DeliveryEvents.

        Providers must override this to handle their specific callback format.
        Return an empty list for non-terminal statuses that should be ignored.
        """
        raise NotImplementedError(
            f'{type(self).__name__} does not implement delivery callbacks'
        )

    def validate_callback_request(self, request) -> bool:
        """Validate that a delivery callback request is authentic.

        Default: returns True (no validation). Providers should override to
        implement signature verification, token checks, or IP allowlisting.
        """
        return True

    def get_callback_url(self) -> str | None:
        """Return the callback URL to include in send payloads, or None if
        the provider does not support delivery callbacks."""
        return None


class MockSMSProvider(SMSProvider):
    """Mock SMS provider for development and testing.

    Logs all operations but doesn't actually send messages.
    Always returns success with generated message IDs.
    """

    def _send_sms_impl(self, to: str, message: str) -> SendResult:
        message_id = f'mock-sms-{uuid.uuid4().hex[:12]}'

        logger.info(
            'MockSMSProvider.send_sms',
            extra={
                'to': to,
                'message_length': len(message),
                'message_id': message_id,
            },
        )

        return SendResult(success=True, message_id=message_id)

    def _send_mms_impl(self, to: str, message: str, media_url: str, subject: Optional[str] = None) -> SendResult:
        message_id = f'mock-mms-{uuid.uuid4().hex[:12]}'

        logger.info(
            'MockSMSProvider.send_mms',
            extra={
                'to': to,
                'message_length': len(message),
                'media_url': media_url,
                'subject': subject,
                'message_id': message_id,
            },
        )

        return SendResult(success=True, message_id=message_id)


class _ProviderCache:
    """Simple cache for the SMS provider singleton."""
    instance: Optional[SMSProvider] = None


def get_sms_provider() -> SMSProvider:
    """Get the configured SMS provider instance (singleton).

    Provider class is determined by settings.SMS_PROVIDER_CLASS.
    Instance is cached in _ProviderCache.
    """
    if _ProviderCache.instance is None:
        provider_path = getattr(settings, 'SMS_PROVIDER_CLASS', 'app.utils.sms.MockSMSProvider')

        # Import the provider class
        module_path, class_name = provider_path.rsplit('.', 1)
        module = __import__(module_path, fromlist=[class_name])
        provider_class = getattr(module, class_name)

        _ProviderCache.instance = provider_class()
        logger.info(f'Initialised SMS provider: {provider_path}')

    return cast(SMSProvider, _ProviderCache.instance)
