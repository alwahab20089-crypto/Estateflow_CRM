# Self-Hosted Edition

## Principle
EstateFlow is distributed as a self-hosted product. The customer runs it with Docker Compose on their
own infrastructure under a license. There is no hosted SaaS edition, no subscriptions and no payment
provider. CRM modules never talk to licensing directly; they call the `EntitlementProvider` interface.

| Concern | Interface | Implementation |
|---|---|---|
| Entitlements and limits | `EntitlementProvider` | `LicenseEntitlementProvider` |
| Routes | `licensing/index.ts` | `/licenses` |

## Tenancy and registration
- One organization per install. `POST /organizations` does not exist.
- `POST /auth/register` is first-run setup: it creates the first user and the organization and returns
  403 `REGISTRATION_CLOSED` once any user exists.
- Everyone else joins through invitations.
- `X-Organization-Id` is optional; when absent, the user's single organization is used.
- The data model stays scoped by `organizationId`, so isolation rules do not depend on the one-organization policy.

## Licensing
- The customer receives a license key at purchase. After first-run setup, the OWNER activates it.
- **Activation:** `POST /licenses/activate` sends key + instance fingerprint to the license service
  (or validates a signed license file offline). The server stores `sha256(key)`, never the key.
- **Validation:** periodic check (e.g., daily) updates `lastValidatedAt`.
- **Offline grace:** if validation can't reach the license server, the app continues until
  `offlineGraceUntil` (e.g., 14 days), then enters read-only mode with a clear message.
- **Limits:** `maxUsers` is enforced when inviting or accepting members; edition controls feature flags.
- **Expiry:** status EXPIRED means read-only with export still allowed. Data stays accessible to the customer.
- The license module is replaceable. Only `LicenseEntitlementProvider` depends on it.
- Honest note: license checks in self-hosted software can be bypassed by determined users. The design aims
  for reasonable protection (signed licenses, server-side checks), not DRM.

## Docker Compose (target)
Services: `web` (nginx serving the build), `api`, `mongo` (with volume). Config via `.env`.
Healthchecks on all services; `mongo` not exposed publicly; first-run setup flow.

## Configuration
| Variable | Purpose |
|---|---|
| `LICENSE_SERVER_URL` | License service used for activation and periodic validation |
| `LICENSE_PUBLIC_KEY` | Verifies signed licenses offline |