# 1Reach

A multi-tenant SMS/MMS messaging platform for managing contacts, groups, templates, and scheduled messages.

---

## Overview

1Reach lets organisations send and schedule SMS/MMS messages to individual contacts or groups. Each organisation is isolated — contacts, templates, schedules, and configs are all scoped per organisation. Admins sign up via Clerk, create an organisation, and invite team members.

**Key capabilities:**
- Contact management with CSV import
- Group messaging with scheduling
- Template library
- SMS/MMS sending — async dispatch via Celery with automatic retry and credit refund on failure
- Scheduled sends — Celery beat dispatches due messages every 60 s
- Org user management — invite, deactivate, grant/revoke admin
- Usage stats dashboard
- Billing system — trial credits on signup, subscribed mode with metered tracking, monthly spending limits, transaction history, credit refunds on failed sends

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Django 6 + Django REST Framework + PostgreSQL 16 |
| Auth | Clerk (JWT + webhooks) |
| Frontend | React 19 + Vite 7 + TanStack Router + TanStack Query |
| Styling | Tailwind CSS 3 + HeadlessUI |
| SMS/Storage | Pluggable provider interface (Mock by default, Azure Blob for storage) |
| Task queue | Celery 5 + Redis 7 (async send pipeline, retry logic, beat scheduler) |
| Monitoring | Sentry + structured JSON logging |
| Testing | pytest (backend), Vitest + Playwright (frontend) |

---

## Getting Started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- A [Clerk](https://clerk.com) account with an application configured

### Environment Setup

Copy and fill in the environment files:

```bash
# Root (Docker Compose postgres + rate limiting)
cp .envexample .env

# Backend (Django settings + Clerk + optional Azure/Sentry)
cp backend/.envexample backend/.env

# Frontend (Clerk publishable key)
cp frontend/.envexample frontend/.env
```

**Root `.env`** — PostgreSQL credentials and rate limiting:

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_DB` | `app` | Database name |
| `POSTGRES_USER` | `app` | Database user |
| `POSTGRES_PASSWORD` | `app` | Database password |
| `THROTTLE_RATE_ANON` | `1000/min` | Anonymous request rate limit |
| `THROTTLE_RATE_USER` | `1000/min` | Authenticated user rate limit |
| `THROTTLE_RATE_SMS` | `100/min` | SMS endpoint rate limit |
| `THROTTLE_RATE_IMPORT` | `10/min` | CSV import rate limit |

**`backend/.env`** — Django + Clerk:

| Variable | Required | Description |
|---|---|---|
| `DJANGO_SECRET_KEY` | Yes | Django secret key |
| `ALLOWED_HOSTS` | No | Comma-separated allowed host headers (default: `localhost,127.0.0.1`) |
| `CORS_ALLOWED_ORIGINS` | No | Comma-separated allowed CORS origins (default: `http://localhost:5173`) |
| `CLERK_AUTHORIZED_PARTIES` | No | Comma-separated frontend URLs that may present Clerk JWTs (default: `http://localhost:5173`) |
| `CLERK_FRONTEND_API` | Yes | Clerk frontend API URL |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key (`sk_...`) |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Yes | Clerk webhook signing secret (`whsec_...`) |
| `DEBUG` | No | Set to `1` for development |
| `STORAGE_PROVIDER_CLASS` | No | Defaults to `MockStorageProvider`; set to `AzureBlobStorageProvider` for real storage |
| `AZURE_BLOB_URL` | If using Azure | Azure Blob Storage SAS URL |
| `AZURE_CONTAINER` | If using Azure | Blob container name (default: `media`) |
| `SENTRY_DSN` | No | Sentry DSN for error tracking |
| `LOG_LEVEL` | No | `INFO` or `DEBUG` (default: `INFO`) |
| `LOG_FORMAT` | No | `json` or `text` (default: `json`) |
| `FREE_CREDIT_AMOUNT` | No | Dollar credits granted to new orgs on signup (default: `10.00`) |
| `SMS_RATE` | No | Cost per SMS message part in dollars (default: `0.05`) |
| `MMS_RATE` | No | Cost per MMS send in dollars (default: `0.20`) |
| `CELERY_BROKER_URL` | No | Redis URL for Celery broker (default: `redis://redis:6379/0`) |
| `CELERY_RESULT_BACKEND` | No | Redis URL for task results (default: `redis://redis:6379/0`) |
| `MESSAGE_MAX_RETRIES` | No | Max retry attempts per message (default: `3`) |
| `MESSAGE_RETRY_BASE_DELAY` | No | Base backoff delay in seconds (default: `60`) |
| `MESSAGE_RETRY_MAX_DELAY` | No | Max backoff delay in seconds (default: `3600`) |
| `MESSAGE_RETRY_JITTER` | No | Jitter fraction for backoff (default: `0.25` = ±25%) |

