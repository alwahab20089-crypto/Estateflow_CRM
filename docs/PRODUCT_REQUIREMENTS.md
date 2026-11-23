# Product Requirements

## Vision
EstateFlow CRM lets property professionals manage the full pipeline, from first inquiry to closed
deal, without enterprise complexity. It must be simple for a solo dealer and scalable for an agency.

## Target customers
| Segment | Needs |
|---|---|
| Independent agent / dealer | Fast lead capture, follow-up reminders, listing management |
| Small agency (2-15) | Assignment, shared pipeline, team visibility |
| Medium agency (15-50) | Roles, analytics, audit trail, manager oversight |
| Consultants | Client relationship history, property matching |

## Core capabilities
Leads, contacts, property listings, tasks and reminders, activity timeline, follow-ups,
notifications, sales analytics, team management.

## MVP scope (v1.0)
**In scope**
- Auth, organizations, member invitations, roles (OWNER/ADMIN/MANAGER/AGENT)
- Leads: CRUD, assignment, status pipeline, filters, search, follow-up date
- Contacts: CRUD, convert lead to contact
- Properties: CRUD, listing status, image URLs/uploads, link to owner contact
- Tasks: CRUD, link to lead/contact/property, due dates
- Activities: timeline per lead/contact/property
- In-app notifications (task due, assignment)
- Basic analytics: pipeline funnel, leads by source, won/lost, agent performance
- Self-hosted: license activation/validation, Docker Compose install

**Out of scope for v1.0**
Email/SMS campaigns, WhatsApp integration, property portal syndication, mobile apps,
document e-signing, accounting, calendar sync (listed as post-MVP candidates).

## Non-functional requirements
| Area | Requirement |
|---|---|
| Security | Tenant isolation, backend-enforced RBAC, hashed secrets, audit logs |
| Performance | List endpoints paginated, p95 < 300 ms for indexed queries at 100k records/tenant |
| Responsiveness | Fully usable on mobile browsers |
| Maintainability | Modular monolith, typed end to end, shared validation schemas |
| Portability | One codebase and one build, run with Docker Compose |
| Operability | Health endpoint, structured logs, env-based config |

## Edition
EstateFlow is distributed as a self-hosted product that the customer runs on their own
infrastructure under a license. There is no hosted edition and no subscription billing. An install
normally has one organization; limits come from the license `maxUsers`, and the organization
owner administers the install. Updates are applied by the customer. See `SELF_HOSTED.md`.

## Success criteria
A new agent can register, add a lead, schedule a follow-up, and see it on a dashboard in
under five minutes.