'use strict';

// Share pending reads as well as successful responses. Failed reads are never cached.
function createCache({ now = Date.now, maxEntries = 500 } = {}) {
  const values = new Map();
  const pending = new Map();
  return function cached(key, ttl, load) {
    const entry = values.get(key);
    if (entry && entry.expires > now()) return Promise.resolve(entry.value);
    values.delete(key);
    if (pending.has(key)) return pending.get(key);
    const request = Promise.resolve().then(load).then(value => {
      if (values.size >= maxEntries) values.delete(values.keys().next().value);
      values.set(key, { value, expires: now() + ttl });
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}

async function fetchJson(url, options = {}, timeoutMs = 10_000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  // Do not expose request URLs or upstream bodies: they can contain API credentials.
  if (!response.ok) throw new Error(`บริการข้อมูลตอบกลับ HTTP ${response.status}`);
  const data = await response.json();
  if (data?.error) throw new Error('บริการข้อมูลไม่สามารถประมวลผลคำขอได้');
  return data;
}

module.exports = { createCache, fetchJson };
