// Regression coverage for the 2026-10-22 independent-review fixes. Synthetic data only.
import { describe, it, expect } from 'vitest';
import { contentHash } from '../../src/engine/identities';
import { parseSource } from '../../src/ingestion';
import {
  compatibleReview,
  openProject,
  serializeProject,
  reviewForGroup,
} from '../../src/review/project';
import { proposalFromCase, type CaseFacts } from '../../src/review/case-adapter';
import {
  compareReparsedSource,
  markSourceVerified,
  reparseOptions,
  sourceTrustBlocker,
} from '../../src/review/source-verification';
import {
  EXPORT_REGISTER_KEY,
  applyExportRegister,
  companyKey,
  readExportRegister,
  recordExport,
  reserveExport,
  type ExportRegisterEntry,
} from '../../src/review/export-register';
import { caseSummaryHtml } from '../../src/export/case-summary';
import type { Workspace } from '../../src/components/workspace';
import {
  sessionWorkspace,
  feeGroup,
  documentedFacts,
  withFacts,
  fixtureBytes,
  fixtureFiles,
} from './fee-case-fixture';

async function reopenedWithFacts() {
  const base = await sessionWorkspace();
  return openProject(serializeProject(withFacts(base, documentedFacts(base))));
}
async function reverify(w: Workspace, kind: keyof typeof fixtureFiles, bytes = fixtureBytes(kind)) {
  const file = w.files.find((f) => f.name === fixtureFiles[kind])!;
  const parsed = await parseSource(
    new TextDecoder().decode(bytes),
    file.kind,
    reparseOptions(file, bytes)!,
  );
  return { file, reason: compareReparsedSource(w, file, parsed) };
}
function memoryStorage(initial?: string) {
  const data = new Map<string, string>(initial ? [[EXPORT_REGISTER_KEY, initial]] : []);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('F-01 original-source re-verification after reopening', () => {
  it('re-derives identical rows from every original file and then permits the draft', async () => {
    let w = await reopenedWithFacts();
    expect(sourceTrustBlocker(w)).toMatch(/Re-attach the original source files/);
    for (const kind of Object.keys(fixtureFiles) as (keyof typeof fixtureFiles)[]) {
      const { file, reason } = await reverify(w, kind);
      expect(reason).toBeNull();
      w = markSourceVerified(w, file.hash);
    }
    expect(sourceTrustBlocker(w)).toBeNull();
    const g = feeGroup(w);
    const r = reviewForGroup(w.review!, g.id)!;
    const draft = await proposalFromCase(w, g, r, r.reviewedFacts as unknown as CaseFacts);
    expect(draft.lines.map((l) => [l.account, l.debitCents, l.creditCents])).toEqual([
      ['Merchant Processing Fees', 90000, 0],
      ['ServiceTitan Clearing', 0, 90000],
    ]);
  });
  it('rejects edited saved rows even when the original bytes are attached', async () => {
    const base = await sessionWorkspace();
    const text = serializeProject(withFacts(base, documentedFacts(base)));
    const x = JSON.parse(text);
    x.workspace.input.bank[0].signed_cents = 900000;
    const { integrity: _i, ...payload } = x;
    x.integrity = contentHash(payload);
    const w = openProject(JSON.stringify(x));
    const { reason } = await reverify(w, 'BANK');
    expect(reason).toMatch(/saved normalized rows differ/);
  });
  it('rejects a different file and a project that claims prior verification', async () => {
    const w = await reopenedWithFacts();
    const altered = new TextEncoder().encode(
      new TextDecoder().decode(fixtureBytes('BANK')).replace('9100.00,DEPOSIT', '9101.00,DEPOSIT'),
    );
    const { reason } = await reverify(w, 'BANK', altered);
    expect(reason).toMatch(/different bytes|differ/);
    const smuggled = JSON.parse(serializeProject(w));
    smuggled.workspace.restoredSources = { verifiedHashes: w.files.map((f) => f.hash) };
    const { integrity: _i, ...payload } = smuggled;
    smuggled.integrity = contentHash(payload);
    expect(() => openProject(JSON.stringify(smuggled))).toThrow(/validation failed/);
  });
  it('keeps synthetic demo projects usable without re-verification (their outputs stay marked)', async () => {
    const base = await sessionWorkspace();
    const reopened = openProject(serializeProject({ ...base, isDemo: true }));
    expect(sourceTrustBlocker(reopened)).toBeNull();
  });
});

describe('F-05 real three-file runs fit the approval text bounds', () => {
  it('binds every mapping version through one digest instead of a 242-character join', async () => {
    const base = await sessionWorkspace();
    expect(base.result.versions.mapping.join('|').length).toBeGreaterThan(240);
    const w = withFacts(base, documentedFacts(base));
    const g = feeGroup(w);
    const r = reviewForGroup(w.review!, g.id)!;
    const draft = await proposalFromCase(w, g, r, r.reviewedFacts as unknown as CaseFacts);
    expect(draft.feeCase.mappingVersion).toBe(
      `mapping-set-v1:${contentHash([...base.result.versions.mapping].sort())}`,
    );
  });
});

describe('F-02 review state stays within one company / bank / demo context', () => {
  it('does not carry review across demo, company or bank changes', async () => {
    const w = await sessionWorkspace();
    expect(compatibleReview(w, w)).toBe(w.review);
    expect(compatibleReview(w, { ...w, isDemo: true })).toBeUndefined();
    expect(
      compatibleReview(w, { ...w, options: { ...w.options, companyId: 'Other' } }),
    ).toBeUndefined();
    expect(
      compatibleReview(w, { ...w, options: { ...w.options, bankAccountId: 'Other' } }),
    ).toBeUndefined();
    expect(compatibleReview(null, w)).toBeUndefined();
  });
});

describe('F-09 same-browser export register', () => {
  const entry = (w: Workspace): ExportRegisterEntry => {
    const c = w.review!.cases.find((x) => x.engineGroupId === feeGroup(w).id)!;
    return {
      companyKey: companyKey(w.options.companyId),
      economicCaseId: c.economicCaseId,
      accountingActionId: c.accountingActionId,
      journalId: 'RD0123456789',
      proposalId: 'a'.repeat(64),
      proposalHash: 'b'.repeat(64),
      exportedAt: '2026-10-22T08:00:00.000Z',
      format: 'csv',
    };
  };
  it('adds a recorded export to a stale project copy and blocks a second draft', async () => {
    const w = withFacts(await sessionWorkspace(), documentedFacts(await sessionWorkspace()));
    const storage = memoryStorage();
    expect(recordExport(entry(w), storage)).toBe(true);
    const merged = applyExportRegister(w.review!, readExportRegister(storage), w.options.companyId);
    const g = feeGroup(w);
    const c = merged.cases.find((x) => x.engineGroupId === g.id)!;
    expect(c.exportHistory.map((h) => [h.journalId, h.status])).toEqual([
      ['RD0123456789', 'UNKNOWN'],
    ]);
    expect(c.existingImportStatus).toBe('UNKNOWN');
    await expect(
      proposalFromCase({ ...w, review: merged }, g, c, c.reviewedFacts as unknown as CaseFacts),
    ).rejects.toThrow(/prior or uncertain import history/);
    // Idempotent and never removes existing history.
    expect(applyExportRegister(merged, readExportRegister(storage), w.options.companyId)).toEqual(
      merged,
    );
  });
  it('is scoped by company and ignores corrupted or foreign storage values', async () => {
    const w = await sessionWorkspace();
    const other = applyExportRegister(w.review!, [entry(w)], 'Another company');
    expect(other.cases.every((c) => c.exportHistory.length === 0)).toBe(true);
    expect(readExportRegister(memoryStorage('{not json'))).toEqual([]);
    expect(
      readExportRegister(memoryStorage(JSON.stringify([{ journalId: 'x' }, entry(w)]))),
    ).toHaveLength(1);
    expect(recordExport({ ...entry(w), proposalHash: 'not-a-hash' }, memoryStorage())).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readExportRegister(throwing)).toEqual([]);
    expect(recordExport(entry(w), throwing)).toBe(false);
  });
  it('reserves one export per case even when two tabs ask concurrently through the lock', async () => {
    const w = await sessionWorkspace();
    const storage = memoryStorage();
    let chain = Promise.resolve();
    const requests: string[] = [];
    const locks = {
      request: <T>(name: string, callback: () => T | Promise<T>) => {
        requests.push(name);
        const run = chain.then(callback);
        chain = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    };
    const c = w.review!.cases.find((x) => x.engineGroupId === feeGroup(w).id)!;
    const [a, b] = await Promise.all([
      reserveExport(entry(w), w.options.companyId, c, { storage, locks }),
      reserveExport(
        { ...entry(w), exportedAt: '2026-10-22T08:00:01.000Z' },
        w.options.companyId,
        c,
        { storage, locks },
      ),
    ]);
    expect([a.reserved, b.reserved].sort()).toEqual([false, true]);
    expect((a.reserved ? b : a).existing.map((x) => x.journalId)).toEqual(['RD0123456789']);
    expect(readExportRegister(storage)).toHaveLength(1);
    expect(requests).toHaveLength(2);
  });
  it('stores only hashes, identifiers and time, never company labels or rows', async () => {
    const w = await sessionWorkspace();
    const storage = memoryStorage();
    recordExport(entry(w), storage);
    const raw = storage.getItem(EXPORT_REGISTER_KEY)!;
    expect(raw).not.toContain('Synthetic HVAC Co');
    expect(raw).not.toContain('Collections Checking');
  });
});

describe('Recipient-readable case summary', () => {
  it('escapes imported names and reviewer text and carries scope, unknowns and the blocker', async () => {
    const base = await sessionWorkspace();
    const facts = {
      ...documentedFacts(base),
      notes: '<script>alert(1)</script> & "quoted"',
      reviewer: '<img src=x onerror=alert(2)>',
    };
    const w = withFacts(base, facts);
    w.files[0].name = '<b>st.csv</b>';
    const g = feeGroup(w);
    const html = caseSummaryHtml({
      workspace: w,
      group: g,
      review: reviewForGroup(w.review!, g.id)!,
      facts,
      accountingBlocker: 'Example blocker <tag>',
      generatedAt: '2026-10-22T00:00:00.000Z',
    });
    expect(html).not.toMatch(/<script>|<img |<b>st/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot;');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('10000.00 USD');
    expect(html).toContain('Parsed from original bytes in this session');
    expect(html).toContain('Accounting draft blocked: Example blocker &lt;tag&gt;');
    expect(html).toContain('Not an accounting import, not proof of posting');
    expect(html).not.toContain('SYNTHETIC SAMPLE');
  });
});
