# API Specification

Base URL: `/api/v1` · JSON only · UTF-8 · versioned in the path.

## Conventions

### Success response

```json
{
  "success": true,
  "message": "Lead created successfully",
  "data": {},
  "meta": {}
}
```

### Error response

```json
{
  "success": false,
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "errors": [
    {
      "path": "email",
      "message": "Invalid email"
    }
  ],
  "requestId": "b1c2..."
}
```

Error responses use a flat structure. The `code`, `errors`, and `requestId` fields are top-level fields rather than nested under an `error` object. `errors` may be absent when there are no field-specific validation errors.

Stack traces and internal messages are never returned in production. The `X-Request-Id` response header carries the same request ID.

### Status codes

| Code | Use |
|---|---|
| 200 / 201 / 204 | OK / created / no content |
| 400 | Malformed request, or `ORGANIZATION_REQUIRED` |
| 401 | Not authenticated or token expired |
| 403 | Not permitted, `LICENSE_LIMIT_REACHED`, `FEATURE_NOT_LICENSED`, `REGISTRATION_CLOSED`, CSRF header errors |
| 404 | Not found, or belongs to another organization (existence is never revealed) |
| 409 | Conflict (duplicate, wrong state, license conflicts) |
| 422 | Validation error, `LICENSE_INVALID`, `LICENSE_EXPIRED` |
| 429 | Rate limited |
| 503 | Dependency down (`/health` degraded) or `LICENSE_NOT_CONFIGURED` |

### Auth and tenancy

- `Authorization: Bearer <accessToken>` on protected routes.
- `X-Organization-Id: <id>` selects the organization. It is a **selector only**; the server verifies active membership.
- The organization header is optional: when absent and the user has exactly one active membership, that organization is used. Otherwise the request fails with 400 `ORGANIZATION_REQUIRED`.
- Request bodies never carry `organizationId` for authorization. Unknown fields are rejected or stripped.
- `/auth/refresh` and `/auth/logout` use the httpOnly refresh cookie and require the header `X-Requested-With: EstateFlow`.

### Pagination, search and filters

`?page=1&limit=20` (default 20, max 100); sorting through a `sort` parameter per module.

```json
{
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 134,
    "totalPages": 7
  }
}
```

`?q=text` searches. Field filters are plain parameters (`?status=NEW&assignedTo=<id>`). Money is always integer minor units.

## Endpoints

Legend: permission in brackets. All `/auth` routes are public except `/auth/me` and `/auth/logout-all`, which need a bearer token. `/health` is also public.

### /health

`GET /health` (public, no sensitive data, never rate limited): 200 when MongoDB is reachable, 503 otherwise.

### /auth

| Method | Path | Description |
|---|---|---|
| GET | `/auth/setup` | **Public.** Returns `{ setupRequired }` to indicate whether first-run registration is available. Reveals no user or organization information. |
| POST | `/auth/register` | **First-run setup only.** Body `{ name, email, password, organizationName }`. Creates the first user and the organization, signs the user in (201, same shape as login plus `organization` and `membership`). 403 `REGISTRATION_CLOSED` once any user exists. |
| POST | `/auth/login` | Returns an access token and sets the refresh cookie. Body `{ email, password, remember? }`. |
| POST | `/auth/refresh` | Rotates the refresh token (cookie + CSRF header). |
| POST | `/auth/logout` | Revokes the current token family (cookie + CSRF header). |
| POST | `/auth/logout-all` | Bumps `tokenVersion`, revokes every session (bearer). |
| POST | `/auth/forgot-password` | Starts a reset (hashed, expiring token; same response whether or not the email exists). |
| POST | `/auth/reset-password` | Completes a reset. |
| GET | `/auth/me` | `{ user, organizations, current }`: the user, all memberships, and the current one with role and effective permissions. |

### /organizations

`GET /organizations` (my organizations) · GET `/organizations/:organizationId` (`org:read`) · PATCH `/organizations/:organizationId` (`org:update`) · POST `/organizations/:organizationId/switch` (`org:read`).

There is no create or delete route: an install has one organization, created by first-run setup.

### /members

`GET /members` (`members:read`). Invitations exist as a service (`createInvitation`) that enforces the license `members` limit; the invite and accept HTTP routes are not built yet.

### /leads

GET `/leads` · POST `/leads` (`leads:create`, limit `leads`) · GET `/leads/:id` · PATCH `/leads/:id` (`leads:update`) · DELETE `/leads/:id` (`leads:delete`, soft) · PATCH `/leads/:id/status` · PATCH `/leads/:id/assign` (`leads:assign`) · POST `/leads/:id/restore` (`leads:delete`, limit `leads`) · GET `/leads/:id/activities` · POST `/leads/:id/notes` (`activities:create`) · POST `/leads/:id/convert-to-contact` (`leads:convert`).

