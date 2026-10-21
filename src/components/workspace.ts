import type { ReconcileInput, ReconcileResult, EngineGroup } from '../contracts/engine';
import type { Provenance } from '../contracts/canonical';
import type { ParseOptions, SourceKind } from '../ingestion/types';
export interface SourceFile {
  name: string;
  kind: SourceKind;
  hash: string;
  sizeBytes?: number;
}
export interface Workspace {
  input: ReconcileInput;
  result: ReconcileResult;
  duration: number;
  isDemo: boolean;
  files: SourceFile[];
  options: ParseOptions;
  runId: string;
}
export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const humanize = (value: string) =>
  value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase());
export const dateLabel = (value: string) =>
  value
    ? new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(value + 'T12:00:00Z'))
    : 'Not supplied';
export const sourceName = (ref: Provenance, files: SourceFile[]) =>
  files.find((f) => f.hash === ref.file_sha256)?.name ?? 'Source file';
export const causeNames: Record<string, string> = {
  DATE_LAG: 'Settlement timing',
  NET_FEE_DRIFT: 'Settlement fee difference',
  UNBATCHED_REFUND: 'Unexported refund record',
  POST_EXPORT_DRIFT: 'Post-export change',
  OUT_OF_SYSTEM_DEPOSIT: 'Outside-system receipt',
  PROCESSOR_HOLD: 'Processor hold',
  UNEXPLAINED: 'Unexplained activity',
};
export function groupTitle(group: EngineGroup): string {
  if (group.bank_ids.length && !group.st_ids.length) return 'Unattributed bank activity';
  if (group.bank_cents >= 5000000 && (group.st_ids.length > 1 || !group.accepted))
    return 'Consolidated deposit';
  if (group.diagnoses.some((d) => d.cause === 'PROCESSOR_HOLD' && d.evidence_level === 'CONFIRMED'))
    return 'Documented processor hold';
  if (!group.bank_ids.length && group.gross_cents > 0) return 'Missing settlement';
  const diagnosis = group.diagnoses.find((d) => d.cause !== 'UNEXPLAINED');
  return diagnosis
    ? causeNames[diagnosis.cause]
    : group.matching_state === 'MATCHED'
      ? 'Verified three-way activity'
      : 'Activity bridge';
}
export const isReview = (group: EngineGroup) =>
  group.diagnoses.length > 0 ||
  !group.accepted ||
  group.unexplained_cents !== 0 ||
  group.ledger_residual_cents !== 0;
export function downloadText(name: string, content: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadEvidence(workspace: Workspace) {
  downloadText(
    `reconciliation-${workspace.runId}.json`,
    JSON.stringify(
      {
        scope: 'Read-only review workpaper; not an accounting import or proof of posting.',
        synthetic: workspace.isDemo,
        run_id: workspace.runId,
        source_files: workspace.files,
        manifests: workspace.input.manifests,
        result: workspace.result,
      },
      null,
      2,
    ),
    'application/json',
  );
}
