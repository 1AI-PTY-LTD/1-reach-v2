import csv
import io
import logging
import re
import zoneinfo
from collections import defaultdict
from datetime import datetime

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from app.throttles import ImportThrottle, SMSThrottle
from svix.webhooks import Webhook, WebhookVerificationError

from app.filters import ContactFilter, ContactGroupFilter, GroupScheduleFilter, ScheduleFilter
from app.mixins import SoftDeleteMixin, TenantScopedMixin
from app.models import *
from app.permissions import IsOrgMember
from app.serializers import *
from app.utils import clerk
from app.utils.limits import get_sms_limit_info, get_mms_limit_info
from app.utils.sms import get_sms_provider
from app.utils.storage import get_storage_provider

logger = logging.getLogger(__name__)


class UserViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated, IsOrgMember]

    def get_queryset(self):
        org = getattr(self.request, 'org', None)
        if not org:
            return User.objects.none()
        return User.objects.filter(
            organisationmembership__organisation=org,
            organisationmembership__is_active=True,
        ).order_by('first_name', 'last_name')

    @action(detail=False, methods=['get'])
    def me(self, request):
        """GET /api/users/me/ — authenticated user (read-only, managed by Clerk)."""
        serializer = UserSerializer(request.user)
        # Exclude clerk_id from response
        data = serializer.data
        data.pop('clerk_id', None)
        return Response(data)


class ClerkWebhookView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        signing_secret = settings.CLERK_WEBHOOK_SIGNING_SECRET
        if not signing_secret:
            logger.error('CLERK_WEBHOOK_SIGNING_SECRET not configured')
            return Response({'error': 'Webhook not configured'}, status=500)

        headers = {
            'svix-id': request.headers.get('svix-id', ''),
            'svix-timestamp': request.headers.get('svix-timestamp', ''),
            'svix-signature': request.headers.get('svix-signature', ''),
        }

        try:
            wh = Webhook(signing_secret)
            payload = wh.verify(request.body, headers)
        except WebhookVerificationError:
            logger.warning('Clerk webhook signature verification failed')
            return Response({'error': 'Invalid signature'}, status=400)

        event_type = payload.get('type')
        data = payload.get('data', {})

        handler = clerk.WEBHOOK_HANDLERS.get(event_type)
        if handler:
            handler(data)
            logger.info('Processed Clerk webhook event: %s', event_type)
        else:
            logger.debug('Unhandled Clerk webhook event: %s', event_type)

        return Response({'status': 'ok'})


