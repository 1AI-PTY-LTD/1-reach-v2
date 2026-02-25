import datetime
import zoneinfo

from django.db.models import Q
from django.db.models.functions import TruncDate
from django_filters import rest_framework as filters

from app.models import Contact, ContactGroup, Schedule, ScheduleStatus

DEFAULT_TZ = zoneinfo.ZoneInfo('Australia/Adelaide')


def _get_today(request):
    """Return today's date in the requested timezone (defaults to Adelaide)."""
    tz_name = request.GET.get('tz', '')
    try:
        tz = zoneinfo.ZoneInfo(tz_name) if tz_name else DEFAULT_TZ
    except (KeyError, zoneinfo.ZoneInfoNotFoundError):
        tz = DEFAULT_TZ
    return datetime.datetime.now(tz).date()


class ContactFilter(filters.FilterSet):
    search = filters.CharFilter(method='filter_search', min_length=2)
    exclude_group_id = filters.NumberFilter(method='filter_exclude_group')

    class Meta:
        model = Contact
        fields = []

    def filter_search(self, queryset, name, value):
        q = Q(first_name__icontains=value) | Q(last_name__icontains=value)
        # If input is all digits (ignoring spaces), search phone with spaces removed
        clean_value = value.replace(' ', '')
        if clean_value.isdigit():
            q |= Q(phone__icontains=clean_value)
        return queryset.filter(q)

    def filter_exclude_group(self, queryset, name, value):
        return queryset.exclude(contactgroupmember__group_id=value)


class ContactGroupFilter(filters.FilterSet):
    search = filters.CharFilter(method='filter_search', min_length=2)

    class Meta:
        model = ContactGroup
        fields = []

    def filter_search(self, queryset, name, value):
        return queryset.filter(
            Q(name__icontains=value) | Q(description__icontains=value)
        )


class ScheduleFilter(filters.FilterSet):
    date = filters.DateFilter(field_name='scheduled_time', lookup_expr='date')
    date_from = filters.DateFilter(field_name='scheduled_time', lookup_expr='gte')
    date_to = filters.DateFilter(field_name='scheduled_time', lookup_expr='lte')
    status = filters.ChoiceFilter(choices=ScheduleStatus.choices)

    class Meta:
        model = Schedule
        fields = []

    @property
    def qs(self):
        queryset = super().qs
        # Only apply default today filter if no date filters provided
        if 'date' not in self.data and 'date_from' not in self.data and 'date_to' not in self.data:
            if self.request:
                today = _get_today(self.request)
            else:
                # In tests or when no request, use Adelaide timezone default
                today = datetime.datetime.now(DEFAULT_TZ).date()
            # Use timezone-aware date filtering
            queryset = queryset.annotate(
                scheduled_date=TruncDate('scheduled_time', tzinfo=DEFAULT_TZ)
            ).filter(scheduled_date=today)
        return queryset


class GroupScheduleFilter(filters.FilterSet):
    date = filters.DateFilter(field_name='scheduled_time', lookup_expr='date')
    group_id = filters.NumberFilter(field_name='group_id')

    class Meta:
        model = Schedule
        fields = []

    @property
    def qs(self):
        queryset = super().qs
        # Only apply default today filter if no date filter provided
        if 'date' not in self.data:
            if self.request:
                today = _get_today(self.request)
            else:
                # In tests or when no request, use Adelaide timezone default
                today = datetime.datetime.now(DEFAULT_TZ).date()
            # Use timezone-aware date filtering
            queryset = queryset.annotate(
                scheduled_date=TruncDate('scheduled_time', tzinfo=DEFAULT_TZ)
            ).filter(scheduled_date=today)
        return queryset
