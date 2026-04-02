#!/bin/bash
set -e
export DB_POOL_MIN_SIZE=${DB_POOL_MIN_SIZE:-1}
export DB_POOL_MAX_SIZE=${DB_POOL_MAX_SIZE:-4}

# Wait for database and Redis before starting worker
echo "Waiting for dependencies..."
for i in $(seq 1 30); do
  python -c "
import django, os, ssl, redis
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'app.settings')
django.setup()
from django.db import connection
from django.conf import settings
connection.ensure_connection()
url = settings.CELERY_BROKER_URL
kwargs = {}
if url.startswith('rediss://'):
    url = url.split('?')[0] if 'ssl_cert_reqs' in url else url
    kwargs['ssl_cert_reqs'] = ssl.CERT_NONE
r = redis.from_url(url, **kwargs)
r.ping()
" 2>/dev/null && echo "Dependencies ready." && break
  echo "Dependencies not ready (attempt $i/30), retrying in 5s..."
  sleep 5
done

celery -A app.celery worker --loglevel=info -Q default,messages --concurrency=2
