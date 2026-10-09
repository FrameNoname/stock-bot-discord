const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCache, fetchJson } = require('../lib/requests');

test('concurrent requests share one load, expire, and retry failures', async () => {
  let clock = 0;
  let calls = 0;
  const cached = createCache({ now: () => clock });
  const load = async () => ++calls;
  assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => cached('AAPL', 15, load))), Array(20).fill(1));
  clock = 14;
  assert.equal(await cached('AAPL', 15, load), 1);
  clock = 15;
  assert.equal(await cached('AAPL', 15, load), 2);
  await assert.rejects(cached('bad', 15, async () => { throw new Error('failed'); }));
  assert.equal(await cached('bad', 15, load), 3);
});

test('cache evicts oldest completed entries when full', async () => {
  const cached = createCache({ maxEntries: 2 });
  await cached('a', 10000, () => 1);
  await cached('b', 10000, () => 2);
  await cached('c', 10000, () => 3);
  assert.equal(await cached('a', 10000, () => 4), 4);
});

test('HTTP errors are reported without leaking upstream bodies', async t => {
  t.mock.method(global, 'fetch', async () => ({ ok: false, status: 429, text: async () => 'secret' }));
  await assert.rejects(fetchJson('https://example.test/?token=secret'), error => error.message.includes('429') && !error.message.includes('secret'));
});

test('a stalled request is aborted', async t => {
  t.mock.method(global, 'fetch', (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(fetchJson('https://example.test', {}, 10), { name: 'TimeoutError' }); }
  finally { clearTimeout(keepAlive); }
});
