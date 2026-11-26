# Product Requirements

## Vision
EstateFlow CRM lets property professionals manage the full pipeline, from first inquiry to closed deal, without enterprise
complexity. It must be simple for a solo dealer and scale to an agency.

## Target customers
| Segment | Needs |
|---|---|
| Independent agent or dealer | Fast lead capture, follow-up reminders, listing management |
| Small agency (2-15) | Assignment, shared pipeline, team visibility |
| Medium agency (15-50) | Roles, analytics, audit trail, manager oversight |
| Consultants | Client relationship history, property matching |

## Core capabilities (built)
Leads, contacts, property listings, deals, tasks and reminders, activity timeline, in-app notifications, analytics, reports
with CSV export, workflow automation, team management with roles, license management.

## Scope
**In scope (built or in progress)**
- First-run setup, login, password reset, organization, roles (OWNER, ADMIN, MANAGER, AGENT) with per-member overrides
- Leads: CRUD, assignment, status pipeline, filters, search, follow-ups, conversion to contacts, soft delete and restore
- Contacts, properties (images, status, owner contact), deals (stages, won and lost, reopen), tasks (calendar, reminders)
- Activity timeline per record, notifications with preferences
- Analytics and reports (see `ANALYTICS_METRICS.md`)
- Automations: triggers, conditions, actions, executions, retry
- Self-hosted: signed offline licenses, limits and feature gating, license settings page, Docker Compose install (in progress)

**Out of scope**
Hosted SaaS edition, subscriptions and payment providers, platform-admin tools, SMS campaigns, WhatsApp integration,
property portal syndication, mobile apps, e-signing, accounting, calendar sync.

## Non-functional requirements
| Area | Requirement |
|---|---|
| Security | Tenant isolation, server-enforced RBAC and license checks, hashed secrets, audit logs |
| Performance | Paginated lists; indexed queries |
| Responsiveness | Usable on mobile browsers |
| Maintainability | Modular monolith, typed end to end |
| Portability | One codebase, one build, run with Docker Compose |
| Operability | Health endpoint, structured logs, environment-based configuration |

## Edition
EstateFlow is a self-hosted product that the customer runs on their own infrastructure under a license. There is no hosted
edition and no subscription billing. An install has one organization. What the install may do (member, lead, property and
deal limits; analytics, CSV export, automations, advanced notifications) comes from the signed license key that the
organization owner pastes after first-run setup. Updates are applied by the customer. See `SELF_HOSTED.md`.

## Success criteria
A new owner can install with Docker, create the account, activate a license, add a lead, schedule a follow-up and see it on a
dashboard in under ten minutes.