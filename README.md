# 1Reach

A multi-tenant SMS/MMS messaging platform for managing contacts, groups, templates, and scheduled messages.

---

## Overview

1Reach lets organisations send and schedule SMS/MMS messages to individual contacts or groups. Each organisation is isolated — contacts, templates, schedules, and configs are all scoped per organisation. Admins sign up via Clerk, create an organisation, and invite team members.

**Key capabilities:**
- Contact management with CSV import
- Group messaging with scheduling
- Template library
- SMS/MMS sending — single or batch (multi-recipient), async dispatch via Celery with automatic retry and credit refund on failure
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
| Styling | Tailwind CSS 3 + HeadlessUI + Lucide icons |
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
| `AZURE_STORAGE_ACCOUNT_NAME` | If using Azure | Azure Storage account name |
| `AZURE_STORAGE_ACCOUNT_KEY` | If using Azure | Azure Storage account key (for per-blob SAS tokens) |
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
| `WELCORP_BASE_URL` | No | Welcorp API URL (default: `https://api.message-service.org/api/v1`) |
| `WELCORP_USERNAME` | If using Welcorp | Welcorp Basic auth username |
| `WELCORP_PASSWORD` | If using Welcorp | Welcorp Basic auth password |
| `WELCORP_CALLBACK_SECRET` | No | Shared secret for delivery callback URL token verification |
| `BASE_URL` | No | Publicly accessible base URL for this application (e.g. `https://your-domain.com`) — used for provider delivery callbacks |

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
| Celery beat | — | Runs `dispatch_due_messages` every 60 s + `reconcile_stale_sent` (polls provider for missed callbacks) |

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
│   ├── celery.py          # Celery app + send_message + dispatch_due_messages + process_delivery_event + reconcile_stale_sent tasks
│   ├── middleware/        # RequestLoggingMiddleware, ClerkTenantMiddleware
│   ├── utils/
│   │   ├── billing.py          # grant_credits, check_can_send, record_usage, refund_usage, etc.
│   │   ├── failure_classifier.py  # classify_failure() — maps provider errors to FailureCategory
│   │   ├── clerk.py            # Webhook handlers (user/org/membership sync + billing subscription events)
│   │   ├── sms.py              # Pluggable SMS provider (SMSProvider base + MockSMSProvider + DeliveryEvent)
│   │   ├── welcorp.py          # Welcorp SMS/MMS provider (API integration + delivery callbacks + job polling)
│   │   └── storage.py          # Pluggable storage provider (Mock + Azure Blob)
│   └── mixins.py          # SoftDeleteMixin, TenantScopedMixin
└── tests/                 # 645 tests
```

**Multi-tenancy:** All business models inherit `TenantModel`, which adds an `organisation` FK. All queries are scoped to the authenticated user's organisation via `TenantScopedMixin`. Org context is extracted from the Clerk JWT `o` claim during authentication.

**Clerk integration:** Users and organisations are created in Clerk and synced to the local DB via webhooks (`POST /api/webhooks/clerk/`). Membership changes (role updates, deactivation, invitations) go through Clerk's API and sync back via webhooks — Clerk is the source of truth.

**Async send pipeline:** Send endpoints (`POST /api/sms/send/`, `send-mms/`, `send-to-group/`) return `202 Accepted` immediately. Single-recipient sends dispatch a `send_message` task; multi-recipient sends create a parent Schedule with per-recipient child Schedules and dispatch a `send_batch_message` task that calls the provider's bulk send interface:

```
Single recipient:
  HTTP POST → validate + billing gate → Schedule(QUEUED) → send_message.delay() → 202

Multiple recipients:
  HTTP POST → validate + billing gate → parent Schedule(QUEUED) + N child Schedules
            → send_batch_message.delay(parent.pk) → 202

Celery worker (both paths):
  QUEUED → PROCESSING → SENT → DELIVERED (receipt)
                      ↓ transient fail → RETRYING (backoff)
                      ↓ permanent fail → FAILED + refund
