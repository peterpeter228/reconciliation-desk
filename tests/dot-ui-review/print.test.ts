import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('PRINT-01 hides the keyboard skip link only in print while retaining screen focus access', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  const start = css.indexOf('@media print {');
  expect(start).toBeGreaterThan(-1);
  let depth = 1;
  let end = start + '@media print {'.length;
  while (depth && end < css.length) {
    if (css[end] === '{') depth++;
    if (css[end] === '}') depth--;
    end++;
  }
  const print = css.slice(start, end);
  const screen = css.slice(0, start) + css.slice(end);
  const hidden = [...print.matchAll(/([^{}]+)\{\s*display:\s*none\s*!important;\s*\}/g)];
  expect(
    hidden.some((rule) => rule[1].split(',').some((selector) => selector.trim() === '.skip-link')),
  ).toBe(true);
  expect(screen).toMatch(/\.skip-link\s*\{[^}]*position:\s*fixed;[^}]*top:\s*-100px;/);
  expect(screen).toMatch(/\.skip-link:focus\s*\{\s*top:\s*10px;\s*\}/);
  expect(screen).not.toMatch(/\.skip-link(?:[\s,:][^{}]*)?\{[^}]*display:\s*none/);
});
