import { assertCents, sumCents } from './money';
export interface SubsetItem {
  id: string;
  cents: number;
}
export interface SubsetOptions {
  max_candidates?: number;
  max_members?: number;
  max_nodes?: number;
  budget_ms?: number;
  now?: () => number;
}
export interface SubsetResult {
  status:
    'UNIQUE_CANDIDATE' | 'NO_MATCH' | 'AMBIGUOUS' | 'CANDIDATE_CAP' | 'CARDINALITY_CAP' | 'TIMEOUT';
  solutions: string[][];
  complete: boolean;
  visited_nodes: number;
}
export function boundedSubsetSum(
  input: SubsetItem[],
  target: number,
  options: SubsetOptions = {},
): SubsetResult {
  assertCents(target, 'subset target', false);
  if (target <= 0) throw new Error('Positive target required');
  const items = [...input].sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(items.map((x) => x.id)).size !== items.length)
    throw new Error('Subset IDs must be unique');
  for (const item of items) {
    assertCents(item.cents, 'subset item', false);
    if (item.cents <= 0) throw new Error('Subset items must be positive');
  }
  const maxCandidates = options.max_candidates ?? 28,
    maxMembers = options.max_members ?? 8,
    maxNodes = options.max_nodes ?? 100_000;
  if (
    ![maxCandidates, maxMembers, maxNodes].every((x) => Number.isInteger(x) && x > 0) ||
    maxCandidates > 28 ||
    maxMembers > 28
  )
    throw new Error('Invalid search limits');
  let nodes = 0;
  const result = (
    status: SubsetResult['status'],
    solutions: string[][] = [],
    complete = false,
  ): SubsetResult => ({ status, solutions, complete, visited_nodes: nodes });
  if (items.length > maxCandidates) return result('CANDIDATE_CAP');
  const now = options.now ?? (() => performance.now());
  const start = now();
  const budget = Math.min(options.budget_ms ?? 80, 80);
  if (!Number.isFinite(budget) || budget < 0) throw new Error('Invalid time budget');
  const check = () => {
    nodes++;
    if (nodes > maxNodes || (nodes % 64 === 1 && now() - start >= budget))
      throw new Error('SEARCH_TIMEOUT');
  };
  const cardinalityCanHide =
    items.length > maxMembers &&
    sumCents(
      items
        .map((x) => x.cents)
        .sort((a, b) => a - b)
        .slice(0, maxMembers + 1),
    ) <= target;
  type State = { sum: number; ids: string[] };
  const enumerate = (part: SubsetItem[]): State[] => {
    const out: State[] = [];
    const walk = (i: number, sum: number, ids: string[]) => {
      check();
      out.push({ sum, ids });
      if (ids.length === maxMembers) return;
      for (let j = i; j < part.length; j++) {
        const item = part[j]!;
        const next = sum + item.cents;
        if (next <= target) walk(j + 1, next, [...ids, item.id]);
      }
    };
    walk(0, 0, []);
    return out;
  };
  const solutions: string[][] = [];
  const found = new Set<string>();
  try {
    const middle = Math.ceil(items.length / 2),
      left = enumerate(items.slice(0, middle)),
      right = enumerate(items.slice(middle));
    const index = new Map<number, Map<number, string[][]>>();
    for (const s of right) {
      check();
      let counts = index.get(s.sum);
      if (!counts) index.set(s.sum, (counts = new Map()));
      let reps = counts.get(s.ids.length);
      if (!reps) counts.set(s.ids.length, (reps = []));
      if (reps.length < 2) reps.push(s.ids);
    }
    for (const l of left) {
      check();
      for (const [count, reps] of index.get(target - l.sum) ?? []) {
        if (l.ids.length + count < 1 || l.ids.length + count > maxMembers) continue;
        for (const ids of reps) {
          const idsAll = [...l.ids, ...ids].sort();
          const key = JSON.stringify(idsAll);
          if (!found.has(key)) {
            found.add(key);
            solutions.push(idsAll);
          }
          if (solutions.length >= 2) return result('AMBIGUOUS', solutions.slice(0, 2));
        }
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message === 'SEARCH_TIMEOUT') return result('TIMEOUT', solutions);
    throw e;
  }
  if (cardinalityCanHide) return result('CARDINALITY_CAP', solutions);
  return result(solutions.length ? 'UNIQUE_CANDIDATE' : 'NO_MATCH', solutions, true);
}
