"""
Tests for the cleanup_stale_media_blobs Celery task.

Verifies that media blobs are cleaned up for failed schedules older than 7 days,
and that recent failures and non-failed schedules are left untouched.
"""

from datetime import timedelta
from unittest.mock import patch, Mock

import pytest
from django.utils import timezone

from app.models import MessageFormat, Schedule, ScheduleStatus
from app.celery import cleanup_stale_media_blobs


def _make_schedule(db, organisation, user, contact, **kwargs):
    defaults = dict(
        organisation=organisation,
        contact=contact,
        phone='0412345678',
        text='Hello test',
        scheduled_time=timezone.now(),
        status=ScheduleStatus.FAILED,
        format=MessageFormat.MMS,
        media_url='https://myaccount.blob.core.windows.net/media/test.png?sv=2022&sig=token',
        message_parts=1,
        max_retries=3,
        created_by=user,
        updated_by=user,
    )
    defaults.update(kwargs)
    return Schedule.objects.create(**defaults)


@pytest.mark.django_db
class TestCleanupStaleMediaBlobs:

    def test_cleans_failed_schedules_older_than_7_days(
        self, db, organisation, contact, user
    ):
        """Blobs for failed schedules updated >7 days ago are cleaned up."""
        schedule = _make_schedule(db, organisation, user, contact)
        # Backdate updated_at to 8 days ago
        Schedule.objects.filter(pk=schedule.pk).update(
            updated_at=timezone.now() - timedelta(days=8)
        )

        with patch('app.celery.get_storage_provider') as mock_storage:
            mock_provider = mock_storage.return_value
            result = cleanup_stale_media_blobs()

        assert result['cleaned'] == 1
        mock_provider.delete_blob.assert_called_once_with('test.png')

        schedule.refresh_from_db()
        assert schedule.media_url is None

    def test_skips_recent_failed_schedules(
        self, db, organisation, contact, user
    ):
        """Blobs for failed schedules updated <7 days ago are NOT cleaned."""
        schedule = _make_schedule(db, organisation, user, contact)
        # Updated at is recent (just created)

        with patch('app.celery.get_storage_provider') as mock_storage:
            result = cleanup_stale_media_blobs()

        assert result['cleaned'] == 0
        mock_storage.assert_not_called()

        schedule.refresh_from_db()
        assert schedule.media_url is not None

    def test_skips_non_failed_schedules(
        self, db, organisation, contact, user
    ):
        """Blobs for delivered/sent/etc schedules are NOT cleaned by this task."""
        schedule = _make_schedule(
            db, organisation, user, contact,
            status=ScheduleStatus.SENT,
        )
        Schedule.objects.filter(pk=schedule.pk).update(
            updated_at=timezone.now() - timedelta(days=8)
        )

        with patch('app.celery.get_storage_provider') as mock_storage:
            result = cleanup_stale_media_blobs()

        assert result['cleaned'] == 0
        mock_storage.assert_not_called()

    def test_skips_schedules_without_media_url(
        self, db, organisation, contact, user
    ):
        """SMS schedules (no media_url) are not touched."""
        _make_schedule(
            db, organisation, user, contact,
            format=MessageFormat.SMS,
            media_url=None,
        )

        with patch('app.celery.get_storage_provider') as mock_storage:
            result = cleanup_stale_media_blobs()

        assert result['cleaned'] == 0
        mock_storage.assert_not_called()

    def test_clears_media_url_after_cleanup(
        self, db, organisation, contact, user
    ):
        """After cleaning a blob, media_url is set to None to prevent re-attempts."""
        schedule = _make_schedule(db, organisation, user, contact)
        Schedule.objects.filter(pk=schedule.pk).update(
            updated_at=timezone.now() - timedelta(days=8)
        )

        with patch('app.celery.get_storage_provider'):
            cleanup_stale_media_blobs()

        schedule.refresh_from_db()
        assert schedule.media_url is None
