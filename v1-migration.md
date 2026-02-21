# V1 Migration Notes

## Database Schema Changes

### Overview

The v1 app used Prisma (Node.js) with PostgreSQL. The v2 app uses Django ORM with PostgreSQL. The schema has been restructured for multi-tenancy and to reduce duplication.

### Model Renames

| Prisma (v1) | Django (v2) | Reason |
|---|---|---|
| `Customer` | `Contact` | Distinguish external message recipients from app users |
| `CustomerGroup` | `ContactGroup` | Consistent with Contact rename |
| `CustomerGroupMember` | `ContactGroupMember` | Consistent with Contact rename |
| `GroupSchedule` + `Schedule` | `Schedule` | Merged into single model (see below) |

### Multi-Tenancy Additions

v1 had no multi-tenancy. v2 adds organisation-scoped data isolation:

- **`TenantModel`** abstract base class adds an `organisation` FK to all business models
- **`Organisation`** model synced from Clerk via webhooks
- **`OrganisationMembership`** links users to organisations with roles
- All queries scoped by organisation via `TenantScopedMixin`
- Unique constraints scoped per org (e.g. `Contact.phone` unique per org, not globally)

Models inheriting `TenantModel`: Contact, ContactGroup, Template, Schedule, Config

### Auth Changes

| Aspect | v1 (Prisma) | v2 (Django) |
|---|---|---|
| Identity provider | Azure AD (`azureId`) | Clerk (`clerk_id`) |
| User model | Custom `User` with `firstName`, `lastName`, `email`, `azureId` | Django `AbstractUser` with `clerk_id` |
| Auth method | Azure AD tokens | Clerk JWT via `ClerkJWTAuthentication` |

### Structural Changes

#### AuditMixin

v1 had `createdById`/`updatedById` FKs and `createdAt`/`updatedAt` timestamps on each model individually. v2 centralises these into an abstract `AuditMixin`:

- `created_by` (FK to User)
- `updated_by` (FK to User)
- `created_at` (auto_now_add)
- `updated_at` (auto_now)

Models using `AuditMixin`: Contact, ContactGroup, Template, Schedule

#### GroupSchedule + Schedule Merged

v1 had two separate models:
- `GroupSchedule` — batch job targeting a ContactGroup
- `Schedule` — individual message to one recipient, with a `groupScheduleId` FK

v2 merges these into a single `Schedule` model:
- Batch schedules have `group` set and a `name`
- Individual schedules have `contact`/`phone` set
- Child schedules link to their batch parent via `parent` (self-referential FK), replacing the old `groupScheduleId`

#### TextChoices Enums

v1 used plain strings for `status` and `format` fields. v2 uses Django `TextChoices`:
- `ScheduleStatus`: pending, processing, sent, failed, cancelled
- `MessageFormat`: sms, mms

### Field-Level Differences

#### Contact (was Customer)

| Change | Detail |
|---|---|
| Added | `organisation` FK (multi-tenancy) |
| Added | `created_by`, `updated_by`, `created_at`, `updated_at` (via AuditMixin) |
| Renamed | `firstName` -> `first_name`, `lastName` -> `last_name`, `optOut` -> `opt_out` |
| Renamed | `active` -> `is_active` |
| Changed | `email` unique constraint scoped to org: `unique_together = ('organisation', 'phone')` |
| Kept | `user` FK (assigned rep, was `userId`) |
| Removed | Direct `User` relation (was `User? @relation`) — replaced by `user` FK |

#### ContactGroup (was CustomerGroup)

| Change | Detail |
|---|---|
| Added | `organisation` FK |
| Renamed | `active` -> `is_active` |

#### ContactGroupMember (was CustomerGroupMember)

| Change | Detail |
|---|---|
| No `organisation` FK | Tenancy inherited through Contact and ContactGroup FKs |
| Renamed | `customerId`/`groupId` -> `contact`/`group` |

#### Template

