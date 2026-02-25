"""Custom throttle classes for rate limiting."""

from rest_framework.throttling import ScopedRateThrottle


class SMSThrottle(ScopedRateThrottle):
    """Throttle for SMS/MMS sending endpoints."""
    scope = 'sms'


class ImportThrottle(ScopedRateThrottle):
    """Throttle for bulk import endpoints."""
    scope = 'import'
