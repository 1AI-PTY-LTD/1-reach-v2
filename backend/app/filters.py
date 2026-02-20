import datetime
import zoneinfo

from django.db.models import Q
from django_filters import rest_framework as filters

from app.models import Contact, ContactGroup, Schedule

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
        if value.replace(' ', '').isdigit():
            q |= Q(phone__icontains=value)
        return queryset.filter(q)

    def filter_exclude_group(self, queryset, name, value):
        return queryset.exclude(contactgroupmember__group_id=value)


class ContactGroupFilter(filters.FilterSet):
    search = filters.CharFilter(field_name='name', lookup_expr='icontains', min_length=2)

    class Meta:
        model = ContactGroup
        fields = []


class ScheduleFilter(filters.FilterSet):
    date = filters.DateFilter(field_name='scheduled_time', lookup_expr='date')

    class Meta:
        model = Schedule
        fields = []

    @property
    def qs(self):
        queryset = super().qs
        if 'date' not in self.data:
            today = _get_today(self.request)
            queryset = queryset.filter(scheduled_time__date=today)
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
        if 'date' not in self.data:
            today = _get_today(self.request)
            queryset = queryset.filter(scheduled_time__date=today)
        return queryset
