import { useRef } from 'react';
import { FileCheck2 } from 'lucide-react';
import type { Workspace } from './workspace';
import { Status } from './ui';

/** Re-binds a reopened project's saved rows to the user's original files. */
export function SourceVerification({
  workspace: w,
  busy,
  onVerify,
}: {
  workspace: Workspace;
  busy: boolean;
  onVerify: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  if (!w.restoredSources || w.isDemo) return null;
  const verified = new Set(w.restoredSources.verifiedHashes);
  const remaining = w.files.filter((f) => !verified.has(f.hash)).length;
  return (
    <section className="panel source-verification" aria-label="Verify original sources">
      <div className="source-verification-heading">
        <h2>Verify original sources</h2>
        <Status tone={remaining ? 'amber' : 'green'}>
          {remaining ? `${remaining} of ${w.files.length} not re-verified` : 'All re-verified'}
        </Status>
      </div>
      <p className="body-muted">
        {remaining
          ? 'This project was reopened from saved rows. Investigation and workpapers are available now. Accounting drafts and reviewed deposit instructions stay blocked until each original export is re-attached and re-parsed to exactly the saved rows. Files are read locally and not uploaded.'
          : 'Every saved row was re-derived from the original files in this browser session.'}
      </p>
      <ul className="source-verification-list">
        {w.files.map((f) => (
          <li key={f.hash}>
            <span>
              <strong>{f.name}</strong> · {f.kind}
            </span>
            <span className={verified.has(f.hash) ? 'verified' : 'pending'}>
              {verified.has(f.hash) ? 'Re-verified' : 'Original not attached'}
            </span>
          </li>
        ))}
      </ul>
      {remaining > 0 && (
        <label className="button button-secondary">
          <FileCheck2 size={16} />
          Choose original files
          <input
            ref={input}
            aria-label="Choose original source files to verify"
            type="file"
            multiple
            accept=".csv,.tsv,.xlsx"
            hidden
            disabled={busy}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (files.length) onVerify(files);
            }}
          />
        </label>
      )}
    </section>
  );
}
