#!/bin/bash
set -e
export DB_POOL_MIN_SIZE=${DB_POOL_MIN_SIZE:-1}
export DB_POOL_MAX_SIZE=${DB_POOL_MAX_SIZE:-4}
celery -A app.celery worker --loglevel=info -Q default,messages --concurrency=2
