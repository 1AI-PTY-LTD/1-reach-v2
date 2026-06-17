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

## Redis (Celery broker) — recommended manual configuration

The Celery queue (queued sends, in-flight retries) lives in Redis memory.
Azure Cache for Redis is provisioned outside this repo; two settings matter:

- **Eviction policy**: Azure's default `volatile-lru` silently deletes keys —
  including queued tasks — under memory pressure. `noeviction` turns that
  into loud write errors instead. One-off manual command (run when convenient;
  it only changes the existing cache's config):

  ```bash
  az redis update --name <cache-name> --resource-group <rg> \
    --set "redisConfiguration.maxmemory-policy"="noeviction"
  ```

- **Loss tolerance**: even if queued tasks are lost (restart/failover), the
  database is the source of truth — `dispatch_due_messages` re-enqueues
  schedules stuck in QUEUED after ~5 minutes, so losses self-heal. Premium-tier
  persistence is therefore not required.

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
- **DRF throttling is per-process** (default `LocMemCache`, no shared cache).
  Limits are therefore approximate — counted per gunicorn worker/replica and
  reset on restart. This is deliberate: throttling is defense-in-depth, while
  the real abuse controls are the billing gate (credit balance + monthly cap)
  and tenant scoping; webhooks and health checks are throttle-exempt. If
  accurate global throttling is ever needed, add a `RedisCache` with a
  redis-py-safe URL (`ssl_cert_reqs=required`, not the kombu-style
  `CERT_REQUIRED`) on a **dedicated Redis DB index** (not the broker's DB, so
  `cache.clear()` can't `FLUSHDB` the Celery queue).

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

## Testing — CI gates & non-gating pilots

The gating suites (backend pytest, frontend vitest+coverage, Playwright E2E) and
the CI gate table are documented in [README.md](../README.md#testing). This
section covers the **ops-side** notes: how E2E exercises the real stack and how
to run the pilots that live outside CI.

### E2E runs against the real worker + real provider

CI's E2E job starts `celery_worker` + `celery_beat` and **gates on
`/api/health/worker/`** before any spec runs — a worker that is down or running
the wrong process (the gunicorn-instead-of-celery incident) fails the job here
instead of letting the real-pipeline specs time out ambiguously. The deploy
workflow runs the same heartbeat assertion post-deploy (see *Monitoring*).

Real-pipeline specs send to the **free Welcorp number `+61447119283`**
(`E2E_WELCORP_PASS_PHONE`, default), so the real sends cost nothing. Running E2E
locally needs `CLERK_*`, `STRIPE_SECRET_KEY`, and `WELCORP_USERNAME` /
`WELCORP_PASSWORD` / `WELCORP_CALLBACK_SECRET` passed into the backend container,
plus `TEST=1` (+ `DEBUG=1`, enforced by the `app.E001` deploy check).

### Mutation testing pilot

Not wired into CI (slow, non-deterministic). Run ad hoc to find assertions that
pass against deliberately broken code — focus on the two correctness-critical
modules:

```bash
# Example with cosmic-ray (or mutmut) — target the high-value modules only:
docker compose run --rm -e CONTAINER_ROLE= backend uv run \
  python -m pytest tests/utils/test_billing.py tests/api/test_sms_endpoint.py -q
# then run the mutation tool against app/utils/billing.py and app/utils/sms.py
```

Surviving mutants point at weak assertions (e.g. a refund test that checks
`.exists()` rather than `refund.amount == charge`). Tighten the test, re-run.

### Load / perf pilot

```bash
docker compose run --rm -e CONTAINER_ROLE= backend uv run \
  python -m pytest -m load tests/load/ -q
```

Excluded from the default suite via the `load` marker. Asserts a generous
wall-clock bound on bulk dispatch (1500 schedules drained in 500-per-tick
batches) — flags a gross regression, not micro-perf.

### Visual-regression pilot

```bash
# Generate/refresh baselines (review before committing):
VISUAL=1 docker compose exec frontend npx playwright test visual.spec.ts --update-snapshots
# Compare against baselines:
VISUAL=1 docker compose exec frontend npx playwright test visual.spec.ts
```

Skipped unless `VISUAL=1`. Pilots the unauthenticated landing page (no Clerk
needed). Promote to gating once baselines are stable across the CI renderer.