class ContactViewSet(SoftDeleteMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Contact.objects.order_by('-created_at')
    serializer_class = ContactSerializer
    permission_classes = [IsAuthenticated, IsOrgMember]
    filterset_class = ContactFilter
    http_method_names = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

    @action(detail=True, methods=['get'])
    def schedules(self, request, pk=None):
        """Create nested GET /api/contacts/:id/schedules/"""
        contact = self.get_object()
        schedules = Schedule.objects.filter(
            contact=contact,
            organisation=contact.organisation,
        ).exclude(
            status=ScheduleStatus.CANCELLED
        ).order_by('-scheduled_time')
        
        page = self.paginate_queryset(schedules)
        serializer = ScheduleSerializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=False, methods=['post'], url_path='import', throttle_classes=[ImportThrottle])
    def import_contacts(self, request):
        """POST /api/contacts/import/ — bulk import contacts from a CSV file."""
        org = getattr(request, 'org', None)
        if not org:
            return Response({'detail': 'Organisation required.'}, status=status.HTTP_400_BAD_REQUEST)

        # Validate file is present and is CSV
        uploaded = request.FILES.get('file')
        if not uploaded:
            return Response({'detail': 'No file uploaded.'}, status=status.HTTP_400_BAD_REQUEST)
        if not uploaded.name.lower().endswith('.csv'):
            return Response({'detail': 'Only CSV files are allowed.'}, status=status.HTTP_400_BAD_REQUEST)
        if uploaded.size > 5 * 1024 * 1024:
            return Response({'detail': 'File size must be less than 5MB.'}, status=status.HTTP_400_BAD_REQUEST)

        # Parse CSV
        try:
            text = io.TextIOWrapper(uploaded, encoding='utf-8')
            reader = csv.DictReader(text)
        except Exception:
            return Response({'detail': 'Failed to parse CSV file.'}, status=status.HTTP_400_BAD_REQUEST)

        # Fetch existing phones for this org to detect duplicates
        existing_phones = set(
            Contact.objects.filter(organisation=org).values_list('phone', flat=True)
        )

        error_records = []
        to_create = []

        for row in reader:
            first_name = (row.get('first_name') or '').strip()[:100]
            last_name = (row.get('last_name') or '').strip()[:100]
            phone_raw = row.get('phone', '')

            # Validate and normalise phone
            cleaned = re.sub(r'\s+', '', phone_raw)
            if cleaned.startswith('+614'):
                cleaned = '0' + cleaned[3:]

            if not re.match(r'^04\d{8}$', cleaned):
                error_records.append({**row, 'error': 'Invalid phone number format.'})
                continue

            if cleaned in existing_phones:
                error_records.append({**row, 'error': 'Contact already exists.'})
                continue

            # Track phone to catch duplicates within the file itself
            existing_phones.add(cleaned)

            to_create.append(Contact(
                organisation=org,
                first_name=first_name,
                last_name=last_name,
                phone=cleaned,
                created_by=request.user,
                updated_by=request.user,
            ))

        # Bulk create all valid records
        Contact.objects.bulk_create(to_create)

        record_count = len(to_create) + len(error_records)
        success_count = len(to_create)
        error_count = len(error_records)
        has_errors = error_count > 0

        return Response(
            {
                'status': 'partial' if has_errors else 'success',
                'message': f'{success_count} imported, {error_count} failed' if has_errors
                    else f'{success_count} imported successfully',
                'record_count': record_count,
                'success_count': success_count,
                'error_count': error_count,
                'error_records': error_records,
            },
            status=207 if has_errors else status.HTTP_200_OK,
        )


