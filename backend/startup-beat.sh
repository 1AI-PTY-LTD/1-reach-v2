#!/bin/bash
set -e
celery -A app.celery beat \
  --loglevel=info \
  --scheduler django_celery_beat.schedulers:DatabaseScheduler
