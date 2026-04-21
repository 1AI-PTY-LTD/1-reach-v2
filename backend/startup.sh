#!/bin/bash
set -e

export PYTHONDONTWRITEBYTECODE=1
source /home/site/wwwroot/antenv/bin/activate

# Wait for database to be reachable before running migrations
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

# Migrations are applied by the deploy workflow.
# This is a non-blocking safety net — never delay app startup.
timeout 30 python manage.py migrate --check 2>/dev/null || {
  echo "WARNING: Unapplied migrations detected. Attempting migrate (30s timeout)..."
  timeout 30 python manage.py showmigrations --plan 2>/dev/null | grep "\[ \]" || true
  timeout 30 python manage.py migrate --no-input 2>&1 || echo "WARNING: Migration failed or timed out — continuing startup. Check CI migrate job."
}
gunicorn app.asgi:application \
  -k app.worker.Worker \
  --bind 0.0.0.0:8000 \
  --workers 2 \
  --timeout 120 \
  --access-logfile -
