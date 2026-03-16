# 1Reach

A multi-tenant SMS/MMS messaging platform for managing contacts, groups, templates, and scheduled messages.

---

## Overview

1Reach lets organisations send and schedule SMS/MMS messages to individual contacts or groups. Each organisation is isolated — contacts, templates, schedules, and configs are all scoped per organisation. Admins sign up via Clerk, create an organisation, and invite team members.

**Key capabilities:**
- Contact management with CSV import
- Group messaging with scheduling
- Template library
- SMS/MMS sending (immediate or scheduled)
- Org user management — invite, deactivate, grant/revoke admin
- Usage stats dashboard
- Billing system — trial credits on signup, subscribed mode with metered tracking, monthly spending limits, transaction history

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Django 6 + Django REST Framework + PostgreSQL 16 |
| Auth | Clerk (JWT + webhooks) |
| Frontend | React 19 + Vite 7 + TanStack Router + TanStack Query |
| Styling | Tailwind CSS 3 + HeadlessUI |
| SMS/Storage | Pluggable provider interface (Mock by default, Azure Blob for storage) |
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

**`frontend/.env`** — Vite + Clerk:

| Variable | Required | Description |
|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key (`pk_...`) |
| `VITE_API_BASE_URL` | No | Backend URL (default: `http://localhost:8000`) |

### Running Locally

```bash
docker compose up
```

This starts three services:

| Service | URL | Description |
|---|---|---|
| Backend API | http://localhost:8000 | Django REST API |
| Frontend | http://localhost:5173 | React dev server |
| Swagger UI | http://localhost:8000/api/docs/ | Interactive API docs |
| ReDoc | http://localhost:8000/api/redoc/ | API reference |

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
│   ├── middleware/        # RequestLoggingMiddleware, ClerkTenantMiddleware
│   ├── utils/
│   │   ├── billing.py     # grant_credits, check_can_send, record_usage, get_monthly_usage, etc.
│   │   ├── clerk.py       # Webhook handlers (user/org sync + billing subscription stubs)
│   │   ├── sms.py         # Pluggable SMS provider (MockSMSProvider)
│   │   └── storage.py     # Pluggable storage provider (Mock + Azure Blob)
│   └── mixins.py          # SoftDeleteMixin, TenantScopedMixin
└── tests/                 # 390 tests, 88% coverage
```

**Multi-tenancy:** All business models inherit `TenantModel`, which adds an `organisation` FK. All queries are scoped to the authenticated user's organisation via `TenantScopedMixin`. Org context is extracted from the Clerk JWT `o` claim during authentication.

**Clerk integration:** Users and organisations are created in Clerk and synced to the local DB via webhooks (`POST /api/webhooks/clerk/`). Membership changes (role updates, deactivation, invitations) go through Clerk's API and sync back via webhooks — Clerk is the source of truth.

**Billing system:** `Organisation` has `credit_balance` (Decimal) and `billing_mode` (`trial` | `subscribed`). Every billable action (send or grant) creates a `CreditTransaction` row. `billing.py` exposes `check_can_send(org, units, format)` and `record_usage(org, units, format, ...)`. SMS costs `message_parts × SMS_RATE`; MMS costs `1 × MMS_RATE`. A single `monthly_limit` Config key caps spending for both modes. Trial orgs are blocked when balance reaches $0; subscribed orgs are never balance-blocked. Clerk Billing webhook stubs are registered and ready for wiring once the corporate Clerk account has Billing enabled.

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
| SMS/MMS | `POST /api/sms/send/`, `POST /api/sms/send-to-group/`, `POST /api/sms/send-mms/`, `POST /api/sms/upload-file/` |
| Stats | `GET /api/stats/monthly/` |
| Billing | `GET /api/billing/summary/` — balance, monthly usage by format, transaction history (admin only) |
| Configs | `GET/POST/PUT/PATCH /api/configs/` |
| Webhooks | `POST /api/webhooks/clerk/` |

All endpoints require Clerk JWT authentication. Most require `IsOrgMember`; user management and billing endpoints require `IsOrgAdmin`.

---

## Testing

### Backend

```bash
docker compose exec backend python -m pytest tests/ -x -q
```

390 tests, 88% coverage. Run with `-v` for verbose output or `--cov` for coverage report.

### Frontend (unit + integration)

```bash
docker compose exec frontend npx vitest run
```

259 tests across API modules, components, and route integration tests. Uses MSW for API mocking.

### Frontend (E2E)

```bash
# Requires env vars: CLERK_SECRET_KEY, E2E_CLERK_USER_ID
docker compose exec frontend npx playwright test
```

36 E2E tests across contacts, groups, templates, schedules, send-sms, and users pages. Uses Clerk sign-in tokens for programmatic authentication and `page.route()` to mock the backend API.

---

## Clerk Configuration

1. Create an application in the [Clerk Dashboard](https://dashboard.clerk.com)
2. Enable **Organizations** in the Clerk Dashboard
3. Enable **Organization Invitations** (Organizations → Settings)
4. Configure your **Webhook** endpoint to point to `https://your-domain/api/webhooks/clerk/` and subscribe to all 9 core events: `user.created`, `user.updated`, `user.deleted`, `organization.created`, `organization.updated`, `organization.deleted`, `organizationMembership.created`, `organizationMembership.updated`, `organizationMembership.deleted`. When Clerk Billing is enabled on the corporate account, also subscribe to: `billing.subscription.created`, `billing.subscription.deleted`, `billing.payment.failed`
5. Set the **Application name** in Settings → General (appears in invitation emails)

