#!/bin/bash
set -e

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

# Migrations are applied by the deploy workflow (replica-tested, then production).
# This is a safety net in case the workflow was bypassed or a manual deploy was done.
python manage.py migrate --check 2>/dev/null || {
  echo "WARNING: Unapplied migrations detected. Running migrate..."
  python manage.py showmigrations --plan | grep "\[ \]" || true
  python manage.py migrate --no-input || { echo "Migration failed — aborting startup"; exit 1; }
}
# collectstatic runs during Oryx build; no need to repeat at startup
# python manage.py collectstatic --no-input
python -m gunicorn app.asgi:application \
  -k app.worker.Worker \
  --bind 0.0.0.0:8000 \
  --workers 2 \
  --timeout 120 \
  --access-logfile -
