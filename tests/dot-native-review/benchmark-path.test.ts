import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Exercise the exact script's path-selection preamble without rerunning 46 engine
// iterations per argument case. Full benchmark execution is recorded separately.
const script = readFileSync('scripts/benchmark-3000.ts', 'utf8');
const preamble = script.slice(script.indexOf('const args ='), script.indexOf('const COMPANY ='));
function output(args: string[] = [], env: Record<string, string> = {}) {
  return runInNewContext(`${preamble}\nOUTPUT;`, {
    process: { argv: ['node', 'benchmark-3000.ts', ...args], env },
    randomUUID: () => 'test-unique-run-id',
  }) as string;
}
describe('benchmark evidence output selection', () => {
  it('defaults to a unique run path outside historical evidence', () => {
    expect(output()).toMatch(
      /^evidence\/benchmark-runs\/benchmark-3000-.*-test-unique-run-id\.json$/,
    );
    expect(output()).not.toContain('implementation-20261021');
  });
  it('honors an environment destination', () => {
    expect(output([], { BENCHMARK_OUTPUT: '/tmp/explicit-run.json' })).toBe(
      '/tmp/explicit-run.json',
    );
  });
  it('lets explicit CLI override environment', () => {
    expect(output(['--output', '/tmp/cli.json'], { BENCHMARK_OUTPUT: '/tmp/env.json' })).toBe(
      '/tmp/cli.json',
    );
  });
  it('rejects empty env or malformed CLI rather than falling back silently', () => {
    expect(() => output([], { BENCHMARK_OUTPUT: ' ' })).toThrow(/empty/);
    for (const args of [['--output'], ['--out', 'x'], ['--output', ''], ['--output', 'x', 'extra']])
      expect(() => output(args)).toThrow(/Usage/);
  });
  it('retains exclusive writing and creates the selected parent, not the historic directory', () => {
    expect(script).toContain('await mkdir(dirname(OUTPUT), { recursive: true });');
    expect(script).toContain(
      "await writeFile(OUTPUT, JSON.stringify(output, null, 2) + '\\n', { flag: 'wx' });",
    );
  });
});
