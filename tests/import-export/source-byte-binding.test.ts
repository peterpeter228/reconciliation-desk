import { describe, expect, it } from 'vitest';
import { decodeCsv, parseSource, sha256, type ParseOptions } from '../../src/ingestion';
import { nativeCsv, options as nativeOptions } from '../qbo-roundtrip-adversarial/fixtures';

const options: ParseOptions = {
  companyId: 'BYTE_BINDING_TEST',
  bankAccountId: 'BANK',
  companyTimezone: 'America/New_York',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  asOfDate: '2026-09-30',
  currency: 'USD',
  dateFormat: 'MDY',
  rowGrain: 'PAYMENT',
  exportMode: 'JE_TO_CLEARING',
  postedLedgerConfirmed: true,
  bankPostedConfirmed: true,
  bankSignConvention: 'INFLOW_POSITIVE',
};
const bankText = 'Posting Date,Amount,Description\n09/01/2026,1.00,Café 😀\n';
const sources = [
  ['ST', 'Payment ID,Payment Date,Payment Amount\nP1,09/01/2026,1.00\n'],
  ['QBO', 'Date,Account,Debit,Credit\n09/01/2026,Clearing,1.00,\n'],
  ['QBD', 'Date,Account,Debit,Credit\n09/01/2026,Clearing,1.00,\n'],
  ['BANK', bankText],
] as const;

describe('CSV source-byte binding for every profile', () => {
  for (const profile of ['manual', 'synthetic-v1'] as const) {
    it.each(sources)(
      `${profile} %s rejects stale text before producing provenance`,
      async (kind, text) => {
        const matching = await parseSource(text, kind, {
          ...options,
          profile,
          originalBytes: new TextEncoder().encode(text),
        });
        expect(matching.ok, JSON.stringify(matching.issues)).toBe(true);
        const mismatched = await parseSource(text, kind, {
          ...options,
          profile,
          originalBytes: new TextEncoder().encode(text.replace('1.00', '2.00')),
        });
        expect(mismatched.ok).toBe(false);
        expect(mismatched.rows).toEqual([]);
        expect(mismatched.manifest).toBeNull();
        expect(mismatched.issues).toEqual([
          expect.objectContaining({ code: 'IMPORT_BLOCKED', severity: 'error' }),
        ]);
      },
    );
  }

  it('retains UTF-8 BOM-normalized content and exact original-byte identity', async () => {
    const bytes = new TextEncoder().encode(`\uFEFF${bankText}`);
    const withBom = await parseSource(bankText, 'BANK', { ...options, originalBytes: bytes });
    const withoutBom = await parseSource(bankText, 'BANK', options);
    expect(withBom.ok).toBe(true);
    expect(withoutBom.ok).toBe(true);
    expect(withBom.rows[0].signed_cents).toBe(withoutBom.rows[0].signed_cents);
    expect(withBom.rows[0].source_refs[0].raw_row_sha256).toBe(
      withoutBom.rows[0].source_refs[0].raw_row_sha256,
    );
    expect(withBom.manifest?.source_file_sha256).toBe(await sha256(bytes));
    expect(withBom.manifest?.source_file_sha256).not.toBe(withoutBom.manifest?.source_file_sha256);
    const repeated = await parseSource(`\uFEFF${bankText}`, 'BANK', {
      ...options,
      originalBytes: bytes,
      seenFileHashes: [withBom.manifest!.source_file_sha256],
    });
    expect(repeated.duplicate).toBe(true);
  });

  it('rejects invalid UTF-8 supplied alongside otherwise valid text', async () => {
    const result = await parseSource(bankText, 'BANK', {
      ...options,
      originalBytes: new Uint8Array([0xff, 0xfe, 65, 0]),
    });
    expect(result.ok).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.manifest).toBeNull();
  });

  it.each([
    ['utf-16le', false],
    ['utf-16le', true],
    ['utf-16be', false],
    ['utf-16be', true],
  ] as const)(
    'binds explicitly selected %s with BOM=%s without guessing',
    async (encoding, bom) => {
      const buffer = Buffer.from(`${bom ? '\uFEFF' : ''}${bankText}`, 'utf16le');
      if (encoding === 'utf-16be') buffer.swap16();
      const bytes = new Uint8Array(buffer);
      const decoded = decodeCsv(bytes, encoding);
      const matched = await parseSource(decoded, 'BANK', {
        ...options,
        encoding,
        originalBytes: bytes,
      });
      expect(matched.ok, JSON.stringify(matched.issues)).toBe(true);
      expect(matched.rows[0].description_local).toBe('Café 😀');
      expect(matched.manifest?.source_file_sha256).toBe(await sha256(bytes));
      const mismatched = await parseSource(decoded.replace('1.00', '2.00'), 'BANK', {
        ...options,
        encoding,
        originalBytes: bytes,
      });
      expect(mismatched.ok).toBe(false);
      expect(mismatched.rows).toEqual([]);
      expect((await parseSource(decoded, 'BANK', { ...options, originalBytes: bytes })).ok).toBe(
        false,
      );
      expect((await parseSource(decoded, 'BANK', { ...options, encoding })).ok).toBe(false);
    },
  );

  it('rejects unsupported encoding at runtime rather than letting TextDecoder broaden the contract', async () => {
    const result = await parseSource(bankText, 'BANK', {
      ...options,
      encoding: 'windows-1252' as ParseOptions['encoding'],
      originalBytes: new TextEncoder().encode(bankText),
    });
    expect(result.ok).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.manifest).toBeNull();
    expect(result.issues[0].message).toMatch(/Unsupported CSV encoding/);
  });

  it('keeps the observed native profile UTF-8 only even when UTF-16 bytes match the text', async () => {
    const bytes = new Uint8Array(Buffer.from(nativeCsv, 'utf16le'));
    const result = await parseSource(nativeCsv, 'QBO', {
      ...nativeOptions,
      encoding: 'utf-16le',
      originalBytes: bytes,
    });
    expect(result.ok).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.manifest).toBeNull();
    expect(result.issues[0].message).toMatch(/requires UTF-8/);
  });

  it('preserves native optional BOM semantics without canonicalizing the source hash', async () => {
    const text = nativeCsv.replace(/^\uFEFF/, '');
    const bytes = new TextEncoder().encode(`\uFEFF${text}`);
    const result = await parseSource(text, 'QBO', { ...nativeOptions, originalBytes: bytes });
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.manifest?.source_file_sha256).toBe(await sha256(bytes));
    expect(result.rows).toHaveLength(2);
  });
});