| Change | Detail |
|---|---|
| Added | `organisation` FK |
| Renamed | `active` -> `is_active` |
| Removed | `@@unique([id, version])` — redundant since `id` is already unique |

#### Schedule

| Change | Detail |
|---|---|
| Added | `organisation` FK |
| Added | `name` (from GroupSchedule, for batch schedules) |
| Added | `parent` self-FK (replaces `groupScheduleId`) |
| Removed | `groupScheduleId` FK (replaced by `parent`) |
| Changed | `status` uses `ScheduleStatus` TextChoices |
| Changed | `format` uses `MessageFormat` TextChoices |
| Renamed | `customerId` -> `contact`, `groupId` -> `group`, `templateId` -> `template` |
| Renamed | `scheduledTime` -> `scheduled_time`, `sentTime` -> `sent_time`, `mediaUrl` -> `media_url`, `messageParts` -> `message_parts` |

#### Config

| Change | Detail |
|---|---|
| Added | `organisation` FK |
| Added | `unique_together = ('organisation', 'name')` — one config per name per org |

---

## API Surface Changes

### Base Path

Both versions use `/api/` as the base path.

### Auth

| Aspect | v1 | v2 |
|---|---|---|
| Middleware | `authenticateAzureAD` on all `/api` routes | `ClerkJWTAuthentication` (DRF default) + `ClerkTenantMiddleware` |
| Org context | None (single-tenant) | `org_id`, `org`, `org_role`, `org_permissions` set on request from Clerk JWT |
| Permissions | None beyond auth | `IsOrgMember` on all CRUD endpoints; `IsOrgAdmin` and `HasOrgPermission` available |

### Endpoint Mapping

#### Contacts (was Customers)

| v1 | v2 | Notes |
|---|---|---|
| `GET /api/customers` | `GET /api/contacts/` | |
| `GET /api/customers/:id` | `GET /api/contacts/:id/` | |
| `POST /api/customers` | `POST /api/contacts/` | |
| `PUT /api/customers/:id` | `PUT /api/contacts/:id/` | |
| — | `PATCH /api/contacts/:id/` | New — partial update |
| `GET /api/customers/:id/schedules` | `GET /api/contacts/:id/schedules/` | |
| `POST /api/customers/import-customers` | `POST /api/contacts/import/` | CSV columns: `first_name`, `last_name`, `phone` |

**Filter changes:**

| Filter | v1 | v2 |
|---|---|---|
| Search | `?search=` (first/last name, phone if digits) | `?search=` (same logic) |
| Exclude group | `?excludeGroupId=` | `?exclude_group_id=` (snake_case) |
| Default limit | Last 30 days or top 100 | Paginated (50 per page) |

#### Groups (was Groups)

| v1 | v2 | Notes |
|---|---|---|
| `GET /api/groups` | `GET /api/groups/` | |
| `GET /api/groups/:id` | `GET /api/groups/:id/` | Response includes paginated `members` |
| `POST /api/groups` | `POST /api/groups/` | Accepts optional `member_ids` to add members on create |
| `PUT /api/groups/:id` | `PUT /api/groups/:id/` | |
| `DELETE /api/groups/:id` | `DELETE /api/groups/:id/` | |
| `POST /api/groups/:id/customers` | `POST /api/groups/:id/members/` | Path changed from `customers` to `members` |
| `DELETE /api/groups/:id/customers` | `DELETE /api/groups/:id/members/` | Path changed from `customers` to `members` |
| — | `PATCH /api/groups/:id/` | New — partial update |

**Filter changes:**

| Filter | v1 | v2 |
|---|---|---|
| Search | `?search=` (name, min 2 chars) | `?search=` (same) |

#### Templates

| v1 | v2 | Notes |
|---|---|---|
| `GET /api/templates` | `GET /api/templates/` | Both filter `active=true` / `is_active=True` |
| `GET /api/templates/:id` | `GET /api/templates/:id/` | |
| `POST /api/templates` | `POST /api/templates/` | |
| `PUT /api/templates/:id` | `PUT /api/templates/:id/` | |
| — | `PATCH /api/templates/:id/` | New — partial update |

