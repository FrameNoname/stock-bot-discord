const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleInteraction, handleNews, commands } = require('../bot');

function interaction(commandName, ticker = null, guildId = 'test') {
  const replies = [];
  return { commandName, guildId, replies, isChatInputCommand: () => true,
    options: { getString: key => key === 'ticker' ? ticker : null },
    async deferReply() { this.deferred = true; },
    async reply(value) { this.replied = true; replies.push(value); },
    async editReply(value) { replies.push(typeof value === 'string' ? value : JSON.parse(JSON.stringify(value))); }
  };
}

test('news is displayed before AI returns and survives AI failure', async t => {
  const i = interaction('news', 'TEST');
  t.mock.method(global, 'fetch', async url => {
    if (url.includes('groq.com')) {
      assert.equal(i.replies.length, 1);
      assert.ok(i.replies[0].embeds[0].fields.some(f => f.name.includes('ข่าว')));
      return { ok: false, status: 503 };
    }
    const data = url.includes('/quote?') ? { c: 100, d: 1, dp: 1, h: 101, l: 99 }
      : url.includes('company-news') ? [{ headline: 'Test news', url: 'https://example.com' }] : { name: 'Test' };
    return { ok: true, json: async () => data };
  });
  await handleNews(i);
  assert.equal(i.replies.length, 2);
  assert.match(i.replies[1].embeds[0].description, /AI ยังไม่พร้อม/);
  assert.deepEqual(i.replies[0].embeds[0].fields, i.replies[1].embeds[0].fields);
});

test('watchlist rejects duplicates, enforces capacity, supports removal and isolates guilds', async () => {
  for (let n = 0; n < 25; n++) await handleInteraction(interaction('watch', 'S' + n));
  const duplicate = interaction('watch', 'S0');
  await handleInteraction(duplicate);
  assert.match(duplicate.replies[0].content, /มีหุ้นนี้/);
  const full = interaction('watch', 'EXTRA');
  await handleInteraction(full);
  assert.match(full.replies[0].content, /เต็ม/);
  const other = interaction('unwatch', 'S0', 'other');
  await handleInteraction(other);
  assert.match(other.replies[0].content, /ไม่มีหุ้น/);
  await handleInteraction(interaction('unwatch', 'S0'));
  const added = interaction('watch', 'EXTRA');
  await handleInteraction(added);
  assert.match(added.replies[0], /เพิ่ม/);
});

test('invalid tickers are rejected before requests and help serializes', async () => {
  const invalid = interaction('price', 'AAPL&token=x');
  await handleInteraction(invalid);
  assert.match(invalid.replies[0].content, /ไม่ถูกต้อง/);
  const help = interaction('help');
  await handleInteraction(help);
  assert.match(help.replies[0].embeds[0].toJSON().description, /\/unwatch/);
  for (const command of commands) assert.ok(command.toJSON().name);
});