**`frontend/.env`** — Vite + Clerk:

| Variable | Required | Description |
|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key (`pk_...`) |
| `VITE_API_BASE_URL` | No | Backend URL (default: `http://localhost:8000`) |

### Running Locally

```bash
docker compose up
```

This starts six services:

| Service | URL | Description |
|---|---|---|
| Backend API | http://localhost:8000 | Django REST API |
| Frontend | http://localhost:5173 | React dev server |
| Swagger UI | http://localhost:8000/api/docs/ | Interactive API docs |
| ReDoc | http://localhost:8000/api/redoc/ | API reference |
| Redis | localhost:6379 | Celery broker + result backend |
| Celery worker | — | Processes `send_message` tasks (async SMS/MMS dispatch) |
| Celery beat | — | Runs `dispatch_due_messages` every 60 s (scheduled send) |

---

## Architecture

### Backend (`backend/`)

```
backend/
├── app/
│   ├── models.py          # Contact, Group, Template, Schedule, Organisation, User, Config, CreditTransaction
│   ├── views.py           # ViewSets for all API endpoints + BillingViewSet
│   ├── serializers.py     # DRF serializers + CreditTransactionSerializer
│   ├── authentication.py  # ClerkJWTAuthentication — extracts org context from JWT
│   ├── permissions.py     # IsOrgMember, IsOrgAdmin
│   ├── filters.py         # django-filter (search, date, group)
│   ├── celery.py          # Celery app instance + send_message + dispatch_due_messages tasks
│   ├── middleware/        # RequestLoggingMiddleware, ClerkTenantMiddleware
│   ├── utils/
│   │   ├── billing.py          # grant_credits, check_can_send, record_usage, refund_usage, etc.
│   │   ├── failure_classifier.py  # classify_failure() — maps provider errors to FailureCategory
│   │   ├── clerk.py            # Webhook handlers (user/org/membership sync + billing subscription events)
│   │   ├── sms.py              # Pluggable SMS provider (MockSMSProvider)
│   │   └── storage.py          # Pluggable storage provider (Mock + Azure Blob)
│   └── mixins.py          # SoftDeleteMixin, TenantScopedMixin
└── tests/                 # 512 tests
```

**Multi-tenancy:** All business models inherit `TenantModel`, which adds an `organisation` FK. All queries are scoped to the authenticated user's organisation via `TenantScopedMixin`. Org context is extracted from the Clerk JWT `o` claim during authentication.

**Clerk integration:** Users and organisations are created in Clerk and synced to the local DB via webhooks (`POST /api/webhooks/clerk/`). Membership changes (role updates, deactivation, invitations) go through Clerk's API and sync back via webhooks — Clerk is the source of truth.

**Async send pipeline:** Send endpoints (`POST /api/sms/send/`, `send-mms/`, `send-to-group/`) return `202 Accepted` immediately. A Celery task (`send_message`) handles actual dispatch with full retry logic:

```
HTTP POST → validate + billing gate → Schedule(status=QUEUED) → send_message.delay() → 202
                                                                        │
                                                          Celery worker ▼
                                           QUEUED → PROCESSING → SENT → DELIVERED (receipt)
                                                               ↓ transient fail → RETRYING (backoff)
                                                               ↓ permanent fail → FAILED + refund
```

Retry backoff: `min(base × 2^n, max_delay) × (1 ± 25% jitter)` — defaults to ~1m → 2m → 4m → 8m, capped at 1h. A `dispatch_due_messages` beat task runs every 60 s to pick up scheduled sends and recover stuck RETRYING/PROCESSING schedules.

**Worker startup:** `celery.py` calls `django.setup()` after `app.config_from_object(...)` and before any model imports. This is required because the worker starts a fresh Python process where Django's app registry is not yet populated. Without it, model imports raise `AppRegistryNotReady` and the worker exits silently, leaving all dispatched messages stuck in QUEUED.

**Failure classification:** `failure_classifier.py` maps provider errors to `FailureCategory` (permanent: `invalid_number`, `opt_out`, `blacklisted`, etc.; transient: `network_error`, `rate_limited`, `server_error`, etc.). Permanent failures skip retries and trigger `refund_usage()`.

