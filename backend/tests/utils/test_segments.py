"""Tests for encoding-aware SMS segment estimation.

Regression suite: the old estimator assumed GSM-7 (160/153) for all text,
undercounting unicode messages — which segment as UCS-2 at 70/67 — by more
than 2x, and undercharging accordingly.
"""

import pytest

from app.utils.segments import estimate_sms_segments


class TestGsm7Segments:
    def test_empty_text_is_one_segment(self):
        assert estimate_sms_segments('') == 1

    def test_160_gsm_chars_fit_one_segment(self):
        assert estimate_sms_segments('a' * 160) == 1

    def test_161_gsm_chars_take_two_segments(self):
        assert estimate_sms_segments('a' * 161) == 2

    def test_concatenated_segments_use_153(self):
        assert estimate_sms_segments('a' * 306) == 2
        assert estimate_sms_segments('a' * 307) == 3

    def test_gsm_extension_chars_cost_two_septets(self):
        # 80 euro signs = 160 septets → still one segment; 81 → two
        assert estimate_sms_segments('€' * 80) == 1
        assert estimate_sms_segments('€' * 81) == 2

    def test_gsm_specials_stay_gsm(self):
        assert estimate_sms_segments('Hello Ø å Ñ ü ¿quién? @ £') == 1


class TestUcs2Segments:
    def test_emoji_forces_ucs2_70_limit(self):
        # 'a'*69 + emoji = 69 + 2 UTF-16 units = 71 > 70 → 2 segments
        assert estimate_sms_segments('a' * 68 + '🎉') == 1  # 70 units
        assert estimate_sms_segments('a' * 69 + '🎉') == 2  # 71 units

    def test_smart_quote_forces_ucs2(self):
        # 100 chars of GSM would be 1 segment; one curly quote flips to UCS-2
        text = ('a' * 99) + '’'
        assert estimate_sms_segments(text) == 2  # 100 units > 70

    def test_ucs2_concatenated_segments_use_67(self):
        # 70 units single; 71+ concatenate at 67/segment
        assert estimate_sms_segments('☃' * 70) == 1
        assert estimate_sms_segments('☃' * 71) == 2
        assert estimate_sms_segments('☃' * 134) == 2
        assert estimate_sms_segments('☃' * 135) == 3

    def test_306_char_unicode_message_is_five_segments(self):
        """The old GSM-only estimate said 2 — the wire reality is 5."""
        assert estimate_sms_segments('猫' * 306) == 5
