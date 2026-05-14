#!/bin/bash
# Deploy and manage 1Reach infrastructure via Bicep.
#
# Usage:
#   ./infra/deploy.sh deploy dev      — provision/update dev infrastructure
#   ./infra/deploy.sh deploy prod     — provision/update prod infrastructure
#   ./infra/deploy.sh preview dev     — preview dev changes without applying
#   ./infra/deploy.sh preview prod    — preview prod changes without applying
#   ./infra/deploy.sh stop dev        — scale all containers to zero (no cost)
#   ./infra/deploy.sh start dev       — restore containers to .env scaling config
#
# All config (infrastructure + secrets + app vars) lives in infra/.env.<env>.
# One file per environment. deploy.sh passes everything to Bicep as parameters.

set -e

ACTION="${1:?Usage: deploy.sh <deploy|preview|stop|start> <dev|prod>}"
ENV="${2:?Usage: deploy.sh <deploy|preview|stop|start> <dev|prod>}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.${ENV}"
TEMPLATE_FILE="${SCRIPT_DIR}/main.bicep"

[ -f "$ENV_FILE" ] || { echo "Error: $ENV_FILE not found. Copy from .env.example and fill in values."; exit 1; }

# Read config from .env file
RESOURCE_GROUP=""
ENVIRONMENT_NAME=""
API_MIN_REPLICAS=""
API_MAX_REPLICAS=""
WORKER_MIN_REPLICAS=""
WORKER_MAX_REPLICAS=""
PARAMS=""
while IFS='=' read -r key value; do
  [[ "$key" =~ ^[[:space:]]*#.*$ || -z "$key" ]] && continue
  key=$(echo "$key" | xargs)
  value=$(echo "$value" | xargs)
  case "$key" in
    RESOURCE_GROUP)       RESOURCE_GROUP="$value" ;;
    ENVIRONMENT_NAME)     ENVIRONMENT_NAME="$value"; PARAMS="$PARAMS $key=$value" ;;
    API_MIN_REPLICAS)     API_MIN_REPLICAS="$value"; PARAMS="$PARAMS $key=$value" ;;
    API_MAX_REPLICAS)     API_MAX_REPLICAS="$value"; PARAMS="$PARAMS $key=$value" ;;
    WORKER_MIN_REPLICAS)  WORKER_MIN_REPLICAS="$value"; PARAMS="$PARAMS $key=$value" ;;
    WORKER_MAX_REPLICAS)  WORKER_MAX_REPLICAS="$value"; PARAMS="$PARAMS $key=$value" ;;
    *)                    PARAMS="$PARAMS $key=$value" ;;
  esac
done < "$ENV_FILE"

[ -n "$RESOURCE_GROUP" ] || { echo "Error: RESOURCE_GROUP not set in $ENV_FILE"; exit 1; }
[ -n "$ENVIRONMENT_NAME" ] || { echo "Error: ENVIRONMENT_NAME not set in $ENV_FILE"; exit 1; }

API_APP="1reach-api-${ENVIRONMENT_NAME}"
WORKER_APP="1reach-worker-${ENVIRONMENT_NAME}"
BEAT_APP="1reach-beat-${ENVIRONMENT_NAME}"

echo "Environment: $ENV"
echo "Resource group: $RESOURCE_GROUP"
echo "Action: $ACTION"
echo ""

case "$ACTION" in
  preview)
    echo "Running what-if preview (no changes will be applied)..."
    az deployment group create \
      --resource-group "$RESOURCE_GROUP" \
      --template-file "$TEMPLATE_FILE" \
      --parameters $PARAMS \
      --what-if
    ;;
  deploy)
    az deployment group create \
      --resource-group "$RESOURCE_GROUP" \
      --template-file "$TEMPLATE_FILE" \
      --parameters $PARAMS
    ;;
  stop)
    echo "Scaling all containers to zero..."
    az containerapp update --name "$API_APP" --resource-group "$RESOURCE_GROUP" --min-replicas 0 --max-replicas 0
    az containerapp update --name "$WORKER_APP" --resource-group "$RESOURCE_GROUP" --min-replicas 0 --max-replicas 0
    az containerapp update --name "$BEAT_APP" --resource-group "$RESOURCE_GROUP" --min-replicas 0 --max-replicas 0
    echo "All containers stopped."
    ;;
  start)
    echo "Restoring containers to .env scaling config..."
    az containerapp update --name "$API_APP" --resource-group "$RESOURCE_GROUP" --min-replicas "$API_MIN_REPLICAS" --max-replicas "$API_MAX_REPLICAS"
    az containerapp update --name "$WORKER_APP" --resource-group "$RESOURCE_GROUP" --min-replicas "$WORKER_MIN_REPLICAS" --max-replicas "$WORKER_MAX_REPLICAS"
    az containerapp update --name "$BEAT_APP" --resource-group "$RESOURCE_GROUP" --min-replicas 1 --max-replicas 1
    echo "All containers started."
    ;;
  *)
    echo "Error: Unknown action '$ACTION'. Use 'deploy', 'preview', 'stop', or 'start'."
    exit 1
    ;;
esac
