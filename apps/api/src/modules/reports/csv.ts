
/**
 * CSV cell encoding.
 *
 * - Spreadsheet formulas in strings are neutralized with a leading apostrophe.
 * - Numbers remain numbers; negative numeric values are not treated as injection.
 * - Cells containing quotes, commas, line breaks, or edge whitespace are quoted.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  let s = value instanceof Date ? value.toISOString() : String(value);

  s = s.replaceAll('\0', '');

  // Preserve the original edge-whitespace information before adding the apostrophe.
  const hasEdgeWhitespace = s !== s.trim();

  if (/^[\t\r ]*[=+\-@]/.test(s) || /^[\t\r]/.test(s)) {
    s = `'${s}`;
  }

  const requiresQuotes =
    hasEdgeWhitespace || /[",\r\n]/.test(s);

  return requiresQuotes ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (cells: unknown[]) =>
  `${cells.map(csvCell).join(',')}\r\n`;

/**
 * Creates a safe filename using lowercase letters, digits, dashes and underscores.
 */
export const safeFilename = (...parts: string[]) => {
  const sanitized = parts
    .map((part) =>
      part
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/[-_]{2,}/g, (match) =>
          match.includes('_') ? '_' : '-',
        )
        .replace(/^[-_]+|[-_]+$/g, ''),
    )
    .filter(Boolean)
    .join('_')
    .slice(0, 80);

  return `${sanitized || 'report'}.csv`;
};

export const currencyExponent = (currency: string) => {
  const code = currency.toUpperCase();

  // PKR uses two decimal places.
  if (code === 'PKR') return 2;

  try {
    return (
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency: code,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
};

export const minorToMajor = (amount: number, currency: string) =>
  amount / 10 ** currencyExponent(currency);
