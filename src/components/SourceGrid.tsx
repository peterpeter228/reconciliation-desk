import { useState } from 'react';
import { FileText, ArrowUpRight, CircleDashed } from 'lucide-react';
import type {
  Bank_Deposit_Row,
  QB_Ledger_Entry,
  ST_Payment_Record,
  BaseRecord,
} from '../contracts/canonical';
import type { EngineGroup } from '../contracts/engine';
import { money, dateLabel, humanize, sourceName, type Workspace } from './workspace';
import { Modal, Status } from './ui';
type Row = ST_Payment_Record | QB_Ledger_Entry | Bank_Deposit_Row;
export function SourceGrid({ group, workspace }: { group: EngineGroup; workspace: Workspace }) {
  const [inspect, setInspect] = useState<Row | null>(null);
  const sources = [
    {
      name: 'ServiceTitan',
      abbreviation: 'ST',
      rows: workspace.input.st.filter((r) => group.st_ids.includes(r.id)),
      empty: 'No linked receipt in the supplied ST activity.',
    },
    {
      name: 'QuickBooks',
      abbreviation: 'QB',
      rows: workspace.input.qb.filter((r) => group.qb_ids.includes(r.id)),
      empty: 'No linked posting in the supplied ledger.',
    },
    {
      name: 'Bank',
      abbreviation: 'BK',
      rows: workspace.input.bank.filter((r) => group.bank_ids.includes(r.id)),
      empty: 'No linked posted deposit in the supplied bank activity.',
    },
  ];
  return (
    <>
      <div className="source-grid">
        {sources.map((source) => (
          <section className="source-column" key={source.name}>
            <div className="source-heading">
              <span className="source-monogram">{source.abbreviation}</span>
              <h3>{source.name}</h3>
              <span className="muted-count">{source.rows.length}</span>
            </div>
            {source.rows.length ? (
              <div className="source-rows">
                {source.rows.slice(0, 8).map((row) => (
                  <SourceRow
                    key={row.id}
                    row={row}
                    workspace={workspace}
                    onInspect={() => setInspect(row)}
                  />
                ))}
                {source.rows.length > 8 && (
                  <details className="more-rows">
                    <summary>Show {source.rows.length - 8} more source rows</summary>
                    {source.rows.slice(8).map((row) => (
                      <SourceRow
                        key={row.id}
                        row={row}
                        workspace={workspace}
                        onInspect={() => setInspect(row)}
                      />
                    ))}
                  </details>
                )}
              </div>
            ) : (
              <div className="source-empty">
                <CircleDashed size={28} />
                <strong>Not found in scope</strong>
                <p>{source.empty}</p>
                <small>Absence is not proof of the cause.</small>
              </div>
            )}
          </section>
        ))}
      </div>
      {inspect && (
        <Modal title="Source row & provenance" onClose={() => setInspect(null)} wide>
          <p className="body-muted">
            The normalized record below is tied to the original file and physical row. Original
            transaction text stays local.
          </p>
          <div className="provenance-block">
            {inspect.source_refs.map((ref, i) => (
              <div key={i}>
                <strong>{sourceName(ref, workspace.files)}</strong>
                <p>
                  Physical row {ref.physical_row} · {ref.sheet ?? 'CSV'} · Parser{' '}
                  {ref.parser_version}
                </p>
                <label>File SHA-256</label>
                <code>{ref.file_sha256}</code>
                <label>Raw row SHA-256</label>
                <code>{ref.raw_row_sha256}</code>
              </div>
            ))}
          </div>
          <dl className="record-fields">
            {Object.entries(inspect)
              .filter(
                ([key]) => !['source_refs', 'id', 'customer_token', 'name_token'].includes(key),
              )
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{humanize(key)}</dt>
                  <dd>
                    {value === null
                      ? 'Not supplied'
                      : typeof value === 'object'
                        ? JSON.stringify(value)
                        : typeof value === 'boolean'
                          ? String(value)
                          : String(value)}
                  </dd>
                </div>
              ))}
          </dl>
        </Modal>
      )}
    </>
  );
}
function SourceRow({
  row,
  workspace,
  onInspect,
}: {
  row: Row;
  workspace: Workspace;
  onInspect: () => void;
}) {
  let id: string, amount: number, date: string, type: string, detail: string;
  if ('source_payment_id' in row) {
    id = row.source_payment_id ?? row.accounting_batch_id ?? 'No source ID';
    amount = row.gross_cents;
    date = row.payment_date;
    type = humanize(row.record_type);
    detail = [row.payment_method, row.accounting_batch_id && `Batch ${row.accounting_batch_id}`]
      .filter(Boolean)
      .join(' · ');
  } else if ('transaction_id' in row) {
    id = row.transaction_id ?? row.num ?? 'No transaction ID';
    amount = row.signed_cents;
    date = row.posting_date;
    type = row.credit_cents ? 'Credit' : 'Debit';
    detail = row.account_full_name;
  } else {
    id = row.deposit_id ?? row.source_transaction_id ?? row.trace_id ?? 'No source ID';
    amount = row.signed_cents;
    date = row.posted_date;
    type = row.pending ? 'Pending' : 'Posted';
    detail = row.description_local;
  }
  return (
    <div className="source-row">
      <div className="source-row-top">
        <span>{dateLabel(date)}</span>
        <span>{type}</span>
      </div>
      <strong className="source-amount">{money(amount)}</strong>
      <div className="source-id">{id}</div>
      <p className="source-description">{detail}</p>
      <button className="provenance-button" onClick={onInspect}>
        <FileText size={14} />
        <span>
          {row.source_refs[0] ? sourceName(row.source_refs[0], workspace.files) : 'View provenance'}
          <small>Row {row.source_refs[0]?.physical_row ?? 'unknown'}</small>
        </span>
        <ArrowUpRight size={14} />
      </button>
    </div>
  );
}
