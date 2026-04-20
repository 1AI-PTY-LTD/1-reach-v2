from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView, SpectacularRedocView
from rest_framework.routers import DefaultRouter

from app.health import HealthCheckView, SmokeCheckView
from app.utils.stripe import StripeWebhookView
from app.views import *


router = DefaultRouter()
router.register(r'contacts', ContactViewSet)
router.register(r'groups', ContactGroupViewSet)
router.register(r'templates', TemplateViewSet)
router.register(r'schedules', ScheduleViewSet)
router.register(r'group-schedules', GroupScheduleViewSet, basename='group-schedule')
router.register(r'configs', ConfigViewSet)
router.register(r'users', UserViewSet, basename='user')
router.register(r'sms', SMSViewSet, basename='sms')
router.register(r'billing', BillingViewSet, basename='billing')

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/health/', HealthCheckView.as_view(), name='health'),
    path('api/health/smoke/', SmokeCheckView.as_view(), name='health-smoke'),
    path('api/webhooks/clerk/', ClerkWebhookView.as_view(), name='clerk-webhook'),
    path('api/webhooks/sms-delivery/', SMSDeliveryWebhookView.as_view(), name='sms-delivery-webhook'),
    path('api/webhooks/stripe/', StripeWebhookView.as_view(), name='stripe-webhook'),
    path('api/stats/monthly/', StatsView.as_view(), name='stats-monthly'),
    path('api/', include(router.urls)),
]

if settings.DEBUG:
    urlpatterns += [
        path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
        path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
        path('api/redoc/', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),
    ]
