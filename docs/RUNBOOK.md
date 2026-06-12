# 1Reach Operations Runbook

## Deploying

Deploys are CI-driven: push to `development` deploys dev, push to `main`
deploys prod (`.github/workflows/deploy-dev.yml` / `deploy-prod.yml`).

### Production deploy flow (zero downtime)

1. **Migrations** run from the GitHub runner before the new image ships. When
   migrations are pending and the DB tier supports replicas, they are first
   rehearsed on a temporary replica and a backup is taken. Migrations must be
   backward-compatible with the previous app version — the old revision keeps
   serving traffic until the new one passes its smoke test.
2. **Image build** — a single immutable SHA tag is pushed to ACR.
3. **Bicep deploy** — the API container app runs in multiple-revision mode, so
   the new revision starts with **0% traffic** while the old revision keeps
   serving.
4. **Smoke test + traffic shift** (`verify-health` job) — the new revision is
   polled on its revision-specific FQDN until `/api/health/smoke/` returns 200
   with the deployed SHA. On success, traffic shifts 100% to the new revision
   and old revisions are deactivated. On failure, the bad revision is
   deactivated and **traffic never leaves the old, healthy revision** — there
   is nothing to roll back.
5. Worker and beat use single-revision mode (no ingress); their safety is
   Celery `acks_late` + the dispatch recovery sweeps.

### Manual rollback (rarely needed)

Traffic only moves after the smoke test passes, so a "bad deploy" normally
never receives traffic. To roll back something that passed smoke but
misbehaves later: re-run the deploy workflow from the last good commit
(`workflow_dispatch` on that SHA), or reactivate the previous revision and
shift traffic back:

```bash
az containerapp revision list -n onereach-api-prod -g <rg> -o table
az containerapp revision activate -n onereach-api-prod -g <rg> --revision <old>
az containerapp ingress traffic set -n onereach-api-prod -g <rg> --revision-weight <old>=100
```

Note: the database is shared across revisions — rolling back after a deploy
that ran migrations requires the migrations to be backward-compatible (they
must be; see step 1).

## Production approval gate (one-off GitHub setup)

Pushing to `main` should pause for explicit approval before touching prod:

1. GitHub repo → Settings → Environments → `prod`.
2. Enable **Required reviewers** and add yourself.
3. Leave **Prevent self-review** unchecked (solo-dev: you approve your own
   deployments).

Every prod deploy then waits at the environment gate until approved in the
run's UI.

## Azure authentication (OIDC)

Workflows authenticate with OIDC workload-identity federation — no stored
service-principal secret. One-off setup:

1. Entra ID → App registrations → the deploy service principal →
   Certificates & secrets → **Federated credentials** → add credentials for
   `repo:<owner>/<repo>:environment:prod` and `:environment:dev`.
2. Set repo variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
   `AZURE_SUBSCRIPTION_ID`.
3. Delete the `AZURE_CREDENTIALS` secret.

## Known constraints / accepted risks

- **Shared PostgreSQL server**: the production Postgres flexible server is
  used by other parts of the business, so its firewall cannot be restricted
  to the VNet. Deploys temporarily whitelist the GitHub runner's public IP
  (fetched from api.ipify.org) for migrations and remove it afterwards; the
  cleanup step fails the job loudly if removal does not go through — if that
  happens, **delete the `github-runner` firewall rule manually**. Revisit
  with a private endpoint / in-VNet migration job when the constraint lifts.
- **Celery beat is a singleton** (min=max=1 replicas). If its pod is
  restarting, scheduled dispatch pauses for a couple of minutes; messages are
  recovered by the next `dispatch_due_messages` tick.
- **TEST mode**: `TEST=1` disables webhook signature verification and is
  refused at boot unless `DEBUG=1`. Never set either in prod.

## Monitoring

- Sentry receives Django and Celery errors (`SENTRY_DSN`); releases are
  tagged with the deploy SHA by the deploy workflow. Configure Sentry alert
  rules for: error-rate spikes, `celery` task failures, and absence of the
  `dispatch_due_messages` cron (Sentry Cron monitor) to catch a dead beat.
- Health endpoints: `/api/health/` (DB + Redis connectivity, used by ACA
  probes) and `/api/health/smoke/` (DB write + Redis write + deploy SHA, used
  by the deploy gate).

## Webhook endpoints to register per environment

| Provider | URL | Secret env var |
|---|---|---|
| Clerk (Svix) | `https://<api-host>/api/webhooks/clerk/` | `CLERK_WEBHOOK_SIGNING_SECRET` |
| Stripe | `https://<api-host>/api/webhooks/stripe/` | `STRIPE_WEBHOOK_SECRET` |
| Welcorp delivery callbacks | sent per-job automatically (requires `BASE_URL` + `WELCORP_CALLBACK_SECRET`) | `WELCORP_CALLBACK_SECRET` |