**Billing system:** `Organisation` has `credit_balance` (Decimal) and `billing_mode` (`trial` | `subscribed` | `past_due`). Every billable action (send or grant) creates a `CreditTransaction` row. `billing.py` exposes `check_can_send`, `record_usage`, and `refund_usage`. SMS costs `message_parts × SMS_RATE`; MMS costs `1 × MMS_RATE`. Trial credits are reserved at HTTP dispatch time; on terminal failure `refund_usage()` restores the balance idempotently. Subscribed orgs record usage on `SENT`. `check_can_send` blocks all sends when `billing_mode='past_due'`. Clerk Billing is live: `subscription.active` sets `billing_mode='subscribed'` and clears the Clerk `billing_suspended` metadata flag; `subscriptionItem.canceled`/`subscriptionItem.ended` reverts to `'trial'`; `subscription.past_due` sets `billing_mode='past_due'` and sets `billing_suspended=True` in Clerk org metadata. Per-SMS/MMS metered billing is tracked internally via `CreditTransaction` (for manual invoicing); native Clerk metered billing will be wired into `record_usage()` when Clerk adds support.

**SMS/Storage providers:** Both are pluggable via `settings.SMS_PROVIDER_CLASS` and `settings.STORAGE_PROVIDER_CLASS`. The mock providers are used by default (dev/testing). Implement the abstract base class to add real providers.

### Frontend (`frontend/`)

```
frontend/
├── src/
│   ├── api/               # Query options + mutation hooks (usersApi, contactsApi, etc.)
│   ├── components/        # Feature components (contacts/, groups/, shared/)
│   ├── routes/app/        # File-based route components (TanStack Router)
│   ├── ui/                # HeadlessUI + Tailwind component library
│   ├── types/             # TypeScript types matching backend snake_case fields
│   ├── lib/               # ApiClient, ApiClientProvider
│   └── test/              # Vitest setup, MSW handlers, factories
└── e2e/                   # Playwright tests
```

**API client pattern:** All components use `useApiClient()` to get an `ApiClient` instance pre-authenticated with a Clerk JWT. API modules (`src/api/`) export TanStack Query options and mutation hooks that accept the client as their first argument.

**Clerk mutations:** Role and status mutations use a 2-second delayed query invalidation to account for the race condition between the API response and webhook processing.

---

## API Reference

| Resource | Endpoints |
|---|---|
| Contacts | `GET/POST /api/contacts/`, `GET/PUT/PATCH /api/contacts/:id/`, `GET /api/contacts/:id/schedules/`, `POST /api/contacts/import/` |
| Groups | `GET/POST /api/groups/`, `GET/PUT/PATCH/DELETE /api/groups/:id/`, `POST/DELETE /api/groups/:id/members/` |
| Templates | `GET/POST /api/templates/`, `GET/PUT/PATCH /api/templates/:id/` |
| Schedules | `GET/POST /api/schedules/`, `GET/PUT/PATCH /api/schedules/:id/` |
| Group Schedules | `GET/POST /api/group-schedules/`, `GET/PUT/DELETE /api/group-schedules/:id/` |
| Users | `GET /api/users/`, `GET /api/users/me/`, `PATCH /api/users/:id/role/`, `PATCH /api/users/:id/status/`, `POST /api/users/invite/` |
| SMS/MMS | `POST /api/sms/send/` → 202, `POST /api/sms/send-to-group/` → 202, `POST /api/sms/send-mms/` → 202, `POST /api/sms/upload-file/` |
| Stats | `GET /api/stats/monthly/` |
| Billing | `GET /api/billing/summary/` — balance, monthly usage by format, transaction history (admin only) |
| Configs | `GET/POST/PUT/PATCH/DELETE /api/configs/`, `GET/PUT/PATCH/DELETE /api/configs/:id/` |
| Webhooks | `POST /api/webhooks/clerk/` |

All endpoints require Clerk JWT authentication. Most require `IsOrgMember`; user management and billing endpoints require `IsOrgAdmin`.

---

## Testing

### Backend

```bash
docker compose exec backend python -m pytest tests/ -x -q
```

512 tests. Run with `-v` for verbose output or `--cov` for a coverage report. If the schema has changed since the last run, rebuild the test database first:

```bash
docker compose exec backend python -m pytest --create-db tests/ -q
```

### Frontend (unit + integration)

```bash
docker compose exec frontend npx vitest run
```