No filters on either version.

#### Schedules

| v1 | v2 | Notes |
|---|---|---|
| `GET /api/schedules` | `GET /api/schedules/` | v1 excluded `DELETED`, v2 excludes `CANCELLED` |
| `GET /api/schedules/:id` | `GET /api/schedules/:id/` | |
| `POST /api/schedules` | `POST /api/schedules/` | |
| `PUT /api/schedules/:id` | `PUT /api/schedules/:id/` | Only pending schedules can be updated |
| — | `PATCH /api/schedules/:id/` | New — partial update |

**Filter changes:**

| Filter | v1 | v2 |
|---|---|---|
| Date | `?date=YYYY-MM-DD` (defaults to today, Adelaide tz) | `?date=YYYY-MM-DD` (defaults to today, Adelaide tz). Override tz with `?tz=` |

#### Group Schedules

| v1 | v2 | Notes |
|---|---|---|
| `GET /api/group-schedules` | `GET /api/group-schedules/` | |
| `GET /api/group-schedules/:id` | `GET /api/group-schedules/:id/` | Children returned in `schedules` array |
| `POST /api/group-schedules` | `POST /api/group-schedules/` | |
| `PUT /api/group-schedules/:id` | `PUT /api/group-schedules/:id/` | Propagates changes to pending children |
| `DELETE /api/group-schedules/:id` | `DELETE /api/group-schedules/:id/` | Cancels parent + pending children |

**Filter changes:**

| Filter | v1 | v2 |
|---|---|---|
| Date | `?date=YYYY-MM-DD` | `?date=YYYY-MM-DD` |
| Group | `?groupId=` | `?group_id=` (snake_case) |

#### Users

| v1 | v2 | Notes |
|---|---|---|
| `GET /api/users` | `GET /api/users/` | Scoped to org members in v2 |
| `GET /api/users/:id` | `GET /api/users/:id/` | |
| — | `GET /api/users/me/` | Replaces old `/api/me/` — returns authenticated user + org context |

#### Stats

| v1 | v2 | Notes |
|---|---|---|
| `GET /api/stats/monthly` | `GET /api/stats/monthly/` | Scoped to org in v2; response keys use snake_case (`sms_sent` not `smsSent`) |

#### SMS/MMS

| v1 | v2 | Notes |
|---|---|---|
| `POST /api/sms/send` | `POST /api/sms/send/` | Uses pluggable provider (MockSMSProvider by default) |
| `POST /api/sms/send-to-group` | `POST /api/sms/send-to-group/` | Creates parent + child schedules |
| `POST /api/sms/send-mms` | `POST /api/sms/send-mms/` | Uses same provider abstraction |
| `POST /api/sms/upload-file` | `POST /api/sms/upload-file/` | Stub — returns 501 (file storage not configured) |

**Provider Abstraction (New in v2):**

v1 had direct provider calls (Mobile Message API, AWS Pinpoint, MessageMedia) scattered throughout the service layer. v2 abstracts all SMS/MMS logic behind a pluggable provider interface:

- **Base class:** `SMSProvider` (abstract) in `backend/app/utils/sms.py`
- **Methods:** `send_sms()`, `send_bulk_sms()`, `send_mms()`
- **Configuration:** `settings.SMS_PROVIDER_CLASS` (default: `'app.utils.sms.MockSMSProvider'`)
- **Mock provider:** Logs operations, always returns success, doesn't send real messages
- **Future providers:** Twilio, MessageMedia, AWS Pinpoint can be implemented by subclassing `SMSProvider`

**Phone Validation:**
- Both v1 and v2 accept `04XXXXXXXX` or `+614XXXXXXXX` formats
- v2 normalizes all phones to `04XXXXXXXX` format before storing
- Validation happens in provider base class (reusable across all providers)

**Message Parts Calculation (Fixed in v2):**

