#!/bin/bash
set -e
cd /home/site/wwwroot
celery -A app.celery worker --loglevel=info -Q messages --concurrency=2
