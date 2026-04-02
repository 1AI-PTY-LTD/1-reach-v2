#!/bin/bash
set -e
export DB_POOL_MIN_SIZE=${DB_POOL_MIN_SIZE:-1}
export DB_POOL_MAX_SIZE=${DB_POOL_MAX_SIZE:-2}
celery -A app.celery beat \
  --loglevel=info \
  --scheduler django_celery_beat.schedulers:DatabaseScheduler
