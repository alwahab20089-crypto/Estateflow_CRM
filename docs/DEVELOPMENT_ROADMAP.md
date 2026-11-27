# Development Roadmap

| Phase | Goal | Status |
|---|---|---|
| 1 | Planning and architecture documents | Done |
| 2 | Foundation: monorepo, TypeScript, tooling, API bootstrap, env validation, database, error handling, health | Done |
| 3 | Auth and tenancy: users, organizations, members, invitations, JWT with refresh rotation, middleware chain, audit | Done |
| 4-7 | CRM core and web app: leads, contacts, properties, deals, tasks, activities, React application | Done |
| 8 | Analytics and reports (API and web) | Done |
| 9 | Notifications and workflow automation (API and web) | Done |
| 10 | Commercial features and self-hosted packaging | API and web implementation done; Docker deployment documented; image build and runtime verification pending |
| 11 | Hardening and release: security review, load testing, backups, CI/CD, user documentation | Planned |

## Phase 10 breakdown

| Step | Content | Status |
|---|---|---|
| 10a API | Signed offline licenses, entitlements, limit and feature enforcement, `/licenses` routes, vendor key tool, first-run-only registration | Done |
| 10b Web | License settings page, expiry and grace banner, disabled actions at a limit or without a feature, first-run setup screen, license error handling | Done |
| 10c Docker | Dockerfiles for `api` and `web`, production Docker Compose configuration with MongoDB replica set and persistent volume, healthchecks, production environment example, deployment documentation | Written; images not yet built or run |

## Phase gates

Each phase ends with passing tests, updated documentation, and zero known cross-tenant leakage.

A phase marked as documented is not considered runtime-verified until its implementation has been built and tested.

## Risks and decisions

- Offline license enforcement is bypassable; set expectations commercially. Keys are not machine-bound.
- Edition presets (`EDITION_PRESETS`) are placeholders until pricing is decided.
- A fresh install is restricted until a license is activated; change `RESTRICTED_ENTITLEMENTS` for starter limits.
- MongoDB transactions need a replica set; Docker Compose must run MongoDB as a single-node replica set.
- The invitation HTTP routes (invite, accept) are not built yet; `createInvitation` already enforces the member limit.
- The `platformRole` field on users is legacy and unused by the self-hosted edition.
- Production Docker images and the complete deployment workflow still require build and runtime verification.

## Remaining Phase 10c work

- [ ] Build the production API Docker image.
- [ ] Build the production web Docker image.
- [ ] Start all services using production Docker Compose.
- [ ] Verify MongoDB replica-set initialization and persistence.
- [ ] Verify API and web healthchecks.
- [ ] Test first-run owner registration and registration closure.
- [ ] Test license activation and feature enforcement.
- [ ] Verify HTTPS and secure cookie behavior.
- [ ] Test backup and restoration.
- [ ] Test an application upgrade without losing persistent data.

## Release readiness

Phase 10c is not runtime-verified until the deployment checklist passes.

Phase 11 remains planned and requires security review, load testing, CI/CD verification, backup validation, and release documentation.