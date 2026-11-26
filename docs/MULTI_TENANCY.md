# Multi-Tenancy

## Strategy
Shared database, shared collections, discriminated by `organizationId`. The data model supports many organizations per
install, but a self-hosted install has exactly one (created by first-run setup). Isolation rules are enforced the same
way regardless, so they never depend on that policy.

## Tenant resolution
1. `authenticate` verifies the JWT and loads `req.auth = { userId, tokenVersion }`.
2. `resolveOrganization('header')` reads `X-Organization-Id`. When the header is absent and the user has exactly one
   active membership, that organization is used; otherwise it fails with 400 `ORGANIZATION_REQUIRED`. A malformed or
   unknown id gives 404, the same as "not a member".
3. `requireMembership` checks `OrganizationMember { organizationId, userId, status: ACTIVE, invitationStatus: ACCEPTED }`.
   No membership returns **404** (the organization's existence is not disclosed).
4. The result is attached as `req.tenant = { organizationId, role, permissions }`. This is the **only** source of
   `organizationId` for downstream code.

```mermaid
flowchart LR
  R[Request] --> RC[request context] --> SEC[helmet, cors, rate limit] --> BP[body parser]
  BP --> AU[authenticate] --> RO[resolveOrganization] --> MB[requireMembership]
  MB --> AZ[authorize] --> EN[requireFeature / enforceLimit] --> V[validate] --> C[controller] --> S[service]
  S --> E[errorHandler]
```
Order rationale: cheap rejections first; entitlements are per tenant, so they run after membership. On most routes
`authorize` runs before `requireFeature` or `enforceLimit`, so a user without permission learns nothing about the license;
`/analytics` gates the whole router on the feature first.

## Enforcement rules
1. Services take the tenant as an explicit argument. They never read `organizationId` from request bodies.
2. Every query on org-owned data includes `organizationId`. `findById`, update and delete use `{ _id, organizationId }` (prevents IDOR).
3. IDs referenced in a payload (`assignedTo`, `ownerContactId`, `contactId`, `propertyId`, related ids) are re-verified to belong to the same organization.
4. Body schemas are strict or strip unknown keys, which prevents mass assignment of `organizationId`, `role` and `createdBy`.
5. Aggregations start with `$match: { organizationId }`.
6. Background workers (reminders, automations) carry `organizationId` explicitly and use the same scoping. Automation actions run with the workflow's organization, never another.
7. File storage keys are prefixed per organization; downloads are authorized.
8. Cache keys include `organizationId` (the entitlement cache is keyed per organization).
9. Licenses belong to one organization. A key active in one organization cannot be activated in another.

## Testing requirements
- Every org-scoped route has a test that a user from organization A gets 404 for organization B's resource id.
- Tests for mass assignment (`organizationId` in a body is ignored).
- Tests for cross-organization reference injection (`assignedTo` of another organization returns 422).
- License tests prove one organization's license never grants another organization access.