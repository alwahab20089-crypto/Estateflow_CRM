# EstateFlow analytics: metric definitions

All amounts are integer **minor units** per currency and are **never summed across currencies**.
All dates are interpreted in the report timezone (query `timezone`, else the organization's). Ranges are civil dates, both ends inclusive, max 366 days.
Archived (soft-deleted) records are never counted. Previous period = the same number of days immediately before the range.

| Metric | Definition | Comparison |
|---|---|---|
| Total leads | Active leads visible to the caller, any date | none (snapshot) |
| New leads | Leads **created** in the range | previous period |
| Qualified leads | Of the leads created in the range, status QUALIFIED / MEETING_SCHEDULED / NEGOTIATION / WON. Later-LOST leads are not counted (no status history) | previous period |
| Lead conversion rate | Leads created in the range that have `convertedAt` ÷ leads created in the range. null when 0 leads | percentage points |
| Avg time to convert | mean(convertedAt − createdAt) of leads converted in the range | – |
| Active properties | status AVAILABLE, UNDER_OFFER or RESERVED | none (snapshot) |
| Available properties | status AVAILABLE | none (snapshot) |
| Avg listing price | Asking price of on-market properties, per currency × listing type × rent period. **Not revenue** | – |
| Active deals / Pipeline value | Open-stage deals now; Σ valueAmount per currency. Weighted = Σ value × probability. Lost, won and archived never count | none (snapshot) |
| Won deals | Deals WON with `actualClosingDate` in the range. A deal is one document: won → reopened → won again counts once, in its latest close period | previous period |
| Won deal value | Σ valueAmount of those deals, per currency. **Agreed value, not cash collected** | previous period |
| Win rate | won ÷ (won + lost), both closed in the range. Open deals are not in the denominator | percentage points |
| Avg time to close | mean(closing date − createdAt) of deals won in the range | – |
| Overdue tasks | status TODO / IN_PROGRESS and `dueAt` < now (an instant, so timezone independent) | none (snapshot) |
| Tasks due today | open, `dueAt` inside today's calendar day in the report timezone | none (snapshot) |
| Task completion rate | COMPLETED ÷ (COMPLETED + still open) among tasks whose due date already passed inside the range. Cancelled tasks and future-due tasks are excluded | percentage points |
| On-time rate | of the same tasks, completed with `completedAt` ≤ `dueAt` | – |

**Collected revenue** is not available: EstateFlow has no payment or transaction records. `/analytics/revenue` returns `isCollectedRevenue: false`.

**Attribution:** current assignee only (no assignment history). Unassigned records are separate; records of removed members are grouped as "Former members". No ranking is produced.
**Visibility:** per-module `*:read_all` rules still apply, and without `analytics:team` every number is restricted to the caller's own assigned records.
**Percent change:** `null` (direction `new`) when the previous value is 0; `unknown` when either side cannot be computed.