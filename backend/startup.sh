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

# Log pending migrations before applying
echo "Checking pending migrations..."
python manage.py showmigrations --plan 2>/dev/null | grep "\[ \]" || echo "No pending migrations."

echo "Running migrations..."
if ! python manage.py migrate --no-input; then
  echo "========================================="
  echo "MIGRATION FAILED"
  echo "The database may be in a partially-migrated state."
  echo ""
  echo "Recovery steps:"
  echo "  1. Go to Azure Portal → PostgreSQL Flexible Server → Backups"
  echo "  2. Find the most recent 'pre-deploy-*' backup (created by the deploy workflow)"
  echo "  3. Restore it to a new server:"
  echo "     az postgres flexible-server restore \\"
  echo "       --resource-group <RG> --name <new-server> \\"
  echo "       --source-server <current-server> \\"
  echo "       --backup-name <pre-deploy-YYYYMMDD-HHMMSS>"
  echo "  4. Update POSTGRES_HOST on all App Services to the new server"
  echo "  5. Restart all App Services"
  echo "  6. Fix the migration and redeploy"
  echo "========================================="
  exit 1
fi
python manage.py collectstatic --no-input
gunicorn app.asgi:application \
  -k uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --workers 2 \
  --timeout 120 \
  --access-logfile -
