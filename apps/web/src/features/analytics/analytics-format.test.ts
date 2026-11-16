import { describe, expect, it } from 'vitest';
import { bucketLabel, describeChange, formatKpiValue, previousText } from './analytics-format';
import { daysInclusive, rangeError, toRangeParams } from './analytics-params';
import { cmp, makeKpis } from './analytics-test-utils';

describe('describeChange', () => {
  it('shows percent for counts and points for rates', () => {
    expect(describeChange(cmp(), 'count')).toMatchObject({ kind: 'up', text: '25%' });
    expect(describeChange(cmp({ changePct: -10, direction: 'down' }), 'count')).toMatchObject({ kind: 'down', text: '10%' });
    expect(describeChange(cmp({ changePct: null, changePoints: 2.5 }), 'rate')).toMatchObject({ kind: 'up', text: '2.5 pts' });
  });
  it('never invents a percentage when the previous period was zero', () => {
    const v = describeChange(cmp({ previous: 0, changePct: null, direction: 'new' }), 'count');
    expect(v?.kind).toBe('new');
    expect(v?.text).not.toMatch(/%|Infinity/);
  });
  it('handles flat, unknown and snapshots', () => {
    expect(describeChange(cmp({ direction: 'flat', changePct: 0 }))?.text).toBe('No change');
    expect(describeChange(cmp({ previous: null, changePct: null, direction: 'unknown' }))?.kind).toBe('unknown');
    expect(describeChange(null)).toBeNull();
  });
  it('describes the previous value', () => {
    expect(previousText(cmp(), 'count', 'USD')).toBe('vs 8 in the previous period');
    expect(previousText(cmp({ previous: 1_000_000 }), 'money', 'USD')).toBe('vs $10,000.00 in the previous period');
  });
});

describe('formatting', () => {
  it('formats KPI values by kind, money from minor units', () => {
    const k = makeKpis();
    expect(formatKpiValue(k.find((x) => x.key === 'wonDealValue')!, 'USD')).toBe('$12,500.00');
    expect(formatKpiValue(k.find((x) => x.key === 'leadConversionRate')!, 'USD')).toBe('20%');
    expect(formatKpiValue({ ...k[2]!, value: null }, 'USD')).toBe('—');
  });
  it('labels buckets by grouping', () => {
    expect(bucketLabel('2026-11-03', 'day')).toBe('Nov 3');
    expect(bucketLabel('2026-11-02', 'week')).toBe('Wk of Nov 2');
    expect(bucketLabel('2026-11-01', 'month')).toBe('Nov 2026');
    expect(bucketLabel('2026-01-01', 'year')).toBe('2026');
  });
});

describe('range handling', () => {
  it('sends from/to only for custom ranges', () => {
    expect(toRangeParams({ period: '30d', from: '2026-01-01', to: '2026-01-31' })).toEqual({ period: '30d' });
    expect(toRangeParams({ period: 'custom', from: '2026-01-01', to: '2026-01-31', groupBy: 'week' })).toEqual({ period: 'custom', from: '2026-01-01', to: '2026-01-31', groupBy: 'week' });
  });
  it('validates custom ranges like the API', () => {
    expect(rangeError({ period: '7d' })).toBeNull();
    expect(rangeError({ period: 'custom', from: '2026-01-01' })).toMatch(/both/);
    expect(rangeError({ period: 'custom', from: '2026-02-01', to: '2026-01-01' })).toMatch(/must not be before/);
    expect(rangeError({ period: 'custom', from: '2025-01-01', to: '2026-06-01' })).toMatch(/366/);
    expect(rangeError({ period: 'custom', from: '2026-01-01', to: '2026-01-31' })).toBeNull();
    expect(daysInclusive('2026-01-01', '2026-01-31')).toBe(31);
  });
});