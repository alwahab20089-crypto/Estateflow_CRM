# API Specification

Base URL: `/api/v1` · JSON only · UTF-8 · versioned in the path.

## Conventions

### Success response
```json
{ "success": true, "message": "Lead created successfully", "data": {}, "meta": {} }
```

### Error response
```json
{
  "success": false,
  "message": "Validation failed",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [{ "path": "email", "message": "Invalid email" }],
    "requestId": "b1c2..."
  }
}
```
Stack traces and internal messages are never returned in production.

### Status codes
| Code | Use |
|---|---|
| 200 | OK |
| 201 | Created |
| 204 | No content (delete, logout) |
| 400 | Malformed request |
| 401 | Not authenticated / token expired |
| 402 | License limit or feature not entitled (`code: ENTITLEMENT_REQUIRED`) |
| 403 | Authenticated but not permitted |
| 404 | Not found **or** belongs to another tenant (never reveal existence) |
| 409 | Conflict (duplicate, version) |
| 422 | Validation error |
| 429 | Rate limited |
| 500 | Unexpected error |

### Auth and tenancy
- `Authorization: Bearer <accessToken>` on protected routes.
- `X-Organization-Id: <id>` selects the active organization. It is a **selector only**; the
  server verifies active membership. It is required on organization-scoped routes.
- Request bodies never carry `organizationId` for authorization; unknown fields are stripped.

### Pagination
`?page=1&limit=20` (default 20, max 100); sorting `?sort=-createdAt`.
```json
"meta": { "page": 1, "limit": 20, "total": 134, "totalPages": 7 }
```
### Search and filters
`?q=text` for search; field filters as plain params (`?status=NEW&assignedTo=<id>`);
ranges `?priceMin=&priceMax=`; dates `?createdFrom=&createdTo=` (ISO 8601). Unknown filters return 422.

## Endpoints

Legend: **A** = auth required, **O** = org context required, permission shown in brackets.

### /auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /auth/register | public | First-run setup only: creates the first user and the organization. Returns 403 `REGISTRATION_CLOSED` once any user exists |
| POST | /auth/login | public | Returns access token, sets refresh cookie |
| POST | /auth/refresh | cookie | Rotates refresh token |
| POST | /auth/logout | A | Revokes current token family |
| POST | /auth/logout-all | A | Bumps `tokenVersion`, revokes all |
| POST | /auth/forgot-password, /reset-password | public | Reset flow (hashed, expiring token) |
| POST | /auth/verify-email | public | Email verification |

### /users
GET `/users/me` (A) · PATCH `/users/me` (A) · POST `/users/me/change-password` (A) · DELETE `/users/me` (A, anonymizes account; blocked if sole OWNER)

### /organizations
GET `/organizations` (A, mine) · GET `/organizations/current` (A,O) ·
PATCH `/organizations/current` (A,O `org:update`) · DELETE `/organizations/current` (A,O OWNER only)

### /members
GET `/members` (`members:read`) · POST `/members/invitations` (`members:invite`) ·
POST `/members/invitations/accept` (A) · DELETE `/members/invitations/:id` (`members:invite`) ·
PATCH `/members/:id` (`members:update`; role/permissions) · DELETE `/members/:id` (`members:remove`) ·
POST `/members/transfer-ownership` (OWNER)

### /leads
GET `/leads` (`leads:read`) · POST `/leads` (`leads:create`) · GET `/leads/:id` · PATCH `/leads/:id` (`leads:update`) ·
DELETE `/leads/:id` (`leads:delete`, soft) · PATCH `/leads/:id/status` · PATCH `/leads/:id/assign` (`leads:assign`) ·
POST `/leads/:id/convert` (creates contact) · GET `/leads/:id/activities`
Agents see only leads assigned to them unless granted `leads:read_all`.

### /contacts, /properties, /tasks
Standard CRUD: `GET /`, `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id` with permissions
`contacts:*`, `properties:*`, `tasks:*`. Extras: PATCH `/properties/:id/status`,
POST `/properties/:id/images`, PATCH `/tasks/:id/complete`.

### /activities
GET `/activities?entityType=&entityId=` (`activities:read`) · POST `/activities` (`activities:create`).
No update/delete (append-only).

### /notifications
GET `/notifications` · PATCH `/notifications/:id/read` · POST `/notifications/read-all`

### /analytics
GET `/analytics/overview` · `/analytics/pipeline` · `/analytics/lead-sources` · `/analytics/agent-performance`
(permission `analytics:read`; MANAGER and above by default)

### /licenses
GET `/licenses/current` (`license:read`) · POST `/licenses/activate` (OWNER) · POST `/licenses/validate` (OWNER) ·
DELETE `/licenses/current` (OWNER, deactivate)

### System
GET `/health` (public, no sensitive data) · GET `/system/config` (public, UI-only info)

## Validation
Each route declares Zod schemas for `params`, `query`, and `body` in `*.validators.ts`; schemas
come from `packages/shared` where the frontend also uses them.