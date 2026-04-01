"""
Pure error taxonomy classifier for message send failures.

No DB access, no side effects — returns (FailureCategory, is_retryable).
Imported by tasks.py and (in future) by delivery webhook handlers.

Classification priority:
  1. Known provider error codes (e.g. Twilio 21211 = invalid number)
  2. HTTP status: 429 → rate limited (retryable), 4xx → permanent, 5xx → server error (retryable)
  3. Keyword match on error message string
  4. Default: UNKNOWN_TRANSIENT (retryable) — safer than silently discarding
"""

from app.models import FailureCategory

# ---------------------------------------------------------------------------
# Known provider error-code mappings
# Provider-specific codes map to a (FailureCategory, retryable) pair.
# Add new provider codes here as real providers are integrated.
# ---------------------------------------------------------------------------

_KNOWN_ERROR_CODES: dict[str, tuple[FailureCategory, bool]] = {
    # Twilio
    '21211': (FailureCategory.INVALID_NUMBER, False),
    '21212': (FailureCategory.INVALID_NUMBER, False),
    '21214': (FailureCategory.INVALID_NUMBER, False),
    '21217': (FailureCategory.INVALID_NUMBER, False),
    '21219': (FailureCategory.INVALID_NUMBER, False),
    '21401': (FailureCategory.INVALID_NUMBER, False),
    '21407': (FailureCategory.UNROUTABLE, False),
    '21408': (FailureCategory.UNROUTABLE, False),
    '21614': (FailureCategory.INVALID_NUMBER, False),
    '30003': (FailureCategory.UNROUTABLE, False),       # Unreachable destination
    '30004': (FailureCategory.BLACKLISTED, False),      # Message blocked
    '30005': (FailureCategory.UNROUTABLE, False),       # Unknown destination handset
    '30006': (FailureCategory.UNROUTABLE, False),       # Landline / not capable
    '30007': (FailureCategory.UNKNOWN_PERMANENT, False),# Carrier violation
    '30008': (FailureCategory.UNKNOWN_TRANSIENT, True), # Unknown error (carrier)
    '21610': (FailureCategory.OPT_OUT, False),          # Attempted to send to STOP'd number
    '20429': (FailureCategory.RATE_LIMITED, True),      # Too many requests
    '20003': (FailureCategory.ACCOUNT_ERROR, False),    # Permission denied
    '20004': (FailureCategory.ACCOUNT_ERROR, False),    # Method not allowed
    # Welcorp SMS status codes
    'INVN': (FailureCategory.INVALID_NUMBER, False),    # Invalid number
    'BARR': (FailureCategory.BLACKLISTED, False),       # Blocked/forbidden
    'OPTO': (FailureCategory.OPT_OUT, False),           # Opted out
    'BADS': (FailureCategory.ACCOUNT_ERROR, False),     # Invalid sender ID
    'RECE': (FailureCategory.INVALID_NUMBER, False),    # Invalid destination
    'SVRE': (FailureCategory.SERVER_ERROR, True),       # SMS delivery pathway error
    'EXPD': (FailureCategory.UNKNOWN_TRANSIENT, True),  # Could not deliver in time
    'FAIL': (FailureCategory.UNKNOWN_TRANSIENT, True),  # Destination unavailable
    'QUED': (FailureCategory.UNKNOWN_TRANSIENT, True),  # Still queued (not terminal)
    # Network-level errors (provider-agnostic)
    'TIMEOUT': (FailureCategory.SERVER_ERROR, True),       # Request timed out
    'CONN_ERROR': (FailureCategory.SERVER_ERROR, True),    # Connection refused/reset/DNS failure
}

# ---------------------------------------------------------------------------
# Keyword patterns for error message matching (last-resort, lower priority)
# ---------------------------------------------------------------------------

_PERMANENT_KEYWORDS = [
    'invalid number', 'invalid phone', 'invalid destination',
    'opted out', 'opt-out', 'unsubscribed', 'blacklisted', 'blocked',
    'landline', 'not capable', 'undeliverable', 'no route', 'unroutable',
    'permission denied', 'account', 'content rejected', 'spam',
]

_TRANSIENT_KEYWORDS = [
    'timeout', 'timed out', 'connection', 'network', 'unavailable',
    'rate limit', 'too many requests', 'retry', 'temporary', 'service unavailable',
    'internal server error', '503', '500',
]


def classify_failure(
    error_code: str | None,
    http_status: int | None,
    error_message: str | None,
) -> tuple[FailureCategory, bool]:
    """Classify a send failure into a FailureCategory.

    Returns:
        (FailureCategory, is_retryable)
    """
    # 1. Known provider error codes take highest priority
    if error_code and str(error_code) in _KNOWN_ERROR_CODES:
        return _KNOWN_ERROR_CODES[str(error_code)]

    # 2. HTTP status code
    if http_status is not None:
        if http_status == 401:
            return FailureCategory.ACCOUNT_ERROR, False
        if http_status == 429:
            return FailureCategory.RATE_LIMITED, True
        if http_status >= 500:
            return FailureCategory.SERVER_ERROR, True
        if http_status >= 400:
            # Generic client error — permanent (don't retry bad requests)
            return FailureCategory.UNKNOWN_PERMANENT, False

    # 3. Keyword match on error message
    if error_message:
        msg_lower = error_message.lower()
        for kw in _PERMANENT_KEYWORDS:
            if kw in msg_lower:
                return FailureCategory.UNKNOWN_PERMANENT, False
        for kw in _TRANSIENT_KEYWORDS:
            if kw in msg_lower:
                return FailureCategory.UNKNOWN_TRANSIENT, True

    # 4. Default: assume transient (safer than silently losing messages)
    return FailureCategory.UNKNOWN_TRANSIENT, True
