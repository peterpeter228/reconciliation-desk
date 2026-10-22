// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { caseSummaryHtml } from '../../src/export/case-summary';
import {
  companyKey,
  recordExport,
  registeredExportsFor,
  reserveExport,
  releaseExport,
  type ExportRegisterEntry,
} from '../../src/review/export-register';
import { sessionWorkspace, documentedFacts, feeGroup } from '../claude-review/fee-case-fixture';
import { reviewForGroup } from '../../src/review/project';

it('F09 escapes every hostile summary field into inert text and warns of financial information', async () => {
  const w = await sessionWorkspace();
  const attack = `<img src="https://invalid.test/x" onerror='alert(1)'>&`;
  w.options.companyId = attack;
  w.options.bankAccountId = attack;
  w.files[0].name = attack;
  const facts = {
    ...documentedFacts(w),
    reviewer: attack,
    notes: attack,
    documents: [
      { name: attack, purpose: 'SETTLEMENT' as const, sizeBytes: 1, sha256: 'a'.repeat(64) },
    ],
  };
  const g = feeGroup(w);
  const html = caseSummaryHtml({
    workspace: w,
    group: g,
    review: reviewForGroup(w.review!, g.id)!,
    facts,
    accountingBlocker: attack,
    generatedAt: attack,
  });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelectorAll('script,img,iframe,object,embed')).toHaveLength(0);
  expect(doc.querySelector('[onerror]')).toBeNull();
  expect(doc.body.textContent).toContain(attack);
  expect(
    doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'),
  ).toContain("default-src 'none'");
  expect(doc.body.textContent).toMatch(/Contains financial information/i);
});
it('F10 explicitly suppresses the implicit network favicon request', () => {
  const doc = new DOMParser().parseFromString(readFileSync('index.html', 'utf8'), 'text/html');
  expect(doc.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('data:,');
});
it('F08 exact labels match but spelling case and whitespace changes are explicitly not normalized', () => {
  const entries: ExportRegisterEntry[] = [
    {
      companyKey: companyKey('Synthetic Co'),
      economicCaseId: 'case',
      accountingActionId: 'action',
      journalId: 'RD1',
      proposalId: 'proposal',
      proposalHash: 'a'.repeat(64),
      exportedAt: '2026-10-22T00:00:00.000Z',
      format: 'csv',
    },
  ];
  const c = { economicCaseId: 'case', accountingActionId: 'action' };
  expect(registeredExportsFor(entries, 'Synthetic Co', c)).toHaveLength(1);
  for (const label of ['synthetic co', 'Synthetic Co ', 'Synthetic Company'])
    expect(registeredExportsFor(entries, label, c)).toHaveLength(0);
});
it('F08 serialized reservation refuses duplicate and releasing undelivered reservation allows retry', async () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
  const entry: ExportRegisterEntry = {
    companyKey: companyKey('Synthetic Co'),
    economicCaseId: 'case',
    accountingActionId: 'action',
    journalId: 'RD1',
    proposalId: 'proposal',
    proposalHash: 'a'.repeat(64),
    exportedAt: '2026-10-22T00:00:00.000Z',
    format: 'csv',
  };
  let serial = Promise.resolve();
  const locks = {
    request: <T>(_name: string, fn: () => T | Promise<T>): Promise<T> => {
      const result = serial.then(fn);
      serial = result.then(
        () => {},
        () => {},
      );
      return result;
    },
  };
  const results = await Promise.all([
    reserveExport(entry, 'Synthetic Co', entry, { storage, locks }),
    reserveExport(entry, 'Synthetic Co', entry, { storage, locks }),
  ]);
  expect(results.map((x) => x.reserved).sort()).toEqual([false, true]);
  expect(await releaseExport(entry, { storage, locks })).toBe(true);
  expect((await reserveExport(entry, 'Synthetic Co', entry, { storage, locks })).reserved).toBe(
    true,
  );
});
it('F08 unavailable storage honestly reports unpersisted reservation', async () => {
  const entry: ExportRegisterEntry = {
    companyKey: companyKey('Synthetic Co'),
    economicCaseId: 'case',
    accountingActionId: 'action',
    journalId: 'RD1',
    proposalId: 'proposal',
    proposalHash: 'a'.repeat(64),
    exportedAt: '2026-10-22T00:00:00.000Z',
    format: 'csv',
  };
  expect(recordExport(entry, null)).toBe(false);
  expect(await reserveExport(entry, 'Synthetic Co', entry, { storage: null, locks: null })).toEqual(
    { reserved: true, persisted: false, existing: [] },
  );
});
