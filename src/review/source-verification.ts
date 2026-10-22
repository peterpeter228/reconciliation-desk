import type { SourceFile, Workspace } from '../components/workspace';
import type { ParseOptions, ParseResult } from '../ingestion/types';
import { canonicalJson } from '../ingestion/primitives';

/**
 * A reopened project holds normalized rows, not original bytes. Its integrity hash
 * is unkeyed, so rows and flags can be edited and re-hashed. Accounting drafts from
 * a reopened project therefore require each original source file to be re-attached
 * and deterministically re-parsed to the identical saved rows and manifest.
 */
export interface RestoredSources {
  verifiedHashes: string[];
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;
const byId = (rows: unknown[]) =>
  [...rows].sort((a, b) =>
    String((a as { id?: unknown }).id).localeCompare(String((b as { id?: unknown }).id)),
  );

export function savedRowsFor(w: Workspace, hash: string): unknown[] {
  const evidence = w.input.evidence ?? {};
  const all: { source_refs?: { file_sha256: string }[] }[] = [
    ...w.input.st,
    ...w.input.qb,
    ...w.input.bank,
    ...Object.values(evidence).flatMap((rows) => (Array.isArray(rows) ? rows : [])),
  ];
  return all.filter((row) => row.source_refs?.some((ref) => ref.file_sha256 === hash));
}

export function unverifiedSources(w: Workspace): SourceFile[] {
  if (!w.restoredSources || w.isDemo) return [];
  const verified = new Set(w.restoredSources.verifiedHashes);
  return w.files.filter((f) => !verified.has(f.hash));
}

/** Null when an accounting draft may rely on the workspace rows. */
export function sourceTrustBlocker(w: Workspace): string | null {
  const missing = unverifiedSources(w);
  if (!missing.length) return null;
  return `This project was reopened from saved normalized rows. Re-attach the original source files (${missing
    .map((f) => f.name)
    .join(
      ', ',
    )}) under “Verify original sources” before any accounting draft or reviewed deposit instructions. Investigation workpapers remain available.`;
}

export function reparseOptions(file: SourceFile, bytes: Uint8Array): ParseOptions | null {
  if (!file.parseOptions) return null;
  const { originalBytes: _bytes, seenFileHashes: _seen, ...saved } = file.parseOptions;
  return {
    ...saved,
    fileName: file.name,
    originalBytes: bytes,
    ...(file.sheetName ? { sheetName: file.sheetName } : {}),
  } as ParseOptions;
}

/** Null when the re-parsed original reproduces the saved rows and manifest exactly. */
export function compareReparsedSource(
  w: Workspace,
  file: SourceFile,
  parsed: Pick<ParseResult<unknown>, 'ok' | 'manifest' | 'issues'> & { rows: readonly unknown[] },
): string | null {
  if (!parsed.ok || !parsed.manifest)
    return `${file.name} no longer validates with its saved import settings (${
      parsed.issues.find((i) => i.severity === 'error')?.message ?? 'validation failed'
    }). Re-import the original files.`;
  if (parsed.manifest.source_file_sha256 !== file.hash)
    return `${file.name} has different bytes from the file used when the project was saved.`;
  const saved = canonicalJson(byId(plain(savedRowsFor(w, file.hash))));
  const fresh = canonicalJson(byId(plain(parsed.rows as unknown[])));
  if (saved !== fresh)
    return `${file.name}: the saved normalized rows differ from rows re-derived from the original bytes. The project was modified or saved by a different parser version. Re-import the original files.`;
  const manifest = w.input.manifests.find((m) => m.source_file_sha256 === file.hash);
  if (canonicalJson(plain(manifest)) !== canonicalJson(plain(parsed.manifest)))
    return `${file.name}: the saved import manifest differs from the re-derived manifest. Re-import the original files.`;
  return null;
}

export function markSourceVerified(w: Workspace, hash: string): Workspace {
  if (!w.restoredSources) return w;
  return {
    ...w,
    restoredSources: {
      verifiedHashes: [...new Set([...w.restoredSources.verifiedHashes, hash])].sort(),
    },
  };
}