```

Retry backoff: `min(base × 2^n, max_delay) × (1 ± 25% jitter)` — defaults to ~1m → 2m → 4m → 8m, capped at 1h. A `dispatch_due_messages` beat task runs every 60 s to pick up scheduled sends and recover stuck RETRYING/PROCESSING schedules.

**Worker startup:** `celery.py` calls `django.setup()` after `app.config_from_object(...)` and before any model imports. This is required because the worker starts a fresh Python process where Django's app registry is not yet populated. Without it, model imports raise `AppRegistryNotReady` and the worker exits silently, leaving all dispatched messages stuck in QUEUED. All three startup scripts (`startup.sh`, `startup-worker.sh`, `startup-beat.sh`) include dependency wait loops that poll DB (and Redis for worker/beat) for up to 2.5 minutes before proceeding, preventing crash loops during Azure App Service restarts.

**Failure classification:** `failure_classifier.py` maps provider errors to `FailureCategory` (permanent: `invalid_number`, `opt_out`, `blacklisted`, etc.; transient: `network_error`, `rate_limited`, `server_error`, etc.). Permanent failures skip retries and trigger `refund_usage()`.

**Billing system:** `Organisation` has `credit_balance` (Decimal) and `billing_mode` (`trial` | `subscribed` | `past_due`). Every billable action (send or grant) creates a `CreditTransaction` row. `billing.py` exposes `check_can_send`, `record_usage`, and `refund_usage`. SMS costs `message_parts × SMS_RATE`; MMS costs `1 × MMS_RATE`. Trial credits are reserved at HTTP dispatch time; on terminal failure `refund_usage()` restores the balance idempotently. Subscribed orgs record usage on `SENT`. `check_can_send` blocks all sends when `billing_mode='past_due'`. Clerk Billing is live: `subscription.active` sets `billing_mode='subscribed'` and clears the Clerk `billing_suspended` metadata flag; `subscriptionItem.canceled`/`subscriptionItem.ended` reverts to `'trial'`; `subscription.past_due` sets `billing_mode='past_due'` and sets `billing_suspended=True` in Clerk org metadata. Per-SMS/MMS metered billing is tracked internally via `CreditTransaction` (for manual invoicing); native Clerk metered billing will be wired into `record_usage()` when Clerk adds support.

**SMS/Storage providers:** Both are pluggable via `settings.SMS_PROVIDER_CLASS` and `settings.STORAGE_PROVIDER_CLASS`. The mock providers are used by default (dev/testing). The `SMSProvider` base class defines `send_sms()`, `send_bulk_sms()`, `send_mms()`, and `send_bulk_mms()` public methods that handle phone validation/normalisation, then delegate to abstract `_send_sms_impl()` and `_send_mms_impl()` methods. Bulk methods (`_send_bulk_sms_impl`, `_send_bulk_mms_impl`) have default implementations that loop over the individual send method — providers with native batch support can override them.

**Delivery status tracking:** The `SMSProvider` base class also defines a provider-agnostic delivery callback/polling interface. Providers can override `parse_delivery_callback()` to handle incoming webhooks, `validate_callback_request()` for authentication, `get_callback_url()` to register callbacks in send payloads, and `poll_job_status()` to fetch delivery reports on demand. All methods return `DeliveryEvent` objects consumed by the `process_delivery_event` Celery task, which updates schedule status and triggers billing refunds on carrier-reported failures. A `reconcile_stale_sent` beat task polls the provider for schedules stuck in SENT >24h as a fallback when callbacks are missed. The Welcorp provider (`welcorp.py`) implements all four methods. Welcorp's `SENT` status means "carrier accepted" (the best confirmation available — no handset delivery status exists), so it is mapped to `DELIVERED` to mark the schedule as terminal.

### Frontend (`frontend/`)

```
frontend/
├── src/
│   ├── api/               # Query options + mutation hooks (usersApi, contactsApi, etc.)
│   ├── components/
│   │   ├── landing/       # Landing page sections (Navbar, Hero, Features, Pricing, etc.)
│   │   ├── contacts/      # Contact-related components
│   │   ├── groups/        # Group-related components
│   │   ├── shared/        # Shared components (LoadingSpinner, etc.)
│   │   └── ScheduleDateTimePicker.tsx  # Unified datetime picker (Send page, Contact modal, Group modal)
│   ├── routes/app/        # File-based route components (TanStack Router)
│   ├── ui/                # HeadlessUI + Tailwind component library
│   ├── types/             # TypeScript types matching backend snake_case fields
│   ├── lib/               # ApiClient, ApiClientProvider, cn() utility
│   └── test/              # Vitest setup, MSW handlers, factories
└── e2e/                   # Playwright tests
```

**Scheduling UI:** All scheduling flows (Send page, Contact message modal, Group schedule modal) use a unified `ScheduleDateTimePicker` component. It renders a `datetime-local` input with a `min` attribute set to the current time (preventing past-time selection), outputs UTC ISO strings, and shows contextual status messages (past time warning, immediate send notice, or scheduled confirmation).

**Landing page:** Unauthenticated visitors see a marketing landing page (`src/components/landing/`) rendered via Clerk's `<SignedOut>` gate in `__root.tsx`. It includes a hero section with animated canvas background, features grid, pricing tiers, and CTA sections. Sign In / Sign Up buttons open Clerk modals. Once authenticated, users are redirected to `/app/send`.

**Brand colours:** Defined in `tailwind.config.cjs` under `theme.extend.colors.brand`:

| Token | Hex | Usage |
|-------|-----|-------|
| `brand-purple` | `#7400f6` | Primary actions, buttons, progress bars |
| `brand-navy` | `#190075` | Dark text accents |
| `brand-light-purple` | `#9d30a0` | Secondary accents |
| `brand-teal` | `#048fb5` | Tertiary accents |
| `brand-green` | `#2CDFB5` | Success states |
| `brand-red` | `#FC7091` | Error states |
| `brand-amber` | `#FEC200` | Warning states |

