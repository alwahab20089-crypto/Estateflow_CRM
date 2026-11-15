import { z } from 'zod';
import { DEAL_STAGES, DEAL_TYPES, LEAD_SOURCES, LEAD_STATUSES, LISTING_TYPES, PROPERTY_STATUSES, PROPERTY_TYPES } from '../../constants';
import { objectIdSchema } from '../../utils/object-id';
import { isValidTimezone, isValidYmd } from './tz';

const ymdSchema = z.string().refine(isValidYmd, 'Use a date in YYYY-MM-DD format');

const base = {
  period: z.enum(['7d', '30d', '90d', '12m', 'custom']).default('30d'),
  /** Civil dates in the report timezone. Both ends are inclusive. Only valid with period=custom. */
  from: ymdSchema.optional(),
  to: ymdSchema.optional(),
  timezone: z.string().max(64).refine(isValidTimezone, 'Invalid IANA timezone').optional(),
  groupBy: z.enum(['day', 'week', 'month', 'year']).optional(),
  assignedTo: z.union([objectIdSchema, z.literal('me'), z.literal('unassigned')]).optional(),
};




const make = <T extends z.ZodRawShape>(extra: T) =>
  z
    .object({ ...base, ...extra })
    .strict()
    .superRefine((value, ctx) => {
  const range = value as unknown as {
    period: string;
    from?: string;
    to?: string;
  };

  const period = range.period;
  const from = range.from;
  const to = range.to;
      if (period === 'custom') {
        if (!from) {
          ctx.addIssue({
            code: 'custom',
            path: ['from'],
            message: 'from is required when period=custom',
          });
        }

        if (!to) {
          ctx.addIssue({
            code: 'custom',
            path: ['to'],
            message: 'to is required when period=custom',
          });
        }

        if (from && to && from > to) {
          ctx.addIssue({
            code: 'custom',
            path: ['to'],
            message: '"to" must not be before "from"',
          });
        }
      } else if (from || to) {
        ctx.addIssue({
          code: 'custom',
          path: ['from'],
          message: 'from and to are only allowed with period=custom',
        });
      }
    });



export const overviewQuery = make({});
export const teamQuery = make({});
export const leadsQuery = make({ leadSource: z.enum(LEAD_SOURCES).optional(), status: z.enum(LEAD_STATUSES).optional() });
export const dealsQuery = make({ dealType: z.enum(DEAL_TYPES).optional(), status: z.enum(DEAL_STAGES).optional() });
export const revenueQuery = make({ dealType: z.enum(DEAL_TYPES).optional() });
export const propertiesQuery = make({ propertyType: z.enum(PROPERTY_TYPES).optional(), status: z.enum(PROPERTY_STATUSES).optional() });
export const tasksQuery = make({ status: z.enum(['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional() });

export const TREND_METRICS = ['leadsCreated', 'leadsConverted', 'dealsCreated', 'dealsWon', 'dealsWonValue', 'propertiesAdded', 'tasksCreated', 'tasksCompleted'] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];
export const trendsQuery = make({
  metrics: z
    .string()
    .max(200)
    .transform((s) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))])
    .refine((l) => l.every((m) => (TREND_METRICS as readonly string[]).includes(m)), 'Unknown metric')
    .optional(),
});

export const reportQuery = make({
  leadSource: z.enum(LEAD_SOURCES).optional(),
  status: z.string().regex(/^[A-Z_]{2,30}$/).optional(), // validated against the report's own status list
  dealType: z.enum(DEAL_TYPES).optional(),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  listingType: z.enum(LISTING_TYPES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().max(40).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export type OverviewQuery = z.infer<typeof overviewQuery>;
export type LeadsQuery = z.infer<typeof leadsQuery>;
export type DealsQuery = z.infer<typeof dealsQuery>;
export type RevenueQuery = z.infer<typeof revenueQuery>;
export type PropertiesQuery = z.infer<typeof propertiesQuery>;
export type TasksQuery = z.infer<typeof tasksQuery>;
export type TrendsQuery = z.infer<typeof trendsQuery>;
export type ReportQuery = z.infer<typeof reportQuery>;