For E2E tests, set `CLERK_SECRET_KEY` and `E2E_CLERK_USER_ID` (a test user ID in your Clerk instance).

---

## Known Gaps

These features are not yet implemented and are required before production use:

### 1. Real SMS/MMS Provider

The app currently uses `MockSMSProvider`, which logs operations but does not send real messages. To add a real provider:

- Subclass `SMSProvider` in `backend/app/utils/sms.py`
- Implement `_send_sms_impl()`, `_send_bulk_sms_impl()`, `_send_mms_impl()`
- Set `settings.SMS_PROVIDER_CLASS` to the new provider class path

### 2. Background Job Processing

Scheduled messages are saved to the `Schedule` table with a `scheduled_time`, but there is no worker to process them. Messages must currently be sent immediately via the SMS endpoints.

To implement scheduled sending, add a background task queue (Celery, Django-Q, or Huey) with a periodic task that:
- Queries pending schedules where `scheduled_time <= now`
- Sends via the SMS provider
- Updates status to `sent` or `failed`

### 3. Production Deployment

The app currently runs with Django's development server. For production:

- Add a production settings file (`production.py`) with `DEBUG=False`, secure `ALLOWED_HOSTS`, etc.
- Serve with Gunicorn or Uvicorn behind a reverse proxy
- Serve static files via Whitenoise or a CDN
- Set up a CI/CD pipeline and migration strategy

### 4. Clerk Billing Integration (active Clerk Billing account required)

The billing system is implemented. New orgs receive `FREE_CREDIT_AMOUNT` (default $10) trial credits on signup. Trial orgs are blocked when balance reaches $0. Subscribed orgs have usage tracked for metered Clerk Billing reporting. Transaction history and per-format spend are available at `GET /api/billing/summary/`.

**Remaining step:** The Clerk Billing webhook handlers (`billing.subscription.created`, `billing.subscription.deleted`, `billing.payment.failed`) are registered as stubs in `backend/app/utils/clerk.py`. The exact Clerk event type strings and payload schema must be confirmed once the corporate Clerk account has Billing enabled. Subscribe to these webhook events and verify the payload shapes match the handlers.

### 5. Migrate to Corporate Clerk Account

The current setup uses a personal/dev Clerk account. Before going to production this needs to move to the corporate account.

Steps:
- Create a new Clerk application under the corporate account at [dashboard.clerk.com](https://dashboard.clerk.com)
- Enable **Organizations** and **Organization Invitations** on the new application
- Configure the webhook endpoint and subscribe to all 9 events (see Clerk Configuration above)
- Update all four Clerk credentials across the three env files:
  - `backend/.env`: `CLERK_FRONTEND_API`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`
  - `frontend/.env`: `VITE_CLERK_PUBLISHABLE_KEY`
- Test user/org sync via webhooks end-to-end on the new account before cutover
- Set the **Application name** in Clerk Settings → General (used in invitation and sign-up emails)
- Update email templates in Clerk to match corporate branding

### 6. Remaining Clerk Production Configuration

From codebase inspection, these items need to be addressed before production:

- Set `CLERK_AUTHORIZED_PARTIES`, `CORS_ALLOWED_ORIGINS`, and `ALLOWED_HOSTS` in `backend/.env` to include the production frontend URL (all three are now env-var driven; defaults are `localhost`)
- Confirm Clerk email templates (invitation, sign-up, magic link) are correctly branded for the corporate account before sending to real users
- Configure Clerk to require verified email addresses before allowing users to be created or organisations to be joined — this prevents unverified or disposable addresses from accessing the platform (Clerk Dashboard → User & Authentication → Email, Phone, Username → enable "Require verified email address")

---

See [v1_migration.md](v1_migration.md) for v1 → v2 migration details.