Fonts: Inter (body/sans) and Poppins (headings/mono) loaded via Google Fonts in `index.html`.

**API client pattern:** All components use `useApiClient()` to get an `ApiClient` instance pre-authenticated with a Clerk JWT. API modules (`src/api/`) export TanStack Query options and mutation hooks that accept the client as their first argument.

**Clerk mutations:** Role and status mutations use a 2-second delayed query invalidation to account for the race condition between the API response and webhook processing.

---

## API Reference

| Resource | Endpoints |
|---|---|
| Contacts | `GET/POST /api/contacts/`, `GET/PUT/PATCH /api/contacts/:id/`, `GET /api/contacts/:id/schedules/`, `POST /api/contacts/import/` |
| Groups | `GET/POST /api/groups/`, `GET/PUT/PATCH/DELETE /api/groups/:id/`, `POST/DELETE /api/groups/:id/members/` |
| Templates | `GET/POST /api/templates/`, `GET/PUT/PATCH /api/templates/:id/` |
| Schedules | `GET/POST /api/schedules/`, `GET/PUT/PATCH /api/schedules/:id/`, `GET /api/schedules/:id/recipients/` |
| Group Schedules | `GET/POST /api/group-schedules/`, `GET/PUT/DELETE /api/group-schedules/:id/` |
| Users | `GET /api/users/`, `GET /api/users/me/`, `PATCH /api/users/:id/role/`, `PATCH /api/users/:id/status/`, `POST /api/users/invite/` |
| SMS/MMS | `POST /api/sms/send/` → 202, `POST /api/sms/send-to-group/` → 202, `POST /api/sms/send-mms/` → 202, `POST /api/sms/upload-file/` |
| Stats | `GET /api/stats/monthly/` |
| Billing | `GET /api/billing/summary/` — balance, monthly usage by format, transaction history (admin only) |
| Configs | `GET/POST/PUT/PATCH/DELETE /api/configs/`, `GET/PUT/PATCH/DELETE /api/configs/:id/` |
| Webhooks | `POST /api/webhooks/clerk/`, `POST /api/webhooks/sms-delivery/` |

All endpoints require Clerk JWT authentication. Most require `IsOrgMember`; user management and billing endpoints require `IsOrgAdmin`.

---

## Testing

### Backend

```bash
docker compose exec backend python -m pytest tests/ -x -q
```

645 tests. Run with `-v` for verbose output or `--cov` for a coverage report. If the schema has changed since the last run, rebuild the test database first:

```bash
docker compose exec backend python -m pytest --create-db tests/ -q
```

### Frontend (unit + integration)

```bash
docker compose exec frontend npx vitest run
```

