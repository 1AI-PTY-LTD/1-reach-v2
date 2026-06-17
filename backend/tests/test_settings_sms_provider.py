"""SMS_PROVIDER_CLASS must be env-overridable.

Verified in a fresh subprocess (like test_worker_startup.py) so the real
settings module is evaluated against a controlled environment — proving the
hardcoded Welcorp default can be swapped to a mock via env for E2E/backend tests
without a code change.
"""

import os
import subprocess
import sys


def _resolved_provider(env_overrides: dict) -> str:
    full = {**os.environ, 'DJANGO_SETTINGS_MODULE': 'app.settings'}
    full.pop('SMS_PROVIDER_CLASS', None)
    full.update(env_overrides)
    result = subprocess.run(
        [sys.executable, '-c',
         'import django; django.setup(); '
         'from django.conf import settings; print(settings.SMS_PROVIDER_CLASS)'],
        cwd='/app',
        env=full,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def test_defaults_to_welcorp_when_unset():
    assert _resolved_provider({}) == 'app.utils.welcorp.WelcorpSMSProvider'


def test_honours_env_override():
    assert _resolved_provider(
        {'SMS_PROVIDER_CLASS': 'app.utils.sms.MockSMSProvider'}
    ) == 'app.utils.sms.MockSMSProvider'
