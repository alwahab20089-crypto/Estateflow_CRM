# Self-Hosted Edition

## Principle
EstateFlow is distributed as a self-hosted product. The customer runs it with Docker Compose on their own
infrastructure under a license. There is no hosted SaaS edition, no subscriptions, no payment provider, no
platform admin and no deployment-mode switch: there is one build.

All licensing code lives in `apps/api/src/modules/licensing/`. CRM modules depend only on its two entry points:

| Entry point | File | Used for |
|---|---|---|
| `requireFeature(feature)` | `entitlements.middleware.ts` | Route guard for licensed features |
| `enforceLimit(key)` | `entitlements.middleware.ts` | Route guard on routes that create counted records |
| `assertWithinLimit`, `assertFeature`, `hasFeature` | `entitlements.service.ts` | Service-level checks (invitations, automation engine) |

The only code that knows where entitlements come from is `licenseEntitlementSource`. Tests replace it with
`registerEntitlementSource`.

## Tenancy and registration
- One organization per install. There is no `POST /organizations`.
- `POST /auth/register` is first-run setup. It creates the first user and the organization, and returns
  403 `REGISTRATION_CLOSED` once any user exists.
- Everyone else joins through invitations.
- `X-Organization-Id` is optional. When it is absent and the user has exactly one active membership, that
  organization is used.
- The data model stays scoped by `organizationId`, so isolation rules do not depend on the one-organization policy.

## Licensing
- **Offline signed keys.** A key is `EF1.<payload>.<signature>`. The vendor signs it with an Ed25519 PRIVATE key
  that never ships. Every install holds only the PUBLIC key (`LICENSE_PUBLIC_KEY`). No license server and no network
  call are needed, on activation or on any request.
- The customer receives a key at purchase. After first-run setup the OWNER pastes it (`POST /licenses/activate`).
  The server verifies the signature, stores `sha256(key)` and the key's last 4 characters (never the key), and copies the
  license's edition, features and limits into the `licenses` collection.
- A license carries: licensee, edition (STANDARD, PROFESSIONAL, AGENCY), features, limits, issue date, and an end date
  (none for a perpetual license).
- **One ACTIVE license per organization**, enforced by a partial unique index. Activating a new key deactivates the
  previous one. The same key cannot be used by two organizations. Deactivating (`POST /licenses/deactivate`) turns the
  license off; pasting the same key again turns it back on.
- Pasted keys are normalized (all whitespace removed) before verification and hashing.
- Verification failures return one generic message (`LICENSE_INVALID`); the caller never learns which check failed.

### States
| State | Meaning | Behavior |
|---|---|---|
| NONE | No license has ever been activated | Restricted |
| ACTIVE | License valid (or perpetual) | Licensed features and limits apply |
| GRACE | End date passed, still inside `LICENSE_GRACE_DAYS` (default 14) | Same as ACTIVE; the UI warns |
| EXPIRED | Past the grace period | Restricted |
| INACTIVE | Deactivated by the owner | Restricted |
| REVOKED | Marked revoked | Restricted |

The end date is checked on every read, so a stale ACTIVE row can never grant access forever.

### Enforcement (server side only)
- **Limits** (`members`, `leads`, `properties`, `deals`) are HARD ON CREATE. Reaching a limit blocks creating more.
  It never deletes, hides or locks existing data. A limit of `null` means unlimited; a missing limit means 0.
  - `members` counts active memberships plus pending, unexpired invitations.
  - `leads`, `properties`, `deals` count every record that is not soft-deleted. Closed (won, lost, sold) records
    still count, so reopening can never bypass a limit.
  - Restoring a soft-deleted lead or property counts as creating one.
  - Check-then-create is serialized per organization by a short MongoDB lease lock (`usagelocks`), so the limit is
    exact even with several API instances.
- **Features** gate their routes:

| Feature | Gates |
|---|---|
| `analytics` | every `/analytics/*` route |
| `csvExport` | `GET /reports/:reportId/export` |
| `automations` | create, activate, test and retry; the engine also runs no workflows without it |
| `advancedNotifications` | activating a workflow that has an email action |

  Pausing and deleting automations always stays available, so a lapsed license can always turn them off.
