#!/bin/bash
set -e
celery -A app.celery worker --loglevel=info -Q default,messages --concurrency=2