class ContactGroupViewSet(SoftDeleteMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = ContactGroup.objects.all()
    serializer_class = ContactGroupSerializer
    permission_classes = [IsAuthenticated, IsOrgMember]
    filterset_class = ContactGroupFilter

    def get_queryset(self):
        return super().get_queryset().annotate(
            member_count=Count('contactgroupmember'),
        ).order_by('name')

    def perform_create(self, serializer):
        super().perform_create(serializer)
        member_ids = serializer.validated_data.get('member_ids', [])
        if member_ids:
            group = serializer.instance
            contacts = Contact.objects.filter(id__in=member_ids, organisation=group.organisation)
            members = [ContactGroupMember(contact=c, group=group) for c in contacts]
            ContactGroupMember.objects.bulk_create(members, ignore_conflicts=True)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        data = self.get_serializer(instance).data
        
        members_qs = Contact.objects.filter(contactgroupmember__group=instance).order_by('first_name', 'last_name')
        
        page = self.paginate_queryset(members_qs)
        members_data = ContactSerializer(page, many=True).data
        paginated = self.paginator.get_paginated_response(members_data).data
        
        data['members'] = paginated
        return Response(data)

    @action(detail=True, methods=['post', 'delete'], url_path='members')
    def members(self, request, pk=None):
        """
        POST /api/groups/:id/members/ — add members
        DELETE /api/groups/:id/members/ — remove members
        """
        group = self.get_object()
        serializer = GroupMemberActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        contact_ids = serializer.validated_data['contact_ids']

        if request.method == 'POST':
            contacts = Contact.objects.filter(id__in=contact_ids, organisation=group.organisation)
            members = [ContactGroupMember(contact=c, group=group) for c in contacts]
            created = ContactGroupMember.objects.bulk_create(members, ignore_conflicts=True)
            return Response(
                {'message': f'{len(created)} members added.', 'added_count': len(created)},
                status=status.HTTP_201_CREATED,
            )

        elif request.method == 'DELETE':
            deleted, _ = ContactGroupMember.objects.filter(group=group, contact_id__in=contact_ids).delete()
            return Response(
                {'message': f'{deleted} members removed.', 'removed_count': deleted},
                status=status.HTTP_200_OK,
            )


class TemplateViewSet(SoftDeleteMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Template.objects.filter(is_active=True).order_by('name')
    serializer_class = TemplateSerializer
    permission_classes = [IsAuthenticated, IsOrgMember]
    http_method_names = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']
    filter_backends = [filters.SearchFilter]
    search_fields = ['name']

    def perform_update(self, serializer):
        """Auto-increment version on update."""
        instance = serializer.save()
        instance.version += 1
        instance.save(update_fields=['version'])


class ScheduleViewSet(TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Schedule.objects.exclude(
        status=ScheduleStatus.CANCELLED,
    ).filter(
        parent__isnull=True,  # Exclude child schedules
        group__isnull=True,   # Exclude group schedules (handled by /api/group-schedules/)
    ).select_related('contact', 'template', 'group').order_by('-scheduled_time')

    serializer_class = ScheduleSerializer
    permission_classes = [IsAuthenticated, IsOrgMember]
    filterset_class = ScheduleFilter
    http_method_names = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

    def perform_destroy(self, instance):
        """Soft delete by setting status=CANCELLED (v1 used DELETED, v2 uses CANCELLED)."""
        # Only allow deleting PENDING schedules
        if instance.status != ScheduleStatus.PENDING:
            raise ValidationError(f'Cannot delete schedule - only {ScheduleStatus.PENDING} schedules can be deleted')

        instance.status = ScheduleStatus.CANCELLED
        instance.updated_by = self.request.user
        instance.save(update_fields=['status', 'updated_by'])


class GroupScheduleViewSet(TenantScopedMixin, viewsets.GenericViewSet):
    """Manages group schedules — a parent Schedule linked to per-member child Schedules.

    A "group schedule" is a parent Schedule row (group set, no contact) with
    one child Schedule per group member (contact set, parent set). All mutations
    happen inside a transaction so the parent and children stay in sync.
    """
    permission_classes = [IsAuthenticated, IsOrgMember]
    serializer_class = ScheduleSerializer
    filterset_class = GroupScheduleFilter

    def get_queryset(self):
        # Only return parent-level group schedules for this org
        org_id = getattr(self.request, 'org_id', None)
        if not org_id:
            return Schedule.objects.none()
        return Schedule.objects.filter(
            organisation__clerk_org_id=org_id,
            parent__isnull=True,
            group__isnull=False,
        ).exclude(status=ScheduleStatus.CANCELLED)

    def list(self, request):
        qs = self.get_queryset().select_related('group', 'template').order_by('-scheduled_time')

        # Apply filters manually (ViewSet doesn't integrate django-filter automatically)
        filterset = GroupScheduleFilter(request.query_params, queryset=qs)
        qs = filterset.qs

        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = ScheduleSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = ScheduleSerializer(qs, many=True)
        return Response(serializer.data)

    def retrieve(self, request, pk=None):
        parent = self.get_queryset().filter(pk=pk).first()
        if not parent:
            return Response(status=status.HTTP_404_NOT_FOUND)

        # Include per-member child schedules in the response
        data = ScheduleSerializer(parent).data
        children = Schedule.objects.filter(parent=parent).select_related('contact')
        data['schedules'] = ScheduleSerializer(children, many=True).data
        data['child_count'] = children.count()
        return Response(data)

    def create(self, request):
        serializer = GroupScheduleCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        org = getattr(request, 'org', None)
        if not org:
            return Response({'detail': 'Organisation required.'}, status=status.HTTP_400_BAD_REQUEST)

        # Resolve the group
        group = ContactGroup.objects.filter(id=data['group_id'], organisation=org).first()
        if not group:
            return Response({'detail': 'Group not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Resolve template or inline text
        template, text = None, data.get('text', '')
        if data.get('template_id'):
            template = Template.objects.filter(id=data['template_id'], organisation=org).first()
            if not template:
                return Response({'detail': 'Template not found.'}, status=status.HTTP_404_NOT_FOUND)
            text = template.text
        elif text:
            text = text.strip()

        # Ensure the group has members to schedule (skip opted-out contacts)
        members = Contact.objects.filter(contactgroupmember__group=group, opt_out=False)
        if not members.exists():
            return Response({'detail': 'Group has no members.'}, status=status.HTTP_400_BAD_REQUEST)

        # Create parent + one child per member atomically
        with transaction.atomic():
            parent = Schedule.objects.create(
                organisation=org,
                name=data['name'],
                template=template,
                text=text,
                group=group,
                scheduled_time=data['scheduled_time'],
                created_by=request.user,
                updated_by=request.user,
            )
            children = Schedule.objects.bulk_create([
                Schedule(
                    organisation=org,
                    template=template,
                    text=text,
                    contact=member,
                    phone=member.phone,
                    group=group,
                    parent=parent,
                    scheduled_time=data['scheduled_time'],
                    created_by=request.user,
                    updated_by=request.user,
                )
                for member in members
            ])

        resp = ScheduleSerializer(parent).data
        resp['schedules'] = ScheduleSerializer(children, many=True).data
        return Response(resp, status=status.HTTP_201_CREATED)

    def update(self, request, pk=None):
        parent = self.get_queryset().filter(pk=pk).first()
        if not parent:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if parent.status != ScheduleStatus.PENDING:
            return Response(
                {'detail': 'Only pending group schedules can be updated.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = GroupScheduleUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        org = getattr(request, 'org', None)

        # Build the set of fields to update on the parent
        update_fields = {'updated_by': request.user}
        if 'name' in data:
            update_fields['name'] = data['name']
        if 'scheduled_time' in data:
            update_fields['scheduled_time'] = data['scheduled_time']
        if 'text' in data:
            update_fields['text'] = data['text']

        # Resolve template if provided (None clears the template)
        if 'template_id' in data:
            if data['template_id']:
                template = Template.objects.filter(id=data['template_id'], organisation=org).first()
                if not template:
                    return Response({'detail': 'Template not found.'}, status=status.HTTP_404_NOT_FOUND)
                update_fields['template'] = template
                update_fields['text'] = template.text
            else:
                update_fields['template'] = None

        # Update parent and propagate relevant fields to pending children
        with transaction.atomic():
            for field, value in update_fields.items():
                setattr(parent, field, value)
            parent.save()

            # Only propagate shared fields (text, template, time) to children
            child_fields = {
                k: v for k, v in update_fields.items()
                if k in ('text', 'template', 'scheduled_time', 'updated_by')
            }
            if child_fields:
                Schedule.objects.filter(
                    parent=parent, status=ScheduleStatus.PENDING,
                ).update(**child_fields)

        parent.refresh_from_db()
        resp = ScheduleSerializer(parent).data
        children = Schedule.objects.filter(parent=parent).select_related('contact')
        resp['schedules'] = ScheduleSerializer(children, many=True).data
        return Response(resp)

    def partial_update(self, request, pk=None):
        """PATCH /api/group-schedules/{id}/ - same as update."""
        return self.update(request, pk)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """POST /api/group-schedules/{id}/cancel/ - cancel parent and pending children."""
        parent = self.get_queryset().filter(pk=pk).first()
        if not parent:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if parent.status != ScheduleStatus.PENDING:
            return Response(
                {'detail': 'Only pending group schedules can be cancelled.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Cancel the parent and all pending children atomically
        with transaction.atomic():
            Schedule.objects.filter(
                parent=parent, status=ScheduleStatus.PENDING,
            ).update(status=ScheduleStatus.CANCELLED, updated_by=request.user)
            parent.status = ScheduleStatus.CANCELLED
            parent.updated_by = request.user
            parent.save()

        return Response({'message': 'Group schedule cancelled.'})

    def destroy(self, request, pk=None):
        parent = self.get_queryset().filter(pk=pk).first()
        if not parent:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if parent.status != ScheduleStatus.PENDING:
            return Response(
                {'detail': 'Only pending group schedules can be cancelled.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Cancel the parent and all pending children atomically
        with transaction.atomic():
            Schedule.objects.filter(
                parent=parent, status=ScheduleStatus.PENDING,
            ).update(status=ScheduleStatus.CANCELLED, updated_by=request.user)
            parent.status = ScheduleStatus.CANCELLED
            parent.updated_by = request.user
            parent.save()

        return Response(status=status.HTTP_204_NO_CONTENT)


class StatsView(APIView):
    """GET /api/stats/monthly/ — per-month SMS/MMS counts for the last 12 months."""
    permission_classes = [IsAuthenticated, IsOrgMember]

    ADELAIDE_TZ = zoneinfo.ZoneInfo('Australia/Adelaide')

    def get(self, request):
        org = getattr(request, 'org', None)
        if not org:
            return Response({'detail': 'Organisation required.'}, status=status.HTTP_400_BAD_REQUEST)

        # 12 months ago, first day of that month
        now = datetime.now(self.ADELAIDE_TZ)
        start = now.replace(month=now.month, day=1) - timezone.timedelta(days=330)
        start = start.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        # Aggregate schedules by month, status, and format
        rows = (
            Schedule.objects.filter(
                organisation=org,
                scheduled_time__gte=start,
            )
            .annotate(month=TruncMonth('scheduled_time', tzinfo=self.ADELAIDE_TZ))
            .values('month', 'status', 'format')
            .annotate(count=Count('id'), parts=Sum('message_parts'))
            .order_by('month')
        )

        # Build per-month buckets
        buckets = defaultdict(lambda: {
            'sms_sent': 0, 'sms_message_parts': 0,
            'mms_sent': 0, 'pending': 0, 'errored': 0,
        })
        for row in rows:
            b = buckets[row['month']]
            count = row['count']
            if row['status'] == ScheduleStatus.SENT:
                if row['format'] == MessageFormat.MMS:
                    b['mms_sent'] += count
                else:
                    b['sms_sent'] += count
                    b['sms_message_parts'] += row['parts'] or 0
            elif row['status'] == ScheduleStatus.PENDING:
                b['pending'] += count
            elif row['status'] == ScheduleStatus.FAILED:
                b['errored'] += count

        # Format month labels and sort (current month first, then reverse chronological)
        monthly_stats = []
        for month_dt, counts in sorted(buckets.items(), reverse=True):
            label = month_dt.astimezone(self.ADELAIDE_TZ).strftime('%B %Y')
            monthly_stats.append({'month': label, **counts})

        # Fetch SMS/MMS limits from Config
        limits = Config.objects.filter(
            organisation=org, name__in=['sms_limit', 'mms_limit'],
        ).values_list('name', 'value')
        limit_map = {name: int(value) for name, value in limits}

        return Response({
            'monthly_stats': monthly_stats,
            'sms_limit': limit_map.get('sms_limit', 0),
            'mms_limit': limit_map.get('mms_limit', 0),
        })


class ConfigViewSet(TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Config.objects.all()
    serializer_class = ConfigSerializer
    permission_classes = [IsAuthenticated, IsOrgMember]
    http_method_names = ['get', 'post', 'put', 'patch', 'head', 'options']


class SMSViewSet(viewsets.ViewSet):
    """SMS/MMS endpoints with pluggable provider abstraction."""
    permission_classes = [IsAuthenticated, IsOrgMember]

    def _get_org(self, request):
        """Get organisation from request or raise ValidationError."""
        org = getattr(request, 'org', None)
        if not org:
            raise ValidationError('Organisation required.')
        return org

    def _resolve_contact(self, contact_id, org):
        """Resolve contact by ID or raise NotFound. Returns None if contact_id is None."""
        if not contact_id:
            return None
        contact = Contact.objects.filter(id=contact_id, organisation=org).first()
        if not contact:
            raise NotFound('Contact not found.')
        return contact

    @action(detail=False, methods=['post'], url_path='send', throttle_classes=[SMSThrottle])
    def send_sms(self, request):
        """POST /api/sms/send/ — send SMS to single recipient."""
        org = self._get_org(request)

        serializer = SendSMSSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Check if we have SMS capacity
        limit_info = get_sms_limit_info(org)

        if limit_info['limit'] is not None:
            if limit_info['remaining'] < 1:
                raise ValidationError(
                    f'Monthly SMS limit reached. No remaining capacity '
                    f'({limit_info["current"]}/{limit_info["limit"]} used this month).'
                )

        # Resolve contact if provided
        contact = self._resolve_contact(data.get('contact_id'), org)

        # Send via provider
        provider = get_sms_provider()
        result = provider.send_sms(to=data['recipient'], message=data['message'])

        # Create Schedule record
        Schedule.objects.create(
            organisation=org,
            contact=contact,
            phone=data['recipient'],
            text=data['message'],
            scheduled_time=timezone.now(),
            sent_time=timezone.now() if result['success'] else None,
            status=ScheduleStatus.SENT if result['success'] else ScheduleStatus.FAILED,
            message_parts=result['message_parts'],
            format=MessageFormat.SMS,
            error=result.get('error'),
            created_by=request.user,
            updated_by=request.user,
        )

        if result['success']:
            return Response({'success': True, 'message': f'SMS sent successfully to {data["recipient"]}'})
        else:
            return Response({'success': False, 'message': 'Failed to send SMS', 'error': result.get('error')}, status=500)

    @action(detail=False, methods=['post'], url_path='send-to-group', throttle_classes=[SMSThrottle])
    def send_to_group(self, request):
        """POST /api/sms/send-to-group/ — send SMS to group members."""
        org = self._get_org(request)

        serializer = SendGroupSMSSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Resolve group
        group = ContactGroup.objects.filter(id=data['group_id'], organisation=org).first()
        if not group:
            raise NotFound('Group not found.')

        # Get eligible members (active and not opted out)
        members = Contact.objects.filter(contactgroupmember__group=group, is_active=True, opt_out=False)
        if not members.exists():
            raise ValidationError('No eligible contacts found in group.')

        # Check if we have enough SMS capacity for bulk send
        member_count = members.count()
        limit_info = get_sms_limit_info(org)

        if limit_info['limit'] is not None:
            if limit_info['remaining'] < member_count:
                raise ValidationError(
                    f'Monthly SMS limit would be exceeded. Need {member_count} messages but only {limit_info["remaining"]} remaining '
                    f'({limit_info["current"]}/{limit_info["limit"]} used this month).'
                )

        # Prepare bulk SMS
        recipients = [{'to': m.phone, 'message': data['message']} for m in members]

        # Send via provider (calculates message_parts for each recipient)
        provider = get_sms_provider()
        bulk_result = provider.send_bulk_sms(recipients)

        # Get message_parts from first result (all same message, so same parts)
        message_parts = bulk_result['results'][0]['message_parts'] if bulk_result['results'] else 1

        # Create parent schedule (group schedule)
        parent_name = data['message'][:20] + ('...' if len(data['message']) > 20 else '')
        parent = Schedule.objects.create(
            organisation=org,
            name=parent_name,
            text=data['message'],
            message_parts=message_parts,
            group=group,
            scheduled_time=timezone.now(),
            status=ScheduleStatus.PROCESSING,
            created_by=request.user,
            updated_by=request.user,
        )

        # Create individual schedule records
        successful = 0
        failed = 0

        for i, member in enumerate(members):
            result = bulk_result['results'][i] if i < len(bulk_result['results']) else {'success': False, 'message_parts': message_parts}
            is_success = result.get('success', False)

            Schedule.objects.create(
                organisation=org,
                contact=member,
                phone=member.phone,
                text=data['message'],
                group=group,
                parent=parent,
                scheduled_time=timezone.now(),
                sent_time=timezone.now() if is_success else None,
                status=ScheduleStatus.SENT if is_success else ScheduleStatus.FAILED,
                message_parts=result.get('message_parts', message_parts),
                format=MessageFormat.SMS,
                error=result.get('error'),
                created_by=request.user,
                updated_by=request.user,
            )

            if is_success:
                successful += 1
            else:
                failed += 1

        # Update parent schedule
        if failed == 0:
            parent.status = ScheduleStatus.SENT
        elif successful == 0:
            parent.status = ScheduleStatus.FAILED
            parent.error = f'All {failed} messages failed'
        else:
            parent.status = ScheduleStatus.SENT
            parent.error = f'{failed} out of {successful + failed} messages failed'
        parent.save()

        total = successful + failed
        http_status = 200 if failed == 0 else (207 if successful > 0 else 500)

        return Response({
            'success': failed == 0,
            'message': f'SMS sent to group: {successful} successful, {failed} failed',
            'results': {
                'successful': successful,
                'failed': failed,
                'total': total,
            },
            'group_name': group.name,
            'group_schedule_id': parent.id,
        }, status=http_status)

    @action(detail=False, methods=['post'], url_path='send-mms', throttle_classes=[SMSThrottle])
    def send_mms(self, request):
        """POST /api/sms/send-mms/ — send MMS with media."""
        org = self._get_org(request)

        serializer = SendMMSSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Check if we have MMS capacity
        limit_info = get_mms_limit_info(org)

        if limit_info['limit'] is not None:
            if limit_info['remaining'] < 1:
                raise ValidationError(
                    f'Monthly MMS limit reached. No remaining capacity '
                    f'({limit_info["current"]}/{limit_info["limit"]} used this month).'
                )

        # Resolve contact if provided
        contact = self._resolve_contact(data.get('contact_id'), org)

        # Send via provider
        provider = get_sms_provider()
        result = provider.send_mms(
            to=data['recipient'],
            message=data['message'],
            media_url=data['media_url'],
            subject=data.get('subject'),
        )

        # Create Schedule record
        Schedule.objects.create(
            organisation=org,
            contact=contact,
            phone=data['recipient'],
            text=data['message'],
            scheduled_time=timezone.now(),
            sent_time=timezone.now() if result['success'] else None,
            status=ScheduleStatus.SENT if result['success'] else ScheduleStatus.FAILED,
            message_parts=result['message_parts'],
            format=MessageFormat.MMS,
            media_url=data['media_url'],
            subject=data.get('subject'),
            error=result.get('error'),
            created_by=request.user,
            updated_by=request.user,
        )

        if result['success']:
            return Response({
                'success': True,
                'message': f'MMS sent successfully to {data["recipient"]}',
            })
        else:
            return Response({
                'success': False,
                'message': 'Failed to send MMS',
                'error': result.get('error'),
            }, status=500)

    @action(detail=False, methods=['post'], url_path='upload-file')
    def upload_file(self, request):
        """POST /api/sms/upload-file/ — upload image for MMS."""
        uploaded = request.FILES.get('file')
        if not uploaded:
            raise ValidationError('No file provided.')

        # Get storage provider and upload
        # Validation happens in provider._validate_file()
        provider = get_storage_provider()
        result = provider.upload_file(
            file_obj=uploaded,
            filename=uploaded.name,
            content_type=uploaded.content_type
        )

        if result['success']:
            return Response({
                'success': True,
                'url': result['url'],
                'file_id': result['file_id'],
                'size': result['size'],
            })
        else:
            return Response({
                'success': False,
                'error': result['error']
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
