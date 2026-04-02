#!/bin/bash
set -e
export DB_POOL_MIN_SIZE=${DB_POOL_MIN_SIZE:-1}
export DB_POOL_MAX_SIZE=${DB_POOL_MAX_SIZE:-2}

# Wait for database and Redis before starting beat
echo "Waiting for dependencies..."
for i in $(seq 1 30); do
  python -c "
import django, os, redis
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'app.settings')
django.setup()
from django.db import connection
from django.conf import settings
connection.ensure_connection()
r = redis.from_url(settings.CELERY_BROKER_URL)
r.ping()
" 2>/dev/null && echo "Dependencies ready." && break
  echo "Dependencies not ready (attempt $i/30), retrying in 5s..."
  sleep 5
done

celery -A app.celery beat \
  --loglevel=info \
  --scheduler django_celery_beat.schedulers:DatabaseScheduler
