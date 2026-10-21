import { mapHeaders, type SourceKind } from './aliases';
import { parseMoney } from '../ingestion/primitives';
/** Optional mapping preview only. No network caller exists in this local MVP. */
export interface SafeMappingPreview {
  schema_version: '1.0';
  source_hint: SourceKind;
  headers: { index: number; text: string }[];
  sample_rows: string[][];
}
const sensitive = /@|\b\d{5,}\b|\b(?:\d[\s()-]*){9,}\b|https?:|[\x00-\x1f]/i;
export function syntheticMappingPreview(
  headers: string[],
  rows: string[][],
  source: SourceKind,
): SafeMappingPreview {
  if (headers.length > 40) throw new Error('Mapping preview supports at most 40 columns.');
  const safeHeaders = headers.map((h, index) => ({
    index,
    text:
      sensitive.test(h) ||
      h.length > 80 ||
      Object.keys(mapHeaders([h], source).bindings).length === 0
        ? `COLUMN_${index + 1}`
        : h,
  }));
  const sample_rows = rows.slice(0, 3).map((row) =>
    headers.map((_, index) => {
      const value = (row[index] ?? '').trim();
      if (!value) return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return '2026-01-15';
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)) return '01/15/2026';
      // Bare integers can be IDs, ZIP codes or short tokens. They are never
      // echoed, and without a monetary cue they should not imply MONEY either.
      if (/[.$]/.test(value)) {
        try {
          parseMoney(value);
          return value.startsWith('(') ? '(123.45)' : value.startsWith('-') ? '-123.45' : '123.45';
        } catch {
          // Ambiguous/non-US numeric strings remain opaque synthetic text.
        }
      }
      return 'TEXT';
    }),
  );
  return { schema_version: '1.0', source_hint: source, headers: safeHeaders, sample_rows };
}
