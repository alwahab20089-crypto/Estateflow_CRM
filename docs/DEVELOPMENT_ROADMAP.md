# Development Roadmap

| Phase | Goal | Status |
|---|---|---|
| 1 | Planning and architecture documents | Done |
| 2 | Foundation: monorepo, TypeScript, tooling, API bootstrap, env validation, database, error handling, health | Done |
| 3 | Auth and tenancy: users, organizations, members, invitations, JWT with refresh rotation, middleware chain, audit | Done |
| 4-7 | CRM core and web app: leads, contacts, properties, deals, tasks, activities, React application | Done |
| 8 | Analytics and reports (API and web) | Done |
| 9 | Notifications and workflow automation (API and web) | Done |
| 10 | Commercial features, self-hosted only | API done; web in progress; Docker packaging next |
| 11 | Hardening and release: security review, load testing, backups, CI/CD, user docs | Planned |

## Phase 10 breakdown
| Step | Content | Status |
|---|---|---|
| 10a API | Signed offline licenses, entitlements, limit and feature enforcement, `/licenses` routes, vendor key tool, first-run-only registration | Done |
| 10b Web | License settings page, expiry and grace banner, disabled actions at a limit or without a feature, first-run setup screen, license error handling | In progress |
| 10c Docker | Dockerfiles for `api` and `web`, `docker-compose.yml` with a MongoDB replica set and volume, healthchecks, production env example | Planned |

## Phase gates
Each phase ends with passing tests, updated docs, and zero known cross-tenant leakage.

## Risks and decisions
- Offline license enforcement is bypassable; set expectations commercially. Keys are not machine-bound.
- Edition presets (`EDITION_PRESETS`) are placeholders until pricing is decided.
- A fresh install is restricted until a license is activated; change `RESTRICTED_ENTITLEMENTS` for starter limits.
- MongoDB transactions need a replica set; Docker Compose must run MongoDB as a single-node replica set.
- The invitation HTTP routes (invite, accept) are not built yet; `createInvitation` already enforces the member limit.
- The `platformRole` field on users is legacy and unused by the self-hosted edition.