- **Restricted** (no license, expired, deactivated, revoked): everything stays readable, nothing new can be created,
  and no licensed feature is available. To give unlicensed installs small starter limits, edit
  `RESTRICTED_ENTITLEMENTS` in `license.catalog.ts`.
- Hiding a button in the UI is never the restriction; the server is the authority.

### Errors
| HTTP | Code | When |
|---|---|---|
| 403 | `LICENSE_LIMIT_REACHED` | A create would exceed a limit |
| 403 | `FEATURE_NOT_LICENSED` | The license does not include the feature |
| 422 | `LICENSE_INVALID` | Bad signature, format or payload |
| 422 | `LICENSE_EXPIRED` | The key is already past its grace period |
| 409 | `LICENSE_ALREADY_USED` | The key is active in another organization |
| 409 | `LICENSE_REVOKED` | The key was revoked |
| 409 | `LICENSE_NOT_ACTIVE` | Deactivate was called with no active license |
| 503 | `LICENSE_NOT_CONFIGURED` | `LICENSE_PUBLIC_KEY` is not set |
| 403 | `REGISTRATION_CLOSED` | First-run registration was already done |

### Permissions
`license:read` and `license:manage` belong to OWNER only. ADMIN is excluded. `GET /licenses/status` needs only
`org:read`, so every member can read it (it drives the banner and disabled buttons).

### Editions
`EDITION_PRESETS` in `license.catalog.ts` are PLACEHOLDER numbers used by the vendor tool. Decide real editions
before selling. A license carries its own copy of features and limits, so changing the presets never affects keys
already issued.

## Issuing keys (vendor only)
Run on your own machine. Never commit or ship the private key.
```
cd apps/api
npm run license -- keygen --out ../../license-keys
npm run license -- issue --private-key ../../license-keys/license-private.pem \
    --licensee "Awan Properties" --edition PROFESSIONAL --days 365
npm run license -- issue ... --perpetual
npm run license -- inspect --public-key ../../license-keys/license-public.pem --key "EF1...."
```
Put the contents of `license-public.pem` into `LICENSE_PUBLIC_KEY` on every install.

## Honest limits
License checks in self-hosted software can be bypassed by a determined user who edits the code or the database. A key
is not bound to a machine. The design aims for reasonable protection (signed keys, server-side checks, audit entries),
not DRM. Set expectations commercially.

## Docker Compose production deployment

EstateFlow includes a documented production Docker Compose deployment for self-hosted installations.

The deployment consists of three services:

| Service | Purpose |
|---|---|
| `web` | Nginx serving the production frontend build |
| `api` | Node.js and Express backend |
| `mongo` | MongoDB with a single-node replica set and persistent storage |

### Configuration

Production configuration is supplied through a `.env` file. Configure all required environment variables before starting the services.

Keep production secrets outside version control. Do not expose MongoDB publicly.

### First run

1. Start the production Docker Compose services.
2. Wait for the database and API health checks to pass.
3. Open the application through its configured domain.
4. Create the first owner account.
5. Sign in and activate the installation using the license key supplied by the vendor.

Registration closes automatically after the first user is created.

### HTTPS

Use HTTPS for production access. Configure the reverse proxy and TLS certificates according to the production deployment instructions.

Do not expose the API or MongoDB directly to the public internet unless explicitly required and properly secured.

### Backups and restoration

Back up MongoDB data regularly and store backups outside the application server.

Before restoring:

1. Stop application writes.
2. Restore the database using the documented MongoDB backup procedure.
3. Verify database and replica-set health.
4. Restart the application services.
5. Verify login, CRM records and file uploads.

Database backups and uploaded files should be backed up separately.

### Upgrades

1. Back up the database and uploaded files.
2. Review the release notes and configuration changes.
3. Pull or build the updated application images.
4. Apply any required database migrations.
5. Restart the production services.
6. Verify health checks and essential application workflows.

Do not remove persistent Docker volumes during upgrades.

**Deployment verification status:** Phase 10c deployment instructions are written. Production images have not yet been built and run, so a successful end-to-end production deployment has not yet been verified.

See the repository README for development setup and `docs/DEVELOPMENT_ROADMAP.md` for implementation status.