### /contacts

GET `/contacts` · GET `/contacts/tags` · POST `/contacts` · GET/PATCH/DELETE `/contacts/:id` · PATCH `/contacts/:id/assign` · POST `/contacts/:id/restore` · GET `/contacts/:id/activities` · POST `/contacts/:id/notes`.

Permissions `contacts:*`. Contacts have no license limit.

### /properties

GET `/properties` · POST `/properties` (`properties:create`, limit `properties`) · GET/PATCH/DELETE `/properties/:id` · PATCH `/properties/:id/status` · PATCH `/properties/:id/assign` (`properties:assign`) · POST `/properties/:id/images` · DELETE `/properties/:id/images/:imageId` · POST `/properties/:id/restore` (`properties:delete`, limit `properties`) · GET `/properties/:id/activities`.

### /deals

GET `/deals` · POST `/deals` (`deals:create`, limit `deals`) · GET/PATCH/DELETE `/deals/:id` · PATCH `/deals/:id/stage` · PATCH `/deals/:id/assign` (`deals:assign`) · POST `/deals/:id/close-won` · POST `/deals/:id/close-lost` · POST `/deals/:id/reopen` (`deals:reopen`) · GET `/deals/:id/activities`.

### /tasks

GET `/tasks` · GET `/tasks/calendar` · GET `/tasks/summary` · POST `/tasks` · GET/PATCH/DELETE `/tasks/:id` · PATCH `/tasks/:id/status` · PATCH `/tasks/:id/assign` · PATCH `/tasks/:id/complete` · PATCH `/tasks/:id/restore` · GET `/tasks/:id/activities`.

### /notifications

GET `/notifications` · GET `/notifications/unread-count` · PATCH `/notifications/read-all` · PATCH `/notifications/:id/read` · DELETE `/notifications/:id` · GET and PATCH `/notifications/preferences`.

### /analytics (feature `analytics`)

GET `/analytics/overview` · `/leads` · `/deals` · `/properties` · `/team` · `/tasks` · `/revenue` · `/trends`.

All need `analytics:read`; some also need the module's read permission or `analytics:team`.

Metric definitions: `ANALYTICS_METRICS.md`.

Without the feature: 403 `FEATURE_NOT_LICENSED`.

### /reports

GET `/reports` (catalog, `reports:read`) · GET `/reports/:reportId` (run) · GET `/reports/:reportId/export` (`reports:read` + `reports:export`, feature `csvExport`, CSV).

Report ids:

- `lead-performance`
- `deal-pipeline`
- `won-lost-deals`
- `property-inventory`
- `lead-source`
- `agent-performance` (team only)
- `task-productivity`
- `sales-performance`

### /automations

GET `/automations` · POST `/automations` (feature `automations`) · GET/PATCH/DELETE `/automations/:workflowId` · POST `.../activate` (feature `automations`) · POST `.../pause` · POST `.../test` (feature `automations`) · GET `.../executions` · GET `.../executions/:executionId` · POST `.../executions/:executionId/retry` (feature `automations`).

Activating a workflow with an email action also needs the license feature `advancedNotifications` and a configured email provider.

### /licenses

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/licenses/status` | `org:read` (any member) | `{ state, edition, features, limits, validUntil, graceEndsAt, usage }` |
| GET | `/licenses/current` | `license:read` (OWNER) | Full overview: license details, features, limits and usage rows. |
| POST | `/licenses/activate` | `license:manage` (OWNER) | Body `{ licenseKey }`. Verifies offline, returns the overview. |
| POST | `/licenses/deactivate` | `license:manage` (OWNER) | Turns the license off. 409 `LICENSE_NOT_ACTIVE` if none. |

Overview shape (never contains the key or its hash):

```json
{
  "configured": true,
  "state": "ACTIVE",
  "edition": "PROFESSIONAL",
  "features": {
    "analytics": true,
    "csvExport": true,
    "automations": true,
    "advancedNotifications": true
  },
  "limits": {
    "members": 15,
    "leads": 5000,
    "properties": 2500,
    "deals": 2000
  },
  "validUntil": "2027-11-25T00:00:00.000Z",
  "graceEndsAt": "2027-12-09T00:00:00.000Z",
  "license": {
    "licensee": "Awan Properties",
    "keyLast4": "7K2Q",
    "issuedAt": "...",
    "activatedAt": "...",
    "expiresAt": "...",
    "status": "ACTIVE"
  },
  "usage": [
    {
      "key": "leads",
      "used": 120,
      "limit": 5000,
      "remaining": 4880,
      "atLimit": false,
      "overLimit": false
    }
  ]
}
```

A `null` limit means unlimited.

### Validation

Each route declares Zod schemas for params, query and body in `*.validation.ts`.