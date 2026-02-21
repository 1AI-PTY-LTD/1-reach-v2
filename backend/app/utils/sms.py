import logging
import math
import re
import uuid
from abc import ABC, abstractmethod
from typing import Optional, cast

from django.conf import settings


logger = logging.getLogger(__name__)


class SMSProvider(ABC):
    """Abstract base class for SMS/MMS providers.

    Handles phone validation/normalisation in the base class, so concrete
    implementations only need to focus on the actual sending logic.

    All public methods (send_sms, send_bulk_sms, send_mms) handle normalisation
    automatically before calling the abstract implementation methods.
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

    def send_sms(self, to: str, message: str) -> dict:
        """Send a single SMS message.

        Validates and normalises the phone number, then calls _send_sms_impl().

        Args:
            to: Phone number (04XXXXXXXX or +614XXXXXXXX format)
            message: Message body (1-306 characters)

        Returns:
            dict with keys: success (bool), message_id (str), error (str), message_parts (int)
        """
        if not self._validate_phone(to):
            return {
                'success': False,
                'message_id': None,
                'error': 'Invalid phone number format',
                'message_parts': 0,
            }

        normalised = self._normalise_phone(to)
        message_parts = self._calculate_sms_parts(message)
        result = self._send_sms_impl(normalised, message)
        result['message_parts'] = message_parts
        return result

    def send_bulk_sms(self, recipients: list[dict]) -> dict:
        """Send SMS to multiple recipients.

        Validates and normalises all phone numbers, then calls _send_bulk_sms_impl().

        Args:
            recipients: List of dicts with 'to' and 'message' keys

        Returns:
            dict with keys: success (bool), results (list), error (str)
            Each result in results list includes message_parts
        """
        normalised_recipients = []
        for recipient in recipients:
            if not self._validate_phone(recipient['to']):
                # Skip invalid phones (or could return error for whole batch)
                continue
            normalised_recipients.append({
                'to': self._normalise_phone(recipient['to']),
                'message': recipient['message'],
                'message_parts': self._calculate_sms_parts(recipient['message']),
            })

        return self._send_bulk_sms_impl(normalised_recipients)

    def send_mms(self, to: str, message: str, media_url: str, subject: Optional[str] = None) -> dict:
        """Send an MMS message with media.

        Validates and normalises the phone number, then calls _send_mms_impl().

        Args:
            to: Phone number (04XXXXXXXX or +614XXXXXXXX format)
            message: Message body (0-306 characters, can be empty)
            media_url: URL to media file
            subject: Optional subject line (max 64 characters)

        Returns:
            dict with keys: success (bool), message_id (str), error (str), message_parts (int)
        """
        if not self._validate_phone(to):
            return {
                'success': False,
                'message_id': None,
                'error': 'Invalid phone number format',
                'message_parts': 0,
            }

        normalised = self._normalise_phone(to)
        result = self._send_mms_impl(normalised, message, media_url, subject)
        result['message_parts'] = 1  # MMS is always 1 part
        return result

    @abstractmethod
    def _send_sms_impl(self, to: str, message: str) -> dict:
        """Implementation method for sending SMS.

        Phone number is already validated and normalised to 04XXXXXXXX format.

        Args:
            to: Normalised phone number (04XXXXXXXX)
            message: Message body

        Returns:
            dict with keys: success (bool), message_id (str), error (str)
        """
        pass

    @abstractmethod
    def _send_bulk_sms_impl(self, recipients: list[dict]) -> dict:
        """Implementation method for sending bulk SMS.

        All phone numbers are already validated and normalised.

        Args:
            recipients: List of dicts with normalised 'to' and 'message' keys

        Returns:
            dict with keys: success (bool), results (list), error (str)
        """
        pass

    @abstractmethod
    def _send_mms_impl(self, to: str, message: str, media_url: str, subject: Optional[str] = None) -> dict:
        """Implementation method for sending MMS.

        Phone number is already validated and normalised to 04XXXXXXXX format.

        Args:
            to: Normalised phone number (04XXXXXXXX)
            message: Message body
            media_url: URL to media file
            subject: Optional subject line

        Returns:
            dict with keys: success (bool), message_id (str), error (str)
        """
        pass


class MockSMSProvider(SMSProvider):
    """Mock SMS provider for development and testing.

    Logs all operations but doesn't actually send messages.
    Always returns success with generated message IDs.
    """

    def _send_sms_impl(self, to: str, message: str) -> dict:
        message_id = f'mock-sms-{uuid.uuid4().hex[:12]}'

        logger.info(
            'MockSMSProvider.send_sms',
            extra={
                'to': to,
                'message_length': len(message),
                'message_id': message_id,
            },
        )

        return {
            'success': True,
            'message_id': message_id,
            'error': None,
        }

    def _send_bulk_sms_impl(self, recipients: list[dict]) -> dict:
        results = []
        for recipient in recipients:
            result = self._send_sms_impl(recipient['to'], recipient['message'])
            results.append({
                'to': recipient['to'],
                'message_parts': recipient['message_parts'],
                **result,
            })

        successful = sum(1 for r in results if r['success'])
        failed = len(results) - successful

        logger.info(
            'MockSMSProvider.send_bulk_sms',
            extra={
                'total': len(recipients),
                'successful': successful,
                'failed': failed,
            },
        )

        return {
            'success': failed == 0,
            'results': results,
            'error': f'{failed} messages failed' if failed > 0 else None,
        }

    def _send_mms_impl(self, to: str, message: str, media_url: str, subject: Optional[str] = None) -> dict:
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

        return {
            'success': True,
            'message_id': message_id,
            'error': None,
        }


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
