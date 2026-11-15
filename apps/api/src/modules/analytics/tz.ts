const pad = (n: number, l = 2) => String(n).padStart(l, '0');
const formatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function zonedParts(date: Date, tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(tz, f);
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

/* Civil dates ("YYYY-MM-DD") are plain strings; arithmetic happens in UTC so it never drifts. */
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
export const shiftMonths = (s: string, n: number) => {
  const { y, m, d } = parseYmd(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return ymd(ny, nm + 1, Math.min(d, last));
};
export const daysBetween = (a: string, b: string) => {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
};
export const weekday = (s: string) => {
  const { y, m, d } = parseYmd(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
export const startOfWeek = (s: string) => addDays(s, -((weekday(s) + 6) % 7)); // weeks start on Monday
export const startOfMonth = (s: string) => `${s.slice(0, 7)}-01`;
export const startOfDayUtc = (s: string, tz: string) => {
  const { y, m, d } = parseYmd(s);
  return zonedToUtc(y, m, d, 0, 0, tz);
};
export const isValidYmd = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s && s >= '2000-01-01' && s <= '2100-12-31';