import assert from 'node:assert/strict';
import test from 'node:test';

import { toSources } from '../lib/index.js';

test('maps Brave results onto the harness source shape', () => {
  const data = {
    web: {
      results: [
        { url: 'https://example.com/a', title: 'A', description: 'first', age: '2 days ago' },
        { url: 'https://example.com/b', description: 'second' },
      ],
    },
  };

  assert.deepEqual(toSources(data, 8), [
    { url: 'https://example.com/a', title: 'A', snippet: 'first', publishedAt: '2 days ago' },
    { url: 'https://example.com/b', snippet: 'second' },
  ]);
});

test('omits everything that would not survive a JSON round trip', () => {
  const data = {
    web: {
      results: [
        { url: 'https://example.com/a', title: null, description: undefined, age: 42 },
        { title: 'no url' },
        null,
      ],
    },
  };

  const sources = toSources(data, 8);

  assert.deepEqual(sources, [{ url: 'https://example.com/a' }]);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(sources))), JSON.stringify(sources));
});

test('enforces the result cap', () => {
  const data = { web: { results: Array.from({ length: 20 }, (_, i) => ({ url: `https://example.com/${i}` })) } };

  assert.equal(toSources(data, 3).length, 3);
});

test('tolerates malformed payloads', () => {
  assert.deepEqual(toSources(undefined, 8), []);
  assert.deepEqual(toSources({ web: { results: 'nope' } }, 8), []);
  assert.deepEqual(toSources({}, 8), []);
});
