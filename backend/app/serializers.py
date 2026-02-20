import re

from django.utils import timezone
from rest_framework import serializers

from app.models import *


class OrganisationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organisation
        fields = ['clerk_org_id', 'name', 'slug']


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'first_name', 'last_name', 'email', 'clerk_id', 'created_at', 'updated_at']


class MeSerializer(serializers.Serializer):
    user = UserSerializer(source='*')
    organisation = serializers.SerializerMethodField()

    def get_organisation(self, obj):
        request = self.context['request']
        org = getattr(request, 'org', None)
        if not org:
            return None
        data = OrganisationSerializer(org).data
        data['role'] = request.org_role
        data['permissions'] = request.org_permissions
        return data


class ContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = [
            'id', 'first_name', 'last_name', 'phone', 'email', 'company',
            'is_active', 'opt_out', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def validate_phone(self, value):
        cleaned = re.sub(r'\s+', '', value)
        # Accept +614XXXXXXXX and normalise to 04XXXXXXXX
        if cleaned.startswith('+614'):
            cleaned = '0' + cleaned[3:]
        if not re.match(r'^04\d{8}$', cleaned):
            raise serializers.ValidationError('Phone must be an Australian mobile number (04XXXXXXXX or +614XXXXXXXX).')
        return cleaned

    def validate_first_name(self, value):
        return value.strip()[:100]

    def validate_last_name(self, value):
        return value.strip()[:100]


class ContactGroupSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(read_only=True, default=0)
    member_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        default=list,
        write_only=True,
    )

    class Meta:
        model = ContactGroup
        fields = [
            'id', 'name', 'description', 'is_active',
            'member_count', 'member_ids', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def validate_name(self, value):
        v = value.strip()
        if len(v) < 2:
            raise serializers.ValidationError('Name must be at least 2 characters.')
        return v[:100]

    def validate_description(self, value):
        if value:
            return value.strip()[:500]
        return value


class GroupMemberActionSerializer(serializers.Serializer):
    contact_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        min_length=1,
        max_length=100,
    )


class TemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Template
        fields = [
            'id', 'name', 'text', 'is_active', 'version',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def validate_name(self, value):
        v = value.strip()
        if len(v) < 1:
            raise serializers.ValidationError('Name is required.')
        return v[:100]

    def validate_text(self, value):
        v = value.strip()
        if len(v) < 1:
            raise serializers.ValidationError('Text is required.')
        if len(v) > 320:
            raise serializers.ValidationError('Text must be at most 320 characters.')
        return v


class ScheduleSerializer(serializers.ModelSerializer):
    contact_detail = ContactSerializer(source='contact', read_only=True)

    class Meta:
        model = Schedule
        fields = [
            'id', 'name', 'template', 'text', 'message_parts',
            'contact', 'contact_detail', 'phone',
            'group', 'parent',
            'scheduled_time', 'sent_time',
            'status', 'error',
            'format', 'media_url', 'subject',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['sent_time', 'created_at', 'updated_at']

    def validate_text(self, value):
        if value:
            v = value.strip()
            if len(v) > 306:
                raise serializers.ValidationError('Text must be at most 306 characters.')
            return v
        return value

    def validate_scheduled_time(self, value):
        if value <= timezone.now():
            raise serializers.ValidationError('Scheduled time must be in the future.')
        return value

    def validate(self, attrs):
        if self.instance and self.instance.status != ScheduleStatus.PENDING:
            raise serializers.ValidationError('Only pending schedules can be updated.')
        return attrs


class GroupScheduleCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    template_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    text = serializers.CharField(max_length=306, required=False, allow_null=True, allow_blank=True)
    group_id = serializers.IntegerField(min_value=1)
    scheduled_time = serializers.DateTimeField()

    def validate_scheduled_time(self, value):
        if value <= timezone.now():
            raise serializers.ValidationError('Scheduled time must be in the future.')
        return value

    def validate(self, attrs):
        has_template = attrs.get('template_id')
        has_text = attrs.get('text') and attrs['text'].strip()
        if not has_template and not has_text:
            raise serializers.ValidationError(
                'Either template_id or text must be provided.'
            )
        return attrs


class GroupScheduleUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100, required=False)
    template_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    text = serializers.CharField(max_length=306, required=False, allow_null=True, allow_blank=True)
    scheduled_time = serializers.DateTimeField(required=False)
    status = serializers.ChoiceField(choices=ScheduleStatus.choices, required=False)

    def validate_scheduled_time(self, value):
        if value and value <= timezone.now():
            raise serializers.ValidationError('Scheduled time must be in the future.')
        return value


class ConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = Config
        fields = ['id', 'name', 'value']
