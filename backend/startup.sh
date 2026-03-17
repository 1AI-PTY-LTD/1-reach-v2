#!/bin/bash
set -e
cd /home/site/wwwroot
python manage.py migrate --no-input
python manage.py collectstatic --no-input
gunicorn app.asgi:application \
  -k uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --workers 2 \
  --timeout 120 \
  --access-logfile -
