import type { FeeProposal } from '../export/aje';
/** The visible review must still describe the exact approved date and reviewer. */
export function approvalMatchesView(
  proposal: FeeProposal | null,
  date: string,
  reviewer: string,
): proposal is FeeProposal {
  return (
    !!proposal &&
    proposal.state === 'APPROVED' &&
    proposal.date === date &&
    proposal.feeCase.journalDate === date &&
    proposal.approval?.reviewer === reviewer.trim() &&
    !!proposal.approval.payloadHash
  );
}