292 tests. Uses Vitest + MSW for API mocking. Covers API modules, components, and route integration tests.

### Frontend (E2E)

```bash
docker compose exec frontend npx playwright test
```

53 Playwright tests across contacts, groups, templates, schedules, send SMS/MMS pipeline, billing gates, and users pages. Tests hit the **real backend** (Django + PostgreSQL) — no `page.route()` mocking.

**Authentication:** E2E tests use real Clerk authentication via `@clerk/testing/playwright`:

1. `global-setup.ts` creates a fresh Clerk user + org per CI run, then seeds the Django DB by posting simulated webhook events directly to the backend (in `TEST` mode, Svix signature verification is skipped).
2. `auth.setup.ts` (Playwright setup project) signs in via Clerk's ticket strategy and saves browser `storageState` to `/tmp/e2e-auth-state.json`.
3. All chromium tests inherit the pre-authenticated state. `beforeAll` blocks that need API access (e.g., `send-pipeline.spec.ts`) use `authenticatePage()` which falls back to a full sign-in from the state file.
4. `global-teardown.ts` deletes the Clerk user + org.

**CI requirements:** Set `CLERK_SECRET_KEY` (Clerk secret key) and `E2E_CLERK_USER_ID` (a test user ID) as CI secrets. The backend must have `TEST=True` to enable test-only endpoints (`force-status`, `test-set-balance`) and skip webhook signature verification.

**users.spec.ts** is self-contained: it creates its own Clerk admin, member, and inactive users + org in `beforeAll`, independent of the global test user. It uses `test.use({ storageState: { cookies: [], origins: [] } })` to clear the main user's session.

### E2E Test Limitations

The E2E tests are **UI integration tests** — they exercise real HTTP calls against a real backend and database, but external services and the async task queue are mocked or bypassed:

| Component | E2E Behaviour | What's NOT tested |
|---|---|---|
| **SMS/MMS provider** | `MockSMSProvider` returns fake message IDs | No real message delivery or provider error handling |
| **Storage provider** | `MockStorageProvider` returns fake URLs | No real file uploads (MMS attachments) |
| **Clerk webhooks** | Simulated via direct POST (no Svix signature) | Real webhook delivery, retries, and signature validation |
| **Celery workers** | Not running — tasks enqueued to Redis but never consumed | Async dispatch, retry logic, status transitions, failure recovery |
| **Schedule statuses** | Forced via TEST-only `PATCH /api/schedules/:id/force-status/` | Organic state machine transitions from task execution |
| **Billing** | Real `check_can_send` DB checks; balance set via TEST-only endpoint | Credit transactions from actual task execution; refund-on-failure flow |
| **Redis** | Running but effectively unused (no worker consuming tasks) | Broker reliability, task routing |

**TEST-mode-only endpoints** used by E2E tests:
- `PATCH /api/schedules/:id/force-status/` — set schedule status directly
- `PATCH /api/billing/test-set-balance/` — set org credit balance directly
- Webhook endpoint skips Svix signature verification

---

## Clerk Configuration

