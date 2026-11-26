# Business Rules

## Ownership and tenancy
- BR-1 Every lead, contact, property, deal, task, activity and notification belongs to exactly one organization.
- BR-2 Cross-references (assignee, owner contact, related entities) must be in the same organization.
- BR-3 The data model lets a user belong to many organizations; a self-hosted install has one.
- BR-4 An organization has exactly one OWNER (partial unique index).
- BR-5 The OWNER cannot be removed or demoted.
- BR-6 Registration is first-run only. After the first user exists, accounts are created through invitations.

## Members and roles
- BR-7 Only roles with `members:*` permission manage members.
- BR-8 Users cannot change their own role or permissions.
- BR-9 Invitation tokens are single-use, stored hashed, and expire.
- BR-10 Removing a user never deletes organization data. Authorship (`createdBy`) is preserved.
- BR-11 Member count (active members plus pending, unexpired invitations) must respect the license `members` limit. The check is on invite; accepting an invitation does not count again.

## Leads
- BR-12 A lead has at most one assignee, who must be an active member.
- BR-13 WON and LOST are terminal. Reopening needs `leads:reopen`. Moving to WON sets `wonAt`; LOST requires `lostReason` and sets `lostAt`.
- BR-14 Leads are soft-deleted (`deletedAt`) and can be restored. History is preserved.
- BR-15 Every status change creates a STATUS_CHANGE activity.
- BR-16 Only QUALIFIED, MEETING_SCHEDULED, NEGOTIATION or WON leads can be converted to a contact (LOST must be reopened first). Conversion copies data, links `linkedLeadId` and sets `convertedContactId`; the lead keeps its history.
- BR-17 A duplicate phone or email warns; it does not block.
- BR-18 Users without `leads:read_all` see only leads assigned to them.

## Contacts, properties and deals
- BR-19 A property may reference one owner contact; a contact may own many properties.
- BR-20 SOLD, RENTED and LEASED properties stay visible but are excluded from "available" views. Winning a deal moves its property to SOLD (sale), RENTED (rent) or LEASED (lease) and records `closedByDealId`.
- BR-21 Money is stored as integer minor units, currency per record, never summed across currencies.
- BR-22 A deal links a contact and a property, and optionally a lead. Only properties in AVAILABLE, UNDER_OFFER or RESERVED can take a deal, and a property has at most one WON deal.
- BR-23 Deal stages: NEW, QUALIFICATION, PROPERTY_MATCHED, VIEWING_SCHEDULED, NEGOTIATION, CONTRACT, WON, LOST. Reopening needs `deals:reopen`.
- BR-24 Properties, contacts, deals and tasks are soft-deleted (archived) and can be restored where a restore route exists.

## Tasks and notifications
- BR-25 A task may relate to one lead, contact, property or deal in the same organization.
- BR-26 Completing a task sets `completedAt`; reopening clears it.
- BR-27 Assignment generates a notification. Mandatory types (task, lead and deal assignment, task overdue, automation failed) cannot be turned off in preferences.
- BR-28 Reminder and overdue notifications are idempotent through a delivery key, so a dismissed reminder is never re-created.

## Automations
- BR-29 Workflows have at most 10 conditions and 5 actions; an organization has at most 100 workflows.
- BR-30 Event chains stop at a configured depth (`AUTOMATION_MAX_DEPTH`) to prevent loops.
- BR-31 Each workflow runs at most once per triggering event and at most `maxExecutionsPerHour` times per hour.

## Activities and audit
- BR-32 Activities are append-only for users; corrections are new entries.
- BR-33 Important mutations create an audit entry. Audit logs cannot be changed through the application.

## Analytics and permissions
- BR-34 Analytics are computed only over the active organization's data and need `analytics:read` plus the license feature `analytics`.
- BR-35 Without `analytics:team` or the module's `*:read_all` permission, numbers cover only the caller's own records.

## Licensing
- BR-36 License limits and features are checked server-side on every relevant write.
- BR-37 Limits are HARD ON CREATE: they block creating more, never delete or hide data. Closed and archived-then-restored records count.
- BR-38 A license in its grace period works normally. After the grace period, or with no, deactivated or revoked license, nothing new can be created and licensed features switch off. Existing data stays readable and is never auto-deleted.
- BR-39 License state changes only from a key whose signature was verified on the server, or from the owner deactivating it.
- BR-40 An organization has at most one ACTIVE license. A key can be active for only one organization.
- BR-41 Pausing and deleting automations stays allowed without the `automations` feature.