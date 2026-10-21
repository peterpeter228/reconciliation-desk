import { formatCents } from '../ingestion/primitives';
import { artifact, validateApprovedProposal, type ExportArtifact, type FeeProposal } from './aje';
export async function exportQbdIif(p: FeeProposal): Promise<ExportArtifact> {
  await validateApprovedProposal(p);
  const [y, m, d] = p.date.split('-');
  const rows = [
    ['!TRNS', 'TRNSTYPE', 'DATE', 'ACCNT', 'AMOUNT', 'DOCNUM', 'MEMO'],
    ['!SPL', 'TRNSTYPE', 'DATE', 'ACCNT', 'AMOUNT', 'DOCNUM', 'MEMO'],
    ['!ENDTRNS'],
    ...p.lines.map((l, index) => [
      index === 0 ? 'TRNS' : 'SPL',
      'GENERAL JOURNAL',
      `${m}/${d}/${y}`,
      l.account,
      formatCents(l.debitCents - l.creditCents),
      p.journalId,
      l.memo,
    ]),
    ['ENDTRNS'],
  ];
  for (const row of rows)
    for (const field of row)
      if (/[^\x20-\x7e]/.test(field))
        throw new Error(
          'QBD candidate IIF requires ASCII names. No silent transliteration is permitted.',
        );
  return artifact(rows.map((r) => r.join('\t')).join('\r\n') + '\r\n', p, 'iif');
}
