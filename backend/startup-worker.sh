#!/bin/bash
set -e
export DB_POOL_MIN_SIZE=${DB_POOL_MIN_SIZE:-1}
export DB_POOL_MAX_SIZE=${DB_POOL_MAX_SIZE:-4}

# Wait for database before starting worker.
# Redis reconnection is handled by Celery (CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP).
echo "Waiting for database..."
for i in $(seq 1 30); do
  python -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'app.settings')
django.setup()
from django.db import connection
connection.ensure_connection()
" 2>/dev/null && echo "Database is ready." && break
  echo "Database not ready (attempt $i/30), retrying in 5s..."
  sleep 5
done

celery -A app.celery worker --loglevel=info -Q default,messages --concurrency=2
