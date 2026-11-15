import dns from 'node:dns';

dns.setServers(["8.8.8.8", "1.1.1.1"]);
import { describe, expect, it } from 'vitest';
import { csvCell, csvLine, minorToMajor, safeFilename } from '../src/modules/reports/csv';

describe('csv encoding', () => {
  it('neutralizes formula injection in text', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell('+1+1')).toBe(`'+1+1`);
    expect(csvCell('-2+3')).toBe(`'-2+3`);
    expect(csvCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(csvCell('  =cmd')).toBe(`"'  =cmd"`);
    expect(csvCell('\t=cmd')).toBe(`"'\t=cmd"`);
    expect(csvCell('\r=cmd')).toMatch(/^"'/);
  });
  it('writes numbers as numbers (negative numbers are not a risk) and leaves ordinary text alone', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell('Olivia Bennett')).toBe('Olivia Bennett');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvLine(['a', 1, 'b,c'])).toBe('a,1,"b,c"\r\n');
  });
  it('builds safe filenames and converts minor units per currency', () => {
    expect(safeFilename('lead-performance', '2026-11-01_to_2026-11-30')).toBe('lead-performance_2026-11-01_to_2026-11-30.csv');
    expect(safeFilename('../../etc/passwd', '"; rm -rf')).toBe('etc-passwd_rm-rf.csv');
    expect(minorToMajor(10_000_000, 'USD')).toBe(100_000);
    expect(minorToMajor(5000, 'JPY')).toBe(5000);
  });
});