from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """AbstractUser inherits some fields that are not required when using Clerk.
    
    However using AbstractUser is simple and allows for django admin panel, etc
    """
    clerk_id = models.CharField(max_length=255, unique=True, db_index=True)
    username = models.CharField(max_length=150, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    USERNAME_FIELD = 'clerk_id'
    REQUIRED_FIELDS = []

    class Meta:
        db_table = 'users'

    def __str__(self):
        return self.clerk_id


class Organisation(models.Model):
    clerk_org_id = models.CharField(max_length=255, unique=True, db_index=True)
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'organisations'

    def __str__(self):
        return self.name


class AuditMixin(models.Model):
    """Automatically add these fields for audit traceability"""
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='%(class)s_created')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='%(class)s_updated')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class OrganisationMembership(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE)
    role = models.CharField(max_length=50, default='member')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'organisation_memberships'
        unique_together = ('user', 'organisation')

    def __str__(self):
        return f'{self.user.clerk_id} - {self.organisation.name} ({self.role})'


class TenantModel(models.Model):
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE)

    class Meta:
        abstract = True


class Contact(TenantModel, AuditMixin):
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='contacts')
    first_name = models.CharField(max_length=255)
    last_name = models.CharField(max_length=255)
    phone = models.CharField(max_length=50)
    email = models.EmailField(blank=True, null=True)
    company = models.CharField(max_length=255, blank=True, null=True)
    is_active = models.BooleanField(default=True)
    opt_out = models.BooleanField(default=False)

    class Meta:
        db_table = 'contacts'
        unique_together = ('organisation', 'phone')

    def __str__(self):
        return f'{self.first_name} {self.last_name}'


class ContactGroup(TenantModel, AuditMixin):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'contact_groups'

    def __str__(self):
        return self.name


class ContactGroupMember(models.Model):
    contact = models.ForeignKey(Contact, on_delete=models.CASCADE)
    group = models.ForeignKey(ContactGroup, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'contact_group_members'
        unique_together = ('contact', 'group')

    def __str__(self):
        return f'{self.contact} in {self.group}'


class Template(TenantModel, AuditMixin):
    name = models.CharField(max_length=255)
    text = models.TextField()
    is_active = models.BooleanField(default=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = 'templates'

    def __str__(self):
        return f'{self.name} (v{self.version})'


class ScheduleStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    PROCESSING = 'processing', 'Processing'
    SENT = 'sent', 'Sent'
    FAILED = 'failed', 'Failed'
    CANCELLED = 'cancelled', 'Cancelled'


class MessageFormat(models.TextChoices):
    SMS = 'sms', 'SMS'
    MMS = 'mms', 'MMS'


class Schedule(TenantModel, AuditMixin):
    name = models.CharField(max_length=255, blank=True, null=True)
    template = models.ForeignKey(Template, on_delete=models.SET_NULL, null=True, blank=True)
    text = models.TextField(blank=True, null=True)
    message_parts = models.PositiveIntegerField(default=1)
    contact = models.ForeignKey(Contact, on_delete=models.SET_NULL, null=True, blank=True)
    phone = models.CharField(max_length=50, blank=True, null=True)
    group = models.ForeignKey(ContactGroup, on_delete=models.SET_NULL, null=True, blank=True)
    parent = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True)
    scheduled_time = models.DateTimeField()
    sent_time = models.DateTimeField(blank=True, null=True)
    status = models.CharField(max_length=20, choices=ScheduleStatus.choices, default=ScheduleStatus.PENDING)
    error = models.TextField(blank=True, null=True)
    format = models.CharField(max_length=10, choices=MessageFormat.choices, blank=True, null=True)
    media_url = models.URLField(blank=True, null=True)
    subject = models.CharField(max_length=64, blank=True, null=True)

    class Meta:
        db_table = 'schedules'
        indexes = [
            models.Index(fields=['scheduled_time']),
            models.Index(fields=['contact']),
            models.Index(fields=['scheduled_time', 'status']),
            models.Index(fields=['contact', 'status', '-scheduled_time'], name='schedule_contact_status_desc',),
        ]

    def __str__(self):
        return f'Schedule {self.pk} - {self.status}'


class Config(TenantModel):
    name = models.CharField(max_length=255)
    value = models.TextField()

    class Meta:
        db_table = 'configs'
        unique_together = ('organisation', 'name')
        indexes = [models.Index(fields=['name']),]

    def __str__(self):
        return f'{self.name}: {self.value[:50]}'
