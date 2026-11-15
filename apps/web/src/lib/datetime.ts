/** Timezone helpers. The API speaks UTC; the UI shows and edits time in the organization's timezone. */
const cache = new Map<string, Intl.DateTimeFormat>();
const pad = (n: number, l = 2) => String(n).padStart(l, '0');

export function isValidTimezone(tz?: string | null): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
export const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export const resolveTimezone = (tz?: string | null) => (isValidTimezone(tz) ? tz : browserTimezone());

export interface Zoned { y: number; m: number; d: number; h: number; mi: number; s: number }

export function zonedParts(date: Date, tz: string): Zoned {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    cache.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(date)) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return { y: p.year!, m: p.month!, d: p.day!, h: p.hour! % 24, mi: p.minute!, s: p.second! };
}

function offsetMs(date: Date, tz: string) {
  const z = zonedParts(date, tz);
  return Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi, z.s) - Math.floor(date.getTime() / 1000) * 1000;
}

/** Wall-clock time in `tz` -> the UTC instant. Two passes handle DST transitions. */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetMs(new Date(guess), tz);
  return new Date(guess - offsetMs(new Date(first), tz));
}

/* ---- civil dates ("YYYY-MM-DD") are plain strings; arithmetic is done in UTC so it never drifts ---- */
export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return { y: y!, m: m!, d: d! };
};
export const ymdInTz = (date: Date, tz: string) => {
  const z = zonedParts(date, tz);
  return ymd(z.y, z.m, z.d);
};
export const addDays = (s: string, n: number) => {
  const { y, m, d } = parseYmd(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
};
export const addMonths = (s: string, n: number) => {
  const { y, m } = parseYmd(s);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, 1);
};
export const weekday = (s: string) => {
  const { y, m, d } = parseYmd(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
};
export const startOfWeek = (s: string, weekStartsOn = 1) => addDays(s, -((weekday(s) - weekStartsOn + 7) % 7));
export const startOfMonth = (s: string) => `${s.slice(0, 7)}-01`;
export const isValidYmd = (s: string | null | undefined): s is string => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s);

export const startOfDayUtc = (s: string, tz: string) => {
  const { y, m, d } = parseYmd(s);
  return zonedToUtc(y, m, d, 0, 0, tz);
};
export const endOfDayUtc = (s: string, tz: string) => new Date(startOfDayUtc(addDays(s, 1), tz).getTime() - 1);

/* ---- <input type="datetime-local"> <-> UTC ISO ---- */
export function toLocalInput(iso: string | null | undefined, tz: string): string {
  if (!iso) return '';
  const z = zonedParts(new Date(iso), tz);
  return `${ymd(z.y, z.m, z.d)}T${pad(z.h)}:${pad(z.mi)}`;
}
export function fromLocalInput(v: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  return m ? zonedToUtc(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, tz).toISOString() : null;
}

/* ---- display ---- */
export const formatInTz = (iso: string, tz: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(new Date(iso));
export const formatDateTimeTz = (iso: string, tz: string) => formatInTz(iso, tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const formatTimeTz = (iso: string, tz: string) => formatInTz(iso, tz, { hour: 'numeric', minute: '2-digit' });
export const formatFullTz = (iso: string, tz: string) =>
  formatInTz(iso, tz, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
export const formatYmd = (s: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(`${s}T00:00:00Z`));