| Aspect | v1 | v2 |
|---|---|---|
| Logic | `message.length > 160 ? 2 : 1` | `length <= 160 ? 1 : Math.ceil(length / 153)` |
| Accuracy | ❌ Caps at 2 parts (incorrect for 307+ char messages) | ✅ Accurate calculation accounting for SMS headers |
| Location | Calculated in views | Calculated in provider, returned in result |

v2 correctly accounts for the 7-byte header in concatenated SMS (153 chars per part instead of 160).

**Limit Checking:**

| Aspect | v1 | v2 |
|---|---|---|
| Implementation | Inline in each endpoint | Extracted to `check_sms_limit()` / `check_mms_limit()` in `app/utils/limits.py` |
| Config source | `Config` table | Same (`Config` table) |
| Timezone | Adelaide (hardcoded) | Adelaide (hardcoded in limit checker) |
| Error handling | `try/catch` with custom responses | Raises `ValidationError` (DRF handles 400 response) |

**Request/Response Differences:**

**Send SMS:**
```javascript
// v1 request (camelCase)
{ message, recipient, contactId }

// v2 request (snake_case)
{ message, recipient, contact_id }
```

**Send to Group:**
```javascript
// v1 response
{
  success: true,
  message: "...",
  results: { successful, failed, total },
  groupName,
  groupScheduleId
}

// v2 response (snake_case)
{
  success: true,
  message: "...",
  results: { successful, failed, total },
  group_name,
  group_schedule_id
}
```

**Send MMS:**
```javascript
// v1 request
{ message, mediaUrl, recipient, contactId, subject }

// v2 request
{ message, media_url, recipient, contact_id, subject }
```

**Error Handling Improvements:**

v2 uses DRF exceptions consistently instead of mixing exception handling:
- Organization validation: Raises `ValidationError` (400)
- Contact/Group not found: Raises `NotFound` (404)
- Limit exceeded: `check_sms_limit()` raises `ValidationError` (400)
- No try/except blocks needed — DRF handles exception → HTTP response mapping

**Storage Backend:**

| Aspect | v1 | v2 |
|---|---|---|
| File storage | Azure Blob Storage (for MMS media) | Not yet implemented — stub returns 501 |
| Upload endpoint | Functional | Validates file (PNG/JPEG/GIF, <400KB) but returns "File storage not configured" |

#### Not Yet Migrated

No remaining endpoints — all v1 API surface has been migrated!

#### New in v2

| Endpoint | Purpose |
|---|---|
| `POST /api/webhooks/clerk/` | Clerk webhook receiver (user/org sync) |
| `GET/POST/PUT/PATCH /api/configs/` | Config CRUD (was not exposed in v1) |

### Pagination

| Aspect | v1 | v2 |
|---|---|---|
| Query params | `?page=1&limit=50` | `?page=1&limit=50` (same) |
| Default page size | 50 (schedules), 10 (others) | 50 (all endpoints) |
| Max page size | 50 | 50 |
| Response format | `{ data, pagination: { total, page, limit, totalPages, hasNext, hasPrev } }` | `{ results, pagination: { total, page, limit, totalPages, hasNext, hasPrev } }` |
| Key difference | Top-level key is `data` | Top-level key is `results` |

### Request/Response Conventions

| Aspect | v1 | v2 |
|---|---|---|
| Field casing | camelCase (`firstName`, `scheduledTime`) | snake_case (`first_name`, `scheduled_time`) |
| Trailing slashes | No (`/api/contacts`) | Yes (`/api/contacts/`) |
| Error format | `{ error: "message" }` | `{ detail: "message" }` (DRF convention) |
| Validation errors | `{ errors: [...] }` | `{ field_name: ["error"] }` (DRF convention) |
| Status soft-delete | `DELETED` status | `CANCELLED` status + `is_active` field |
| HTTP methods | GET, POST, PUT | GET, POST, PUT, PATCH |
| Security headers | Helmet middleware (CSP, HSTS, X-Frame-Options, etc.) | Skipped — pure JSON API, no HTML rendered by backend |
