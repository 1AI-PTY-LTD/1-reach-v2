"""Tests for _compute_backoff_delay (pure helper in app.celery).

Exponential backoff with full jitter:

    delay = min(base * 2^retry_count, max_delay) * (1 ± jitter)
    return max(1, int(delay))

Where base/max_delay/jitter come from settings (CI overrides them, so these
tests derive bounds from the settings values rather than hardcoded literals).
"""

import random

import pytest
from django.conf import settings
from django.test import override_settings

from app.celery import _compute_backoff_delay


@pytest.fixture
def retry_settings():
    """Resolve the retry tuning constants the helper reads (matching getattr defaults)."""
    base = getattr(settings, 'MESSAGE_RETRY_BASE_DELAY', 60)
    max_delay = getattr(settings, 'MESSAGE_RETRY_MAX_DELAY', 3600)
    jitter = getattr(settings, 'MESSAGE_RETRY_JITTER', 0.25)
    return base, max_delay, jitter


def _bounds(uncapped, max_delay, jitter):
    """Expected [low, high] for delay = min(uncapped, max_delay) * (1 ± jitter)."""
    capped = min(uncapped, max_delay)
    low = max(1, int(capped * (1 - jitter)))
    high = max(1, int(capped * (1 + jitter)))
    return low, high


class TestComputeBackoffDelay:
    def test_returns_int(self, retry_settings):
        assert isinstance(_compute_backoff_delay(0), int)

    def test_retry_count_zero_is_base_within_jitter(self, retry_settings):
        """At n=0 the uncapped delay is base, scaled within ±jitter."""
        base, max_delay, jitter = retry_settings
        low, high = _bounds(base, max_delay, jitter)
        for _ in range(200):
            delay = _compute_backoff_delay(0)
            assert low <= delay <= high

    def test_doubling_at_n1_and_n2(self, retry_settings):
        """Uncapped target doubles each retry: base, 2*base, 4*base (within jitter)."""
        base, max_delay, jitter = retry_settings
        for n in (1, 2):
            uncapped = base * (2 ** n)
            low, high = _bounds(uncapped, max_delay, jitter)
            for _ in range(200):
                delay = _compute_backoff_delay(n)
                assert low <= delay <= high

    def test_zero_jitter_gives_exact_doubling(self):
        """With jitter forced to 0, delays are exactly base * 2^n (uncapped region)."""
        base = getattr(settings, 'MESSAGE_RETRY_BASE_DELAY', 60)
        big_max = base * (2 ** 10)  # keep n=0,1,2 in the uncapped region
        with override_settings(
            MESSAGE_RETRY_BASE_DELAY=base,
            MESSAGE_RETRY_MAX_DELAY=big_max,
            MESSAGE_RETRY_JITTER=0.0,
        ):
            assert _compute_backoff_delay(0) == base
            assert _compute_backoff_delay(1) == base * 2
            assert _compute_backoff_delay(2) == base * 4

    def test_caps_at_max_delay(self, retry_settings):
        """For a very large retry_count the uncapped term saturates at max_delay."""
        base, max_delay, jitter = retry_settings
        low, high = _bounds(max_delay, max_delay, jitter)  # min() picks max_delay
        for _ in range(200):
            delay = _compute_backoff_delay(50)  # base * 2^50 >> max_delay
            assert low <= delay <= high
            assert delay <= int(max_delay * (1 + jitter))

    def test_jitter_within_plus_minus_bounds(self, retry_settings):
        """Across many samples the delay never escapes ±jitter of the capped target."""
        base, max_delay, jitter = retry_settings
        for n in (0, 1, 2, 3):
            uncapped = base * (2 ** n)
            capped = min(uncapped, max_delay)
            lower = capped * (1 - jitter)
            upper = capped * (1 + jitter)
            for _ in range(300):
                delay = _compute_backoff_delay(n)
                # int() truncates toward zero, so the realised value can sit one
                # below the float lower bound but never beneath it by a whole unit.
                assert delay >= max(1, int(lower))
                assert delay <= int(upper)

    def test_jitter_actually_varies_output(self, retry_settings):
        """Non-zero jitter produces a spread of values (not a constant)."""
        base, max_delay, jitter = retry_settings
        if jitter == 0:
            pytest.skip('jitter disabled in this environment')
        samples = {_compute_backoff_delay(2) for _ in range(200)}
        assert len(samples) > 1

    def test_floor_of_one_when_base_is_tiny(self):
        """delay is floored at 1 even if scaled value truncates to 0."""
        with override_settings(
            MESSAGE_RETRY_BASE_DELAY=0,
            MESSAGE_RETRY_MAX_DELAY=3600,
            MESSAGE_RETRY_JITTER=0.25,
        ):
            assert _compute_backoff_delay(0) == 1
            assert _compute_backoff_delay(5) == 1

    def test_deterministic_with_seeded_random(self):
        """With a fixed random state the output is reproducible (random.random used)."""
        with override_settings(
            MESSAGE_RETRY_BASE_DELAY=60,
            MESSAGE_RETRY_MAX_DELAY=3600,
            MESSAGE_RETRY_JITTER=0.25,
        ):
            random.seed(1234)
            first = _compute_backoff_delay(1)
            random.seed(1234)
            second = _compute_backoff_delay(1)
            assert first == second