383 tests. Uses Vitest + MSW for API mocking. Covers API modules, components, and route integration tests.

### Frontend (E2E)

```bash
docker compose exec frontend npx playwright test
```

77 Playwright tests covering all user flows: contacts (CRUD + message history + send modal), groups (CRUD + edit + member removal + schedule modal), templates (CRUD + edit + pre-fill verification), schedules (navigation + status badges + cancellation + row expansion + pagination), send SMS (form validation + recipient count + template selection), send pipeline (SMS/MMS success + billing gates + group send + status display), summary (stats table + monthly limit), billing (balance display + transaction history + exhausted warning), and users (table + invite + role/status management). Tests hit the **real backend** (Django + PostgreSQL) — no `page.route()` mocking.

**Authentication:** E2E tests use real Clerk authentication via `@clerk/testing/playwright`:

1. `global-setup.ts` creates a fresh Clerk user + org per CI run, waits for the backend health endpoint to return 200 (up to 2.5 minutes), then seeds the Django DB by posting simulated webhook events directly to the backend with retry logic (in `TEST` mode, Svix signature verification is skipped).
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

### 1. Switching SMS/MMS Provider

The app currently uses `WelcorpSMSProvider` (with `MockSMSProvider` available for dev/testing). To switch to a different provider:

- Subclass `SMSProvider` in `backend/app/utils/sms.py`
- Implement `_send_sms_impl()` and `_send_mms_impl()` — return a `SendResult` with `error_code`, `http_status`, `retryable`, `failure_category`
- Optionally override `_send_bulk_sms_impl()` and `_send_bulk_mms_impl()` for native batch support (the base class provides default implementations that loop over the individual send methods)
- For delivery callbacks: override `parse_delivery_callback()`, `validate_callback_request()`, `get_callback_url()`, and `poll_job_status()` — they all return `DeliveryEvent` objects consumed by the existing `process_delivery_event` Celery task
- Set `settings.SMS_PROVIDER_CLASS` to the new provider class path

Note: Welcorp does not provide true handset delivery confirmation — their `SENT` status means "carrier accepted". If the new provider supports handset delivery receipts, map them to `DeliveryEvent(status='delivered')` and the existing pipeline will transition schedules to `DELIVERED` status.

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
- ~~TypeScript build errors — fix ~35 errors caught by `tsc -b` (unused imports, missing status colors, null safety, HeadlessUI/TanStack type conflicts)~~ ✓