1. Create an application in the [Clerk Dashboard](https://dashboard.clerk.com)
2. Enable **Organizations** in the Clerk Dashboard
3. Enable **Organization Invitations** (Organizations → Settings)
4. Configure your **Webhook** endpoint to point to `https://your-domain/api/webhooks/clerk/` and subscribe to all events below:

   **Core (user/org/membership sync):** `user.created`, `user.updated`, `user.deleted`, `organization.created`, `organization.updated`, `organization.deleted`, `organizationMembership.created`, `organizationMembership.updated`, `organizationMembership.deleted`

   **Clerk Billing:** `subscription.active`, `subscriptionItem.canceled`, `subscriptionItem.ended`, `subscription.past_due`

5. **Enable Billing** in the Clerk Dashboard. Create **one paid subscription plan for Organizations** only. Do **not** create a free or trial plan in Clerk — the $10 credit trial is managed entirely in-app; a Clerk trial plan would immediately fire `subscription.active` on signup and bypass the credit trial.
6. Set the **Application name** in Settings → General (appears in invitation emails)

For E2E tests in CI, set `CLERK_SECRET_KEY` as a secret. The test infrastructure creates and tears down its own Clerk users and orgs automatically via `global-setup.ts` / `global-teardown.ts`.

---

## Known Gaps

These features are not yet implemented and are required before production use:

### 1. Real SMS/MMS Provider + Delivery Receipts

The app uses `MockSMSProvider`, which logs operations but does not send real messages. To add a real provider:

- Subclass `SMSProvider` in `backend/app/utils/sms.py`
- Implement `_send_sms_impl()`, `_send_bulk_sms_impl()`, `_send_mms_impl()` — return the enriched dict including `error_code`, `http_status`, `retryable`, `failure_category`
- Set `settings.SMS_PROVIDER_CLASS` to the new provider class path

Delivery receipt tracking (`DELIVERED` status, carrier-confirmed delivery time) is deferred until a real provider is chosen. The schema is ready (`provider_message_id`, `delivered_time` fields on `Schedule`). When a provider is selected, add:

- `POST /api/webhooks/delivery/?provider=<name>` with HMAC signature verification
- `process_delivery_event` Celery task: marks `DELIVERED` or triggers `refund_usage()` on delivery failure

### 2. Production Deployment

Docker is used for local development only. The production target is Azure:

| Component | Target |
|-----------|--------|
| Backend (Django) | Azure App Service — Linux, Python 3.12, `gunicorn -k uvicorn.workers.UvicornWorker` |
| Frontend (React) | Azure Static Web Apps |
| Database | Azure Database for PostgreSQL (Flexible Server) |
| Redis / Celery broker | Azure Cache for Redis |
| Celery worker | Azure App Service (separate instance, custom startup command) |
| Celery beat | Azure App Service (separate instance, `django-celery-beat` DB scheduler) |

**Changes required before first deploy — all completed:**

- ~~`backend/requirements.txt` — add `gunicorn`, `uvicorn[standard]`, `whitenoise[brotli]`, `django-celery-beat`~~ ✓
- ~~`backend/app/settings.py` — fix `DEBUG` parsing, add `STATIC_ROOT`, `WhiteNoiseMiddleware`, security headers (`SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SECURE_HSTS_SECONDS`, `X_FRAME_OPTIONS`, `SECURE_CONTENT_TYPE_NOSNIFF`), switch Celery beat to `DatabaseScheduler`~~ ✓
- ~~`backend/app/urls.py` — gate Swagger/OpenAPI behind `DEBUG=True`; add `GET /api/health/` (DB + Redis liveness check for App Service health probe)~~ ✓
- ~~`backend/startup.sh`, `startup-worker.sh`, `startup-beat.sh` — Azure App Service startup commands~~ ✓
- ~~`frontend/staticwebapp.config.json` — SPA fallback routing for Azure Static Web Apps~~ ✓
- ~~`frontend/vite.config.ts` — explicit `build.outDir` and `sourcemap: false`~~ ✓
- ~~Frontend UX fixes: `_layout.send.index.tsx` (blank page), `__root.tsx` (raw JSON error boundary), missing `errorComponent` on billing/users routes~~ ✓
- ~~`.github/workflows/` — CI (pytest + vitest on PRs) and CD (deploy to Azure on `main`)~~ ✓

**Changes required at Azure provisioning time:**

- Set all secrets as Azure App Service environment variables (not `.env` files) — see `backend/.envexample` for full list
- Rotate `DJANGO_SECRET_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET` before go-live
- `SECURE_SSL_REDIRECT` must remain `False` — Azure terminates TLS at the load balancer; setting `True` causes redirect loops
- Enable App Service health check probe at `/api/health/`

### 3. Metered Billing (Clerk not yet supported)

Per-SMS/MMS usage is tracked internally via `CreditTransaction` and visible at `GET /api/billing/summary/`. Clerk Billing does not yet support metered/usage-based billing (it is on their roadmap). When Clerk adds it, the integration point is `record_usage()` in `backend/app/utils/billing.py` — add a Clerk metered billing API call there alongside the existing internal tracking.

### 4. Remaining Clerk Production Configuration

From codebase inspection, these items need to be addressed before production:

- Set `CLERK_AUTHORIZED_PARTIES`, `CORS_ALLOWED_ORIGINS`, and `ALLOWED_HOSTS` in `backend/.env` to include the production frontend URL (all three are env-var driven; current values are `localhost` / `localhost:5173`)
- Confirm Clerk email templates (invitation, sign-up, magic link) are correctly branded for the corporate account before sending to real users
- Configure Clerk to require verified email addresses before allowing users to be created or organisations to be joined (Clerk Dashboard → User & Authentication → Email, Phone, Username → enable "Require verified email address")

---

See [v1_migration.md](v1_migration.md) for v1 → v2 migration details.
