import { expect, test } from 'vitest';
import { jsonDiff } from './diff.js';

test('equal values have no diff', () => {
  expect(jsonDiff({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual([]);
});

test('reports changed, added and removed leaves with paths', () => {
  expect(jsonDiff({ error: 'Internal error', a: 1, list: [1, 2] }, { error: 'Bad', b: 2, list: [1] })).toEqual([
    { path: 'a', kind: 'removed', prod: 1 },
    { path: 'b', kind: 'added', staging: 2 },
    { path: 'error', kind: 'changed', prod: 'Internal error', staging: 'Bad' },
    { path: 'list[1]', kind: 'removed', prod: 2 },
  ]);
});

test('different types at the root', () => {
  expect(jsonDiff(null, { a: 1 })).toEqual([{ path: '$', kind: 'changed', prod: null, staging: { a: 1 } }]);
});
