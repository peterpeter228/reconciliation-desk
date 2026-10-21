import type { ColumnBindings, SourceKind } from './aliases';
import { canonicalJson, sha256 } from '../ingestion/primitives';
export interface ReviewedMapping {
  companyId: string;
  sourceKind: SourceKind;
  headers: string[];
  columnTypeSignature: string[];
  dateConvention: 'MDY' | 'ISO';
  signConvention: string;
  rowGrain: string;
  schemaVersion: '1.0';
  bindings: ColumnBindings;
  excludedTargets?: string[];
  reviewed: true;
}
/** A key only; caller may store mappings, never raw transactions or sample rows. */
export async function mappingCacheKey(mapping: ReviewedMapping): Promise<string> {
  if (!mapping.reviewed || !mapping.companyId.trim())
    throw new Error('Only company-scoped reviewed mappings may be cached.');
  return sha256(
    canonicalJson({ ...mapping, excludedTargets: [...(mapping.excludedTargets ?? [])].sort() }),
  );
}
