from decimal import Decimal

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def backfill_org_credits(apps, schema_editor):
    Organisation = apps.get_model('app', 'Organisation')
    CreditTransaction = apps.get_model('app', 'CreditTransaction')

    free_amount = Decimal(str(getattr(settings, 'FREE_CREDIT_AMOUNT', '10.00')))

    for org in Organisation.objects.filter(is_active=True):
        org.credit_balance = free_amount
        org.save(update_fields=['credit_balance'])

        CreditTransaction.objects.create(
            organisation=org,
            transaction_type='grant',
            amount=free_amount,
            balance_after=free_amount,
            description='Free trial credits (backfilled on migration)',
            format=None,
            schedule=None,
            created_by=None,
        )


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0003_alter_organisationmembership_organisation_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='organisation',
            name='credit_balance',
            field=models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=10),
        ),
        migrations.AddField(
            model_name='organisation',
            name='billing_mode',
            field=models.CharField(
                choices=[('trial', 'Trial'), ('subscribed', 'Subscribed')],
                default='trial',
                max_length=20,
            ),
        ),
        migrations.CreateModel(
            name='CreditTransaction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('transaction_type', models.CharField(
                    choices=[('grant', 'Grant'), ('deduct', 'Deduct'), ('usage', 'Usage'), ('refund', 'Refund')],
                    max_length=20,
                )),
                ('amount', models.DecimalField(decimal_places=2, max_digits=10)),
                ('balance_after', models.DecimalField(decimal_places=2, max_digits=10)),
                ('description', models.CharField(max_length=255)),
                ('format', models.CharField(blank=True, max_length=50, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='credit_transactions',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('organisation', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='credit_transactions',
                    to='app.organisation',
                )),
                ('schedule', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='credit_transactions',
                    to='app.schedule',
                )),
            ],
            options={
                'db_table': 'credit_transactions',
            },
        ),
        migrations.AddIndex(
            model_name='credittransaction',
            index=models.Index(fields=['organisation', '-created_at'], name='credit_tran_organis_idx'),
        ),
        migrations.RunPython(backfill_org_credits, migrations.RunPython.noop),
    ]
