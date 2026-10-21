import Papa from 'papaparse';
import { formatCents } from '../ingestion/primitives';
import { artifact, validateApprovedProposal, type ExportArtifact, type FeeProposal } from './aje';
export async function exportQboCsv(p: FeeProposal): Promise<ExportArtifact> {
  await validateApprovedProposal(p);
  const [y, m, d] = p.date.split('-');
  const content =
    Papa.unparse(
      {
        fields: [
          'Journal No.',
          'Journal Date',
          'Account Name',
          'Journal/Description',
          'Debits',
          'Credits',
        ],
        data: p.lines.map((l) => [
          p.journalId,
          `${m}/${d}/${y}`,
          l.account,
          l.memo,
          l.debitCents ? formatCents(l.debitCents) : '',
          l.creditCents ? formatCents(l.creditCents) : '',
        ]),
      },
      { newline: '\r\n' },
    ) + '\r\n';
  return artifact(content, p, 'csv');
}
