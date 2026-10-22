import type { FeeProposal } from '../export/aje';
export interface ReviewExportRecord {
  journalId: string;
  proposalId: string;
  proposalHash: string;
  exportedAt: string;
  status: 'EXPORTED_NOT_POSTED' | 'UNKNOWN' | 'PARTIAL' | 'IMPORTED';
  format: 'csv' | 'iif';
}
export interface ReviewCase {
  economicCaseId: string;
  accountingActionId: string;
  engineGroupId: string;
  anchors: string[];
  inputDigest: string;
  identityStatus: 'BOUND' | 'UNCERTAIN';
  reviewedFacts: Record<string, unknown>;
  proposal?: FeeProposal;
  exportHistory: ReviewExportRecord[];
  existingImportStatus: 'NEVER_IMPORTED' | 'UNKNOWN' | 'PARTIAL' | 'IMPORTED';
}
export interface ReviewProjectState {
  schemaVersion: 1;
  inputDigest: string;
  cases: ReviewCase[];
  orphanedCases: ReviewCase[];
}
