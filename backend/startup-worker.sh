#!/bin/bash
set -e
export DB_POOL_MIN_SIZE=${DB_POOL_MIN_SIZE:-1}
export DB_POOL_MAX_SIZE=${DB_POOL_MAX_SIZE:-4}

# Minimal HTTP server so Azure App Service health probes get a response.
python -c "
from http.server import HTTPServer, BaseHTTPRequestHandler
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ok')
    def log_message(self, *a): pass
HTTPServer(('0.0.0.0', ${PORT:-8000}), H).serve_forever()
" &

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

trap 'echo "$(date -u +%Y-%m-%dT%H:%M:%S) worker received SIGTERM, shutting down..."' TERM

python -m celery -A app.celery worker --loglevel=info -Q default,messages --concurrency=2 &
WORKER_PID=$!
wait $WORKER_PID
