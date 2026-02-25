import zoneinfo
from datetime import datetime

from django.db.models import Q
from rest_framework import serializers

from app.models import Config, Schedule, MessageFormat


ADELAIDE_TZ = zoneinfo.ZoneInfo('Australia/Adelaide')


def get_sms_limit_info(org) -> dict:
    """Get SMS limit information for an organisation.

    Returns current count, limit, and remaining capacity for this month.

    Args:
        org: Organisation instance

    Returns:
        dict with keys: 'current', 'limit', 'remaining' (None if no limit configured)
    """
    config = Config.objects.filter(organisation=org, name='sms_limit').first()
    if not config:
        return {'current': 0, 'limit': None, 'remaining': None}

    limit = int(config.value)

    # Calculate current month in Adelaide timezone
    now = datetime.now(ADELAIDE_TZ)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # Count SMS schedules this month (format=SMS or null for backward compat)
    count = Schedule.objects.filter(
        organisation=org,
        scheduled_time__gte=month_start,
    ).filter(
        Q(format=MessageFormat.SMS) | Q(format__isnull=True)
    ).exclude(
        status='cancelled'
    ).count()

    return {
        'current': count,
        'limit': limit,
        'remaining': limit - count
    }


def check_sms_limit(org) -> None:
    """Check if organisation has exceeded monthly SMS limit.

    Reads limit from Config (name='sms_limit'), counts current month's
    SMS schedules, and raises ValidationError if limit exceeded.

    Args:
        org: Organisation instance

    Raises:
        serializers.ValidationError: If monthly SMS limit exceeded
    """
    info = get_sms_limit_info(org)

    if info['limit'] is None:
        return  # No limit configured

    if info['remaining'] <= 0:
        raise serializers.ValidationError(
            f'Monthly SMS limit reached ({info["current"]}/{info["limit"]})'
        )


def get_mms_limit_info(org) -> dict:
    """Get MMS limit information for an organisation.

    Returns current count, limit, and remaining capacity for this month.

    Args:
        org: Organisation instance

    Returns:
        dict with keys: 'current', 'limit', 'remaining' (None if no limit configured)
    """
    config = Config.objects.filter(organisation=org, name='mms_limit').first()
    if not config:
        return {'current': 0, 'limit': None, 'remaining': None}

    limit = int(config.value)

    # Calculate current month in Adelaide timezone
    now = datetime.now(ADELAIDE_TZ)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # Count MMS schedules this month
    count = Schedule.objects.filter(
        organisation=org,
        scheduled_time__gte=month_start,
        format=MessageFormat.MMS,
    ).exclude(
        status='cancelled'
    ).count()

    return {
        'current': count,
        'limit': limit,
        'remaining': limit - count
    }


def check_mms_limit(org) -> None:
    """Check if organisation has exceeded monthly MMS limit.

    Reads limit from Config (name='mms_limit'), counts current month's
    MMS schedules, and raises ValidationError if limit exceeded.

    Args:
        org: Organisation instance

    Raises:
        serializers.ValidationError: If monthly MMS limit exceeded
    """
    info = get_mms_limit_info(org)

    if info['limit'] is None:
        return  # No limit configured

    if info['remaining'] <= 0:
        raise serializers.ValidationError(
            f'Monthly MMS limit reached ({info["current"]}/{info["limit"]})'
        )
