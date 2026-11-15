import { DEALABLE_PROPERTY_STATUSES, LISTING_TYPES, PROPERTY_STATUSES, PROPERTY_TYPES } from '../../constants';
import { Property } from '../properties/property.model';
import {
  assigneeLabel, bucketExpr, compare, countSeries, distribution, exec, flag, inRange, pipeline, resolveAssignees, scoped, type AnalyticsContext, type Cond, type Series,
} from './analytics.context';

/** "Active inventory" = on the market: AVAILABLE, UNDER_OFFER or RESERVED. DRAFT, INACTIVE, SOLD, RENTED and LEASED are not active. Archived properties are never counted. */
const ON_MARKET = [...DEALABLE_PROPERTY_STATUSES] as string[];
export interface PropertyFilters { propertyType?: string; status?: string; listingType?: string }
const conds = (f: PropertyFilters): Cond[] => [
  ...(f.propertyType ? [{ propertyType: f.propertyType }] : []),
  ...(f.status ? [{ propertyStatus: f.status }] : []),
  ...(f.listingType ? [{ listingType: f.listingType }] : []),
];
const MAX_CITIES = 20;

/** Inventory snapshot (not period-bound). Listing prices are asking prices, never revenue, and are averaged only within one currency. */
export async function propertySnapshot(c: AnalyticsContext, f: PropertyFilters = {}) {
  const city = { $ifNull: ['$city', 'Unknown'] };
  const rows = await exec<{
    totals: Array<{ total: number; onMarket: number; available: number }>;
    byStatus: Array<{ _id: string; count: number }>;
    byType: Array<{ _id: string; count: number }>;
    byListing: Array<{ _id: string; count: number }>;
    byCity: Array<{ _id: string; count: number }>;
    cityCount: Array<{ n: number }>;
    byAgent: Array<{ _id: unknown; count: number }>;
    avgPrice: Array<{ _id: { c: string; l: string; r: string | null }; count: number; avg: number }>;
  }>(
    Property.aggregate(pipeline([
      { $match: scoped(c, 'properties', ...conds(f)) },
      {
        $facet: {
          totals: [{ $group: { _id: null, total: { $sum: 1 }, onMarket: flag({ $in: ['$propertyStatus', ON_MARKET] }), available: flag({ $eq: ['$propertyStatus', 'AVAILABLE'] }) } }],
          byStatus: [{ $group: { _id: '$propertyStatus', count: { $sum: 1 } } }],
          byType: [{ $group: { _id: '$propertyType', count: { $sum: 1 } } }],
          byListing: [{ $group: { _id: '$listingType', count: { $sum: 1 } } }],
          byCity: [{ $group: { _id: city, count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }, { $limit: MAX_CITIES }],
          cityCount: [{ $group: { _id: city } }, { $count: 'n' }],
          byAgent: [{ $group: { _id: '$assignedTo', count: { $sum: 1 } } }],
          avgPrice: [
            { $match: { propertyStatus: { $in: ON_MARKET } } },
            { $group: { _id: { c: '$currency', l: '$listingType', r: { $ifNull: ['$rentPeriod', null] } }, count: { $sum: 1 }, avg: { $avg: '$priceAmount' } } },
          ],
        },
      },
    ])),
  );
  const fx = rows[0];
  const t = fx?.totals[0] ?? { total: 0, onMarket: 0, available: 0 };
  const names = await resolveAssignees(c, (fx?.byAgent ?? []).map((r) => r._id));
  const shownCities = fx?.byCity.reduce((s, r) => s + r.count, 0) ?? 0;

  return {
    totals: { total: t.total, active: t.onMarket, available: t.available },
    byStatus: distribution(fx?.byStatus ?? [], t.total, PROPERTY_STATUSES),
    byType: distribution(fx?.byType ?? [], t.total, PROPERTY_TYPES),
    byListingType: distribution(fx?.byListing ?? [], t.total, LISTING_TYPES),
    byCity: { top: distribution(fx?.byCity ?? [], t.total), distinctCities: fx?.cityCount[0]?.n ?? 0, otherCount: Math.max(0, t.total - shownCities) },
    byAgent: (fx?.byAgent ?? [])
      .map((r) => ({ userId: r._id ? String(r._id) : null, name: assigneeLabel(names, r._id), count: r.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    averageListingPrice: (fx?.avgPrice ?? [])
      .map((r) => ({ currency: r._id.c, listingType: r._id.l, rentPeriod: r._id.r, count: r.count, average: Math.round(r.avg) }))
      .sort((a, b) => a.currency.localeCompare(b.currency) || a.listingType.localeCompare(b.listingType)),
  };
}

export async function propertyAdded(c: AnalyticsContext, range: AnalyticsContext['range'], f: PropertyFilters = {}) {
  return Property.countDocuments(scoped(c, 'properties', inRange('createdAt', range), ...conds(f)) as never);
}

export async function propertyTrend(c: AnalyticsContext, f: PropertyFilters = {}): Promise<Series[]> {
  const rows = await exec<{ _id: string; count: number }>(
    Property.aggregate(pipeline([{ $match: scoped(c, 'properties', inRange('createdAt', c.range), ...conds(f)) }, { $group: { _id: bucketExpr('$createdAt', c), count: { $sum: 1 } } }])),
  );
  return [countSeries(c, 'propertiesAdded', 'Properties added', rows)];
}

export async function propertyAnalytics(c: AnalyticsContext, f: PropertyFilters = {}) {
  const [snapshot, added, addedPrev, series] = await Promise.all([propertySnapshot(c, f), propertyAdded(c, c.range, f), propertyAdded(c, c.previous, f), propertyTrend(c, f)]);
  return {
    ...snapshot,
    added: { count: added, comparison: compare(added, addedPrev) },
    series,
    definitions: {
      active: 'Properties with status AVAILABLE, UNDER_OFFER or RESERVED (not archived).',
      averageListingPrice: 'Asking price averaged per currency, listing type and rent period over active properties. Not sales revenue.',
    },
  };
}