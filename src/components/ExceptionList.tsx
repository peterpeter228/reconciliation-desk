import { useEffect, useMemo, useState } from 'react';
import { Search, ChevronRight, ArrowDownWideNarrow } from 'lucide-react';
import type { EngineGroup } from '../contracts/engine';
import { money, groupTitle, isReview, type Workspace } from './workspace';
import { Status } from './ui';
export function ExceptionList({
  workspace,
  selectedId,
  onSelect,
}: {
  workspace: Workspace;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('review');
  const groups = useMemo(
    () =>
      workspace.result.groups
        .filter(
          (g) =>
            filter === 'all' ||
            (filter === 'ambiguous' ? g.matching_state === 'AMBIGUOUS' : isReview(g)),
        )
        .filter((g) => {
          if (!query.trim()) return true;
          const records = [
            ...workspace.input.st.filter((r) => g.st_ids.includes(r.id)),
            ...workspace.input.qb.filter((r) => g.qb_ids.includes(r.id)),
            ...workspace.input.bank.filter((r) => g.bank_ids.includes(r.id)),
          ];
          return (
            JSON.stringify(records).toLowerCase().includes(query.toLowerCase()) ||
            groupTitle(g).toLowerCase().includes(query.toLowerCase())
          );
        })
        .sort((a, b) => b.impact_cents - a.impact_cents || a.id.localeCompare(b.id)),
    [workspace, query, filter],
  );
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        !(e.key === 'j' || e.key === 'k') ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        document.querySelector('dialog[open]')
      )
        return;
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return;
      const current = groups.findIndex((g) => g.id === selectedId);
      const next =
        e.key === 'j' ? Math.min(groups.length - 1, current + 1) : Math.max(0, current - 1);
      if (groups[next]) {
        e.preventDefault();
        onSelect(groups[next].id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [groups, selectedId, onSelect]);
  return (
    <aside className="queue panel" aria-label="Reconciliation review queue">
      <div className="queue-heading">
        <h2>
          Review queue <span className="muted-count">{groups.length}</span>
        </h2>
        <span className="queue-sort">
          <ArrowDownWideNarrow size={14} />
          Amount
        </span>
      </div>
      <div className="queue-controls">
        <label className="search-box">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a payment or reference"
            aria-label="Search local records"
          />
        </label>
        <div className="filter-row" aria-label="Filter cases">
          {[
            ['review', 'Needs review'],
            ['all', 'All activity'],
            ['ambiguous', 'Ambiguous'],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={filter === value ? 'active' : ''}
              aria-pressed={filter === value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="queue-list">
        {groups.map((g) => (
          <QueueRow
            key={g.id}
            group={g}
            selected={g.id === selectedId}
            onClick={() => onSelect(g.id)}
          />
        ))}
        {!groups.length && (
          <div className="empty-small">
            <Search size={23} />
            <p>No cases in this view.</p>
            <button
              className="text-button"
              onClick={() => {
                setQuery('');
                setFilter('all');
              }}
            >
              Show all activity
            </button>
          </div>
        )}
      </div>
      <div className="queue-footer">
        Largest impact first <span>J / K to move</span>
      </div>
    </aside>
  );
}
function QueueRow({
  group,
  selected,
  onClick,
}: {
  group: EngineGroup;
  selected: boolean;
  onClick: () => void;
}) {
  const verified = group.matching_scope === 'VERIFIED_THREE_WAY';
  return (
    <button
      className={`queue-row ${selected ? 'selected' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
    >
      <div className="queue-row-main">
        <strong>{money(group.impact_cents)}</strong>
        <span>{groupTitle(group)}</span>
        <small>
          {group.st_ids.length} ST · {group.qb_ids.length} QB · {group.bank_ids.length} bank rows
        </small>
      </div>
      <div className="queue-row-end">
        <Status tone={verified ? 'green' : group.matching_state === 'BLOCKED' ? 'red' : 'amber'}>
          {verified
            ? 'Verified'
            : group.matching_state === 'AMBIGUOUS'
              ? 'Ambiguous'
              : group.matching_state === 'PARTIAL'
                ? 'Partial'
                : 'To review'}
        </Status>
        <ChevronRight size={16} />
      </div>
    </button>
  );
}
