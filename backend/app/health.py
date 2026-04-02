import logging
import ssl

import redis
from django.conf import settings
from django.db import connection
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)


class HealthCheckView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        checks = {}

        try:
            connection.ensure_connection()
            checks['db'] = 'ok'
        except Exception as e:
            checks['db'] = str(e)

        try:
            url = settings.CELERY_BROKER_URL
            kwargs = {}
            if url.startswith('rediss://'):
                # Strip ssl_cert_reqs from URL — redis-py rejects the string
                # "CERT_NONE" from query params, so pass the constant as a kwarg.
                url = url.split('?')[0] if 'ssl_cert_reqs' in url else url
                kwargs['ssl_cert_reqs'] = ssl.CERT_NONE
            r = redis.from_url(url, **kwargs)
            r.ping()
            checks['redis'] = 'ok'
        except Exception as e:
            logger.warning('Redis health check failed: %s', e, exc_info=True)
            checks['redis'] = str(e)

        all_ok = all(v == 'ok' for v in checks.values())
        status = 200 if all_ok else 503
        return Response({'status': 'ok' if all_ok else 'degraded', 'checks': checks}, status=status)
