#!/bin/bash
set -e
celery -A app.celery worker --loglevel=info -Q messages --concurrency=2
