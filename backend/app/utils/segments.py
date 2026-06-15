"""
SMS segment estimation (GSM 03.38 vs UCS-2).

Carriers encode a message as GSM-7 only when every character is in the GSM
03.38 charset: 160 septets in a single segment, 153 per segment when
concatenated (UDH overhead). Extension-table characters cost two septets.
Any other character (emoji, most non-Latin scripts, smart quotes) forces
UCS-2: 70 UTF-16 code units single, 67 per concatenated segment.

Segment count drives billing (units = recipients × parts), so this must not
assume GSM-7 — that undercounted unicode messages by more than 2×.

The frontend mirrors this logic in src/lib/sms.ts; keep them in sync.
"""

import math

# GSM 03.38 basic character set
GSM7_BASIC = set(
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
)
# Extension table — each costs an escape + char = 2 septets
GSM7_EXTENSION = set('\f^{}\\[~]|€')


def estimate_sms_segments(text: str) -> int:
    """Return the number of SMS segments `text` will occupy on the wire."""
    if not text:
        return 1

    if all(c in GSM7_BASIC or c in GSM7_EXTENSION for c in text):
        septets = sum(2 if c in GSM7_EXTENSION else 1 for c in text)
        if septets <= 160:
            return 1
        return math.ceil(septets / 153)

    # UCS-2: count UTF-16 code units (astral chars like most emoji take two)
    units = sum(2 if ord(c) > 0xFFFF else 1 for c in text)
    if units <= 70:
        return 1
    return math.ceil(units / 67)
