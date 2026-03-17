#!/bin/bash
set -e
cd /home/site/wwwroot
celery -A app.celery beat \
  --loglevel=info \
  --scheduler django_celery_beat.schedulers:DatabaseScheduler
