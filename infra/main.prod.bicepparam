using './main.bicep'

param ENVIRONMENT_NAME = 'prod'
param ACR_NAME = '1reachcr'

// Scaling (prod: always-on, can scale up)
param API_MIN_REPLICAS = 1
param API_MAX_REPLICAS = 3
param WORKER_MIN_REPLICAS = 1
param WORKER_MAX_REPLICAS = 3

// Resources (prod: more headroom)
param API_CPU = '0.5'
param API_MEMORY = '1Gi'
param WORKER_CPU = '0.5'
param WORKER_MEMORY = '1Gi'
param BEAT_CPU = '0.25'
param BEAT_MEMORY = '0.5Gi'

// All app config (secrets + non-secrets) comes from infra/.env.prod via deploy.sh