**Azure provisioning — see [Azure Deployment](#azure-deployment) below.**

### 3. Metered Billing (Clerk not yet supported)

Per-SMS/MMS usage is tracked internally via `CreditTransaction` and visible at `GET /api/billing/summary/`. Clerk Billing does not yet support metered/usage-based billing (it is on their roadmap). When Clerk adds it, the integration point is `record_usage()` in `backend/app/utils/billing.py` — add a Clerk metered billing API call there alongside the existing internal tracking.

### 4. Remaining Clerk Production Configuration

From codebase inspection, these items need to be addressed before production:

- Set `CLERK_AUTHORIZED_PARTIES`, `CORS_ALLOWED_ORIGINS`, and `ALLOWED_HOSTS` in `backend/.env` to include the production frontend URL (all three are env-var driven; current values are `localhost` / `localhost:5173`)
- Confirm Clerk email templates (invitation, sign-up, magic link) are correctly branded for the corporate account before sending to real users
- Configure Clerk to require verified email addresses before allowing users to be created or organisations to be joined (Clerk Dashboard → User & Authentication → Email, Phone, Username → enable "Require verified email address")

---

## Azure Deployment

The app deploys to Azure as five services. GitHub Actions workflows (`.github/workflows/deploy-backend.yml` and `deploy-frontend.yml`) deploy automatically on push to `main`.

| Component | Azure Service | Startup |
|-----------|---------------|---------|
| Backend API | App Service (Python 3.12, Linux) | `bash startup.sh` — waits for DB, migrations, collectstatic, gunicorn + uvicorn ASGI workers |
| Celery Worker | App Service (same plan) | `bash startup-worker.sh` — waits for DB + Redis, processes `messages` queue |
| Celery Beat | App Service (same plan) | `bash startup-beat.sh` — waits for DB + Redis, `DatabaseScheduler`, dispatches due messages every 60s |
| Frontend | Azure Static Web Apps | Vite build → `dist/` uploaded via `Azure/static-web-apps-deploy` |
| Database | Azure Database for PostgreSQL | Flexible Server |
| Redis | Azure Cache for Redis | Celery broker + result backend |
| Storage | Azure Blob Storage | MMS media files |

### Step-by-Step Azure Setup

#### 1. Provision Azure Resources

Create these resources in a single resource group (a logical container that groups related Azure resources for unified management, billing, and access control):

1. **Azure Database for PostgreSQL** — Flexible Server. Note the server name, database name, admin user, and password.
2. **Azure Cache for Redis** — Basic C0 (~$15/mo). Classic Azure Cache for Redis is being deprecated in 2028; Azure Managed Redis (AMR) is the replacement but starts at ~$30/mo for the B0 tier. For dev/staging, Classic Basic C0 is fine.
   - Connection URL format: `rediss://:<access-key>@<redis-name>.redis.cache.windows.net:6380/0`
   - Must use `rediss://` (TLS) and port `6380` (classic) or `10000` (AMR)
3. **App Service Plan** — Linux, B1 or higher. All three backend services (API, worker, beat) can share one plan for dev/staging.
4. **App Service × 3** — Create three App Services on the plan above (API, worker, beat). Set runtime to Python 3.12.
5. **Azure Static Web Apps** — Free tier. `frontend/staticwebapp.config.json` handles SPA routing fallback.
6. **Azure Blob Storage** — Standard LRS. The `media` container is auto-created on first upload if it doesn't exist. Copy the account name and one of the access keys from Storage Account → Access keys. Per-blob read-only SAS tokens (1h expiry) are generated at upload time.

#### 2. Configure Azure Cache for Redis

After provisioning the Redis instance, configure it to accept connections from the App Services:

1. **Enable access key authentication:** Azure Cache for Redis → Authentication → untick "Disable Access Keys Authentication". This is disabled by default on new instances — without it, all password-based connections from Celery are rejected with "invalid username-password pair".
2. **Enable public network access:** Azure Cache for Redis → Private Endpoint → set Public network access to **Enabled**.
3. **Add firewall rules:** Whitelist the App Service outbound IPs so Redis accepts connections from your backend services. Find them at: any App Service → Networking → Outbound addresses (all 3 services share the same App Service Plan, so they have identical IPs). Use IP ranges to minimize the number of rules (e.g., `20.46.106.0` – `20.46.110.255` to cover a block).
4. **Verify the access key:** Copy the Primary key from Azure Cache for Redis → Authentication → Access keys. This must exactly match the password in your `CELERY_BROKER_URL` env var (`rediss://:<this-key>@...`). Do not URL-encode special characters like `=` — see [gotcha below](#azure-cache-for-redis--do-not-url-encode-the-access-key).

#### 3. Configure App Services

For each App Service (API, worker, beat):

**Settings → Configuration → General settings → Startup command:**
- API: `bash startup.sh`
- Worker: `bash startup-worker.sh`
- Beat: `bash startup-beat.sh`

**Settings → Configuration → General settings → Always On:** Set to **On**. Required for worker and beat services to stay alive between requests. Without it, Azure unloads idle processes and Celery tasks stop being consumed.

**Settings → Environment variables** — set the variables listed in the [Environment Variables](#environment-variables) table below.

**Settings → Configuration → General settings:**
- Ensure `SCM_DO_BUILD_DURING_DEPLOYMENT` is set to `true` — this triggers Oryx to run `pip install -r requirements.txt` during zip deploy.

**Download publish profiles:**
- Each App Service → Overview → Download publish profile. You need **Basic authentication** enabled (Settings → Configuration → General settings → Basic Auth Publishing Credentials → On).

#### 4. Configure GitHub Secrets

In your GitHub repo → Settings → Secrets and variables → Actions, set the secrets listed in the [GitHub Secrets](#github-secrets-cd) table below.

#### 5. Configure Clerk for Azure

1. **Clerk Dashboard → Domains:** Add the Static Web App URL (`https://<name>.azurestaticapps.net`) as an allowed origin
2. **Clerk Dashboard → Webhooks → Add Endpoint:**
   - URL: `https://<api-app-name>.azurewebsites.net/api/webhooks/clerk/`
   - Subscribe to: `user.created`, `user.updated`, `user.deleted`, `organization.created`, `organization.updated`, `organization.deleted`, `organizationMembership.created`, `organizationMembership.updated`, `organizationMembership.deleted`, `subscription.active`, `subscriptionItem.canceled`, `subscriptionItem.ended`, `subscription.past_due`
   - Copy the **Signing Secret** (`whsec_...`) → set as `CLERK_WEBHOOK_SIGNING_SECRET` on all backend App Services

#### 6. Deploy

Push to `main` to trigger both GitHub Actions workflows. Alternatively, manually trigger them from the Actions tab. The backend deploy workflow includes a `verify-health` job that polls `/api/health/` for up to 5 minutes after deployment, failing the workflow if the API does not become healthy.

#### 7. Verify

- `GET https://<api-app-name>.azurewebsites.net/api/health/` returns 200
- Frontend loads at the Static Web App URL and Clerk sign-in works
- Sign up a user → check Clerk Dashboard → Webhooks → verify events delivered successfully (200)
- App Service → Monitoring → Log stream shows JSON-formatted request/response logs
- Send a test message to verify the Celery worker processes it

### Environment Variables

Set these on **all three** App Services (API, worker, beat) via Settings → Environment variables:

| Variable | Value |
|----------|-------|
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` (triggers `pip install` on deploy) |
| `DJANGO_SECRET_KEY` | Strong random key |
| `DEBUG` | `0` |
| `ALLOWED_HOSTS` | `<api-app-name>.azurewebsites.net,169.254.129.2` |
| `CORS_ALLOWED_ORIGINS` | `https://<static-web-app>.azurestaticapps.net` |
| `POSTGRES_DB` | Database name |
| `POSTGRES_USER` | Database user |
| `POSTGRES_PASSWORD` | Database password |
| `POSTGRES_HOST` | `<server>.postgres.database.azure.com` |
| `POSTGRES_PORT` | `5432` |
| `DB_POOL` | `true` (enable psycopg3 native connection pooling) |
| `DB_POOL_MIN_SIZE` | `2` (API), `1` (worker/beat — set in startup scripts) |
| `DB_POOL_MAX_SIZE` | `8` (API), `4` (worker), `2` (beat — set in startup scripts) |
| `DB_POOL_TIMEOUT` | `10` (seconds to wait for a pooled connection) |
| `CELERY_BROKER_URL` | `rediss://:<key>@<redis-host>:<port>/0` |
| `CELERY_RESULT_BACKEND` | Same as broker URL |
| `CLERK_FRONTEND_API` | Clerk frontend API URL |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Clerk webhook signing secret (`whsec_...`) |
| `CLERK_AUTHORIZED_PARTIES` | `https://<static-web-app>.azurestaticapps.net` |
| `STORAGE_PROVIDER_CLASS` | `app.utils.storage.AzureBlobStorageProvider` |
| `AZURE_STORAGE_ACCOUNT_NAME` | `<account-name>` |
| `AZURE_STORAGE_ACCOUNT_KEY` | `<account-key>` |
| `AZURE_CONTAINER` | `media` |
| `LOG_LEVEL` | `INFO` |
| `LOG_FORMAT` | `json` |
| `SESSION_COOKIE_SECURE` | `True` |
| `CSRF_COOKIE_SECURE` | `True` |
| `SECURE_HSTS_SECONDS` | `31536000` |

### GitHub Secrets (CD)

| Secret | Where to find it |
|--------|------------------|
| `AZURE_BACKEND_APP_NAME` | API App Service name |
| `AZURE_BACKEND_PUBLISH_PROFILE` | API App Service → Overview → Download publish profile |
| `AZURE_WORKER_APP_NAME` | Worker App Service name |
| `AZURE_WORKER_PUBLISH_PROFILE` | Worker App Service → Download publish profile |
| `AZURE_BEAT_APP_NAME` | Beat App Service name |
| `AZURE_BEAT_PUBLISH_PROFILE` | Beat App Service → Download publish profile |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Static Web App → Manage deployment token |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk dashboard |
| `VITE_API_BASE_URL` | `https://<api-app-name>.azurewebsites.net` (also used by backend deploy's post-deploy health check) |

### Database Connection Pooling

The backend uses **psycopg3 with Django's native connection pool** (`DATABASES["default"]["POOL"]`). This is essential for ASGI deployments — without it, Django under Uvicorn spawns a new thread per request via `asgiref`, and each thread opens a persistent DB connection. Under load, connections accumulate unboundedly until PostgreSQL runs out of connection slots and the entire system (API + Celery) goes down.

The pool provides a **bounded, per-process connection pool**. When all connections in the pool are busy, new requests queue for up to `DB_POOL_TIMEOUT` seconds. If a connection frees up in time, the request proceeds. If not, the request gets a `PoolTimeout` error — but only that request fails, not the whole system.

#### Connection budget

With default settings, the maximum number of PostgreSQL connections is deterministic:

| Process | Instances | Pool max_size | Total connections |
|---|---|---|---|
| Web workers (Uvicorn) | 2 | 8 | 16 |
| Celery workers | 2 | 4 | 8 |
| Celery Beat | 1 | 2 | 2 |
| **Total** | | | **26** |

Azure PostgreSQL Flexible Server typically allows 50–100+ connections depending on tier, so this leaves ample headroom for admin queries, migrations, and monitoring.

#### Throughput estimates

With 16 concurrent web DB connections:

| Avg DB time per request | Approx max throughput |
|---|---|
| 10ms | ~1,600 req/s |
| 50ms | ~320 req/s |
| 200ms | ~80 req/s |

#### Scaling horizontally

When Azure App Service auto-scales to multiple instances, each instance creates its own pools. The total connection count multiplies:

| Web instances | Pool max_size | Web connections | + Celery/Beat | Total |
|---|---|---|---|---|
| 1 (default) | 8 | 16 | 10 | **26** |
| 2 | 8 | 32 | 10 | **42** |
| 4 | 8 | 64 | 10 | **74** |
| 4 | 4 (reduced) | 32 | 10 | **42** |

**If you scale beyond 2 web instances**, reduce `DB_POOL_MAX_SIZE` proportionally via Azure App Settings to stay within PostgreSQL's connection limit. No redeploy is needed — just change the env var and restart.

**If you need more than ~100 concurrent DB connections**, enable Azure PostgreSQL Flexible Server's [built-in PgBouncer](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-pgbouncer). PgBouncer multiplexes hundreds of application connections through a smaller number of actual PostgreSQL connections, removing the per-instance pool sizing constraint.

#### Configuration reference

| Env var | Default | Where set | Description |
|---|---|---|---|
| `DB_POOL` | `true` | Azure App Settings | Enable/disable connection pooling. `false` for local dev. |
| `DB_POOL_MIN_SIZE` | `2` | App Settings or startup scripts | Minimum warm connections per process |
| `DB_POOL_MAX_SIZE` | `8` | App Settings or startup scripts | Maximum connections per process |
| `DB_POOL_TIMEOUT` | `10` | App Settings | Seconds to wait for a connection before `PoolTimeout` |
| `DB_CONN_MAX_AGE` | `0` | Only used when `DB_POOL=false` | Seconds to keep connections alive (0 = close after each request) |

The startup scripts (`startup-worker.sh`, `startup-beat.sh`) set smaller default pool sizes for Celery processes. Azure App Settings override these if set.

#### Troubleshooting

- **`PoolTimeout` errors in Sentry:** The pool is full and requests are waiting longer than `DB_POOL_TIMEOUT`. Increase `DB_POOL_MAX_SIZE` or investigate slow queries.
- **`remaining connection slots are reserved`:** Total connections across all processes exceed PostgreSQL's `max_connections`. Reduce `DB_POOL_MAX_SIZE`, scale down instances, or enable PgBouncer.
- **Celery tasks hanging after deploy:** Forked worker processes may have inherited stale connections from the parent. The `worker_process_init` signal handler in `celery.py` closes these automatically, but if you see issues, restart the worker App Service.

### Gotchas & Troubleshooting

These are issues encountered during initial deployment that are easy to miss:

#### Oryx build system and startup scripts
Azure App Service uses **Oryx** to build and run Python apps. Oryx extracts the deployed zip to a **temp directory** (e.g., `/tmp/8de8a2ddc57556c`), NOT `/home/site/wwwroot`. Startup scripts must use **relative paths** — never `cd /home/site/wwwroot`. The startup command in Azure Portal must also be relative: `bash startup.sh`, not `bash /home/site/wwwroot/startup.sh`.

#### VITE_API_BASE_URL must include the protocol
`VITE_API_BASE_URL` is baked into the frontend JS bundle at build time. It **must** include `https://` — without it, the browser resolves it as a relative path and API requests go to `https://<frontend-host>/<backend-host>/api/...` instead of `https://<backend-host>/api/...`. It must NOT have a trailing slash (API paths already start with `/api/`).

#### CORS_ALLOWED_ORIGINS — no trailing slash
Django-cors-headers silently rejects origins with a trailing slash. Use `https://<host>.azurestaticapps.net`, not `https://<host>.azurestaticapps.net/`.

#### ALLOWED_HOSTS must include Azure health probe IP
Azure health probes hit the app from internal IP `169.254.129.2`. Add it to `ALLOWED_HOSTS` or Django returns `DisallowedHost` and Azure marks the app as unhealthy. For dev/staging you can use `*`.

#### SECURE_SSL_REDIRECT must NOT be True
Azure terminates TLS at the load balancer. The app receives plain HTTP internally. Setting `SECURE_SSL_REDIRECT=True` causes an infinite redirect loop.

#### Frontend deploy — skip_app_build
The `Azure/static-web-apps-deploy@v1` action runs its own internal build by default, **without** your GitHub secrets as env vars. Since Vite env vars (`VITE_*`) must be present at build time, the workflow builds first with `npm run build` (where secrets are available), then deploys the pre-built `dist/` with `skip_app_build: true`.

#### Clerk webhook URL
The webhook endpoint is `POST /api/webhooks/clerk/` (not `/api/clerk/webhook/` or similar). The trailing slash is required — Django's `APPEND_SLASH` doesn't work for POST requests.

#### Clerk webhook signing secret
The `CLERK_WEBHOOK_SIGNING_SECRET` env var on the backend must exactly match the signing secret shown in the Clerk Dashboard for that webhook endpoint. A mismatch causes Svix signature verification to fail → 400 response → webhooks silently not processed.

#### CLERK_AUTHORIZED_PARTIES
The backend validates the `azp` (authorized party) claim in Clerk JWTs against this comma-separated list. If the Azure frontend URL is missing, all authenticated API calls return 403. Include both local and deployed URLs: `http://localhost:5173,https://<static-web-app>.azurestaticapps.net`.

#### App Service log stream shows stale logs
After redeploying, the Azure Portal log stream may continue showing old logs. **Stop and restart** the App Service (not just restart — do Stop, wait, then Start). If logs still don't update, the deployment may not have triggered an Oryx rebuild — check the deployment logs in the Deployment Center.

#### Publish profile requires Basic Auth
To download a publish profile, Basic Authentication must be enabled: App Service → Settings → Configuration → General settings → Basic Auth Publishing Credentials → On.

#### Azure Cache for Redis — access key authentication disabled by default
New Azure Redis instances have access key auth disabled. Celery connections fail with "invalid username-password pair" even though the key is correct. Fix: Azure Cache for Redis → Authentication → untick "Disable Access Keys Authentication".

#### Azure Cache for Redis — firewall blocks App Service connections
By default, Azure Redis blocks all inbound connections. Without firewall rules, Celery's `.delay()` call hangs (or times out after 5s with the broker/result backend transport options in `settings.py`). Fix: enable public network access and add App Service outbound IP ranges as firewall rules. All 3 services (API, worker, beat) share one App Service Plan so they have the same outbound IPs.

#### Azure Cache for Redis — do not URL-encode the access key
Azure Redis access keys are base64 strings that may end in `=`. Do **not** URL-encode `=` to `%3D` in `CELERY_BROKER_URL` — `redis-py` parses the password using `@` as the delimiter and handles `=` correctly. URL-encoding causes auth failures.

---

See [v1_migration.md](v1_migration.md) for v1 → v2 migration details.
