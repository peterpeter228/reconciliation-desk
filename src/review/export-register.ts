import { z } from 'zod';
import { contentHash } from '../engine/identities';
import type { ReviewCase, ReviewProjectState } from './types';

/**
 * Same-browser memory of accounting exports. It holds hashes and journal numbers
 * only, never rows or names. It narrows (not removes) duplicate-export risk from a
 * project copy saved before an export, a second tab, or a fresh re-import of the
 * same files. It is not a cross-device registry and can be cleared by the browser.
 */
export const EXPORT_REGISTER_KEY = 'reconciliation-desk.export-register.v1';
const MAX_ENTRIES = 5000;
export interface ExportRegisterEntry {
  companyKey: string;
  economicCaseId: string;
  accountingActionId: string;
  journalId: string;
  proposalId: string;
  proposalHash: string;
  exportedAt: string;
  format: 'csv' | 'iif';
}
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const entrySchema = z
  .object({
    companyKey: z.string().regex(/^[a-f0-9]{64}$/),
    economicCaseId: z.string().min(1).max(200),
    accountingActionId: z.string().min(1).max(200),
    journalId: z.string().min(1).max(200),
    proposalId: z.string().min(1).max(200),
    proposalHash: z.string().regex(/^[a-f0-9]{64}$/),
    exportedAt: z.string().datetime(),
    format: z.enum(['csv', 'iif']),
  })
  .strict();

export const companyKey = (companyId: string) => contentHash({ company: companyId });

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readExportRegister(storage = browserStorage()): ExportRegisterEntry[] {
  if (!storage) return [];
  try {
    const parsed = z
      .array(z.unknown())
      .safeParse(JSON.parse(storage.getItem(EXPORT_REGISTER_KEY) ?? '[]'));
    if (!parsed.success) return [];
    return parsed.data.flatMap((x) => {
      const entry = entrySchema.safeParse(x);
      return entry.success ? [entry.data] : [];
    });
  } catch {
    return [];
  }
}

/** Returns false when this browser could not keep the record (private mode, quota, policy). */
export function recordExport(entry: ExportRegisterEntry, storage = browserStorage()): boolean {
  if (!storage || !entrySchema.safeParse(entry).success) return false;
  try {
    const entries = [...readExportRegister(storage), entry].slice(-MAX_ENTRIES);
    storage.setItem(EXPORT_REGISTER_KEY, JSON.stringify(entries));
    return readExportRegister(storage).some(
      (x) => x.journalId === entry.journalId && x.exportedAt === entry.exportedAt,
    );
  } catch {
    return false;
  }
}

type LockManagerLike = {
  request: <T>(name: string, callback: () => T | Promise<T>) => Promise<T>;
};
const EXPORT_LOCK = 'reconciliation-desk.export-register';
function browserLocks(): LockManagerLike | null {
  try {
    return (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks ?? null;
  } catch {
    return null;
  }
}
export interface ExportReservation {
  reserved: boolean;
  /** Earlier same-case exports recorded in this browser; non-empty means refused. */
  existing: ExportRegisterEntry[];
  /** False when the browser could not keep the record (private mode, quota, policy). */
  persisted: boolean;
}
/**
 * Check-and-record as one critical section, serialized across tabs with the Web
 * Locks API where available. Residual risk remains: no lock support, storage that
 * cannot persist, other browsers/devices, or cleared site data.
 */
export async function reserveExport(
  entry: ExportRegisterEntry,
  companyId: string,
  c: Pick<ReviewCase, 'economicCaseId' | 'accountingActionId'>,
  { storage = browserStorage(), locks = browserLocks() } = {},
): Promise<ExportReservation> {
  const critical = (): ExportReservation => {
    const existing = registeredExportsFor(readExportRegister(storage), companyId, c);
    if (existing.length) return { reserved: false, existing, persisted: true };
    return { reserved: true, existing: [], persisted: recordExport(entry, storage) };
  };
  return locks ? locks.request(EXPORT_LOCK, critical) : critical();
}

/** Removes one unreleased reservation whose file was never produced. */
export async function releaseExport(
  entry: Pick<ExportRegisterEntry, 'journalId' | 'exportedAt'>,
  { storage = browserStorage(), locks = browserLocks() } = {},
): Promise<boolean> {
  const critical = () => {
    if (!storage) return false;
    try {
      const kept = readExportRegister(storage).filter(
        (x) => !(x.journalId === entry.journalId && x.exportedAt === entry.exportedAt),
      );
      storage.setItem(EXPORT_REGISTER_KEY, JSON.stringify(kept));
      return true;
    } catch {
      return false;
    }
  };
  return locks ? locks.request(EXPORT_LOCK, critical) : critical();
}

export function registeredExportsFor(
  entries: ExportRegisterEntry[],
  companyId: string,
  c: Pick<ReviewCase, 'economicCaseId' | 'accountingActionId'>,
): ExportRegisterEntry[] {
  const key = companyKey(companyId);
  return entries.filter(
    (e) =>
      e.companyKey === key &&
      (e.economicCaseId === c.economicCaseId || e.accountingActionId === c.accountingActionId),
  );
}

/** Adds browser-recorded exports missing from a project copy; never removes history. */
export function applyExportRegister(
  state: ReviewProjectState,
  entries: ExportRegisterEntry[],
  companyId: string,
): ReviewProjectState {
  const merge = (c: ReviewCase): ReviewCase => {
    const missing = registeredExportsFor(entries, companyId, c).filter(
      (e) =>
        !c.exportHistory.some((h) => h.journalId === e.journalId && h.exportedAt === e.exportedAt),
    );
    if (!missing.length) return c;
    const next = structuredClone(c);
    next.exportHistory.push(
      ...missing.map((e) => ({
        journalId: e.journalId,
        proposalId: e.proposalId,
        proposalHash: e.proposalHash,
        exportedAt: e.exportedAt,
        status: 'UNKNOWN' as const,
        format: e.format,
      })),
    );
    if (next.existingImportStatus === 'NEVER_IMPORTED') next.existingImportStatus = 'UNKNOWN';
    if (next.proposal) {
      next.proposal.state = 'DRAFT';
      next.proposal.approval = null;
    }
    return next;
  };
  return { ...state, cases: state.cases.map(merge), orphanedCases: state.orphanedCases.map(merge) };
}
