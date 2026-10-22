import { describe, it, expect } from 'vitest';
import { sessionWorkspace, feeGroup, documentedFacts } from '../claude-review/fee-case-fixture';
import { openProject, serializeProject, reviewForGroup } from '../../src/review/project';
import { sourceTrustBlocker, markSourceVerified } from '../../src/review/source-verification';
import { proposalFromCase, ufReviewConflicts } from '../../src/review/case-adapter';
import { approveProposal } from '../../src/export/aje';
import { exportQboCsv } from '../../src/export/qbo';

async function verified() {
  let w = openProject(serializeProject(await sessionWorkspace()));
  for (const f of w.files) w = markSourceVerified(w, f.hash);
  expect(sourceTrustBlocker(w)).toBeNull();
  return w;
}
async function draft(w: Awaited<ReturnType<typeof sessionWorkspace>>) {
  const g = feeGroup(w);
  return proposalFromCase(w, g, reviewForGroup(w.review!, g.id)!, documentedFacts(w));
}
describe('dot F01 source verification state binding', () => {
  it('rejects inherited hash-only verification after supplemental evidence recalculation', async () => {
    const w = await verified();
    w.restoredSources = { verifiedHashes: w.files.map((f) => f.hash) };
    expect(sourceTrustBlocker(w)).toMatch(/original source/);
  });
  it('invalidates same bytes when parse options change', async () => {
    const w = await verified();
    w.files[0].parseOptions = { ...w.files[0].parseOptions!, coverageConfirmed: false };
    expect(sourceTrustBlocker(w)).toMatch(/original source/);
  });
  it('invalidates normalized rows modified after verification', async () => {
    const w = await verified();
    w.input.st[0].gross_cents++;
    expect(sourceTrustBlocker(w)).toMatch(/original source/);
  });
  it('allows display rename but never carries demo verification into real mode', async () => {
    const w = await verified();
    w.files[0].name = 'renamed.csv';
    expect(sourceTrustBlocker(w)).toBeNull();
    w.isDemo = true;
    const demo = markSourceVerified(w, w.files[0].hash);
    demo.isDemo = false;
    expect(sourceTrustBlocker(demo)).toMatch(/original source/);
  });
});
describe('dot F05 mapping ownership', () => {
  it('changes proposal binding when the same mapping-version set is reassigned between files', async () => {
    const w = await sessionWorkspace();
    const original = await draft(w);
    const a = w.input.st[0].source_refs[0],
      b = w.input.bank[0].source_refs[0];
    [a.mapping_version, b.mapping_version] = [b.mapping_version, a.mapping_version];
    const changed = await draft(w);
    expect(changed.feeCase.mappingVersion).not.toBe(original.feeCase.mappingVersion);
    const approved = await approveProposal(original, 'Synthetic reviewer');
    approved.feeCase.mappingVersion = changed.feeCase.mappingVersion;
    await expect(exportQboCsv(approved)).rejects.toThrow();
  });
});
describe('dot F04 UF scope', () => {
  it('does not block an unrelated bank transaction in full-month GL', async () => {
    const w = await sessionWorkspace('uf'),
      g = feeGroup(w),
      f = documentedFacts(w);
    const foreign = structuredClone(w.input.qb[0]);
    Object.assign(foreign, {
      id: 'other-bank',
      transaction_id: 'other-tx',
      role: 'BANK',
      account_type: 'BANK',
      account_full_name: f.bankAccountName,
      debit_cents: 100,
      credit_cents: 0,
      signed_cents: 100,
    });
    w.input.qb.push(foreign);
    expect(ufReviewConflicts(w, g, { economicCaseId: 'mine' }, f)).toEqual([]);
  });
  it('does not let an unsupported OTHER_CASE label hide fee activity', async () => {
    const w = await sessionWorkspace('uf'),
      g = feeGroup(w),
      f = documentedFacts(w);
    const fee = structuredClone(w.input.qb[0]);
    Object.assign(fee, {
      id: 'fee-row',
      transaction_id: 'fee-tx',
      role: 'FEE',
      account_type: 'EXPENSE',
      account_full_name: f.feeAccountName,
      debit_cents: 90000,
      credit_cents: 0,
      signed_cents: 90000,
    });
    w.input.qb.push(fee);
    f.relations.push({
      transactionId: 'fee-tx',
      relation: 'OTHER_CASE',
      relatedCaseId: 'invented',
      evidenceRef: 'bogus',
      reviewer: 'reviewer',
    });
    expect(ufReviewConflicts(w, g, { economicCaseId: 'mine' }, f).join(' ')).toMatch(/fee account/);
  });
});

describe('dot F05 ordering stability', () => {
  it('preserves mapping digest under source and row reordering', async () => {
    const w = await sessionWorkspace();
    const original = await draft(w);
    w.files.reverse();
    w.input.qb.reverse();
    w.result.versions.mapping.reverse();
    const changed = await draft(w);
    expect(changed.feeCase.mappingVersion).toBe(original.feeCase.mappingVersion);
  });
});

describe('dot F01 reparse variants', () => {
  it('rejects original bytes reinterpreted under different import semantics', async () => {
    const { parseSource } = await import('../../src/ingestion');
    const { fixtureBytes } = await import('../claude-review/fee-case-fixture');
    const { compareReparsedSource, reparseOptions } =
      await import('../../src/review/source-verification');
    const w = await sessionWorkspace();
    const file = w.files.find((f) => f.kind === 'ST')!,
      bytes = fixtureBytes('ST');
    const parsed = await parseSource(new TextDecoder().decode(bytes), file.kind, {
      ...reparseOptions(file, bytes)!,
      exportMode: 'PAYMENT_TO_UF',
    });
    expect(compareReparsedSource(w, file, parsed)).toMatch(/differ/);
  });
  it('explains parser-version mismatch and asks for re-import rather than silently trusting old rows', async () => {
    const { parseSource } = await import('../../src/ingestion');
    const { fixtureBytes } = await import('../claude-review/fee-case-fixture');
    const { compareReparsedSource, reparseOptions } =
      await import('../../src/review/source-verification');
    const w = await sessionWorkspace();
    const file = w.files.find((f) => f.kind === 'ST')!,
      bytes = fixtureBytes('ST');
    const parsed = await parseSource(
      new TextDecoder().decode(bytes),
      file.kind,
      reparseOptions(file, bytes)!,
    );
    parsed.rows[0].source_refs[0].parser_version = 'future-parser';
    expect(compareReparsedSource(w, file, parsed)).toMatch(/different parser version. Re-import/);
  });
});

describe('dot F01 duplicate byte contexts and serialized demo', () => {
  it('fails closed for a second same-hash source with different parsing options', async () => {
    const w = await verified();
    const second = structuredClone(w.files[0]);
    second.parseOptions = { ...second.parseOptions!, coverageConfirmed: false };
    w.files.push(second);
    const next = markSourceVerified(w, second.hash);
    expect(sourceTrustBlocker(next)).toMatch(/original source/);
  });
  it('retains synthetic export labels after demo restore and blocks reserialized real conversion', async () => {
    const w = await sessionWorkspace();
    w.isDemo = true;
    const restoredDemo = openProject(serializeProject(w));
    const approved = await approveProposal(await draft(restoredDemo), 'Synthetic reviewer');
    const artifact = await exportQboCsv(approved);
    expect(artifact.fileName).toMatch(/^SYNTHETIC/);
    expect(artifact.manifest.synthetic_only).toBe(true);
    restoredDemo.isDemo = false;
    const restoredReal = openProject(serializeProject(restoredDemo));
    await expect(draft(restoredReal)).rejects.toThrow(/original source/);
  });
});
