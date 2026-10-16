// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { createServer } from '../server.mjs';
import { SettingsService } from '../lib/service.mjs';

function fixture() {
  let saved;
  const store = { load: () => saved, save: value => { saved = structuredClone(value); } };
  return new SettingsService(store, { transport: async () => { throw new Error('Network must not be used by HTTP contract tests'); } });
}
async function running(t) {
  const service = fixture();
  const server = createServer(service);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { server, service, origin };
}
test('serves state without any credentials and with CSRF', async t => {
  const { origin } = await running(t);
  const response = await fetch(origin + '/api/state');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const state = await response.json();
  assert.equal(state.account, null); assert.equal(state.csrf.length, 64);
  assert.deepEqual(state.roles, []);
  assert.equal(state.deviceID, undefined);
});
test('rejects foreign origins and CSRF tokens', async t => {
  const { origin } = await running(t);
  for (const headers of [{ Origin: 'http://evil.test' }, { Origin: origin, 'X-CSRF-Token': 'bad' }, {}]) {
    const response = await fetch(origin + '/api/settings', { method: 'POST', headers, body: '{}' });
    assert.equal(response.status, 403);
  }
});
test('valid settings persist and invalid settings are explicit', async t => {
  const { origin, service } = await running(t);
  const { csrf } = await (await fetch(origin + '/api/state')).json();
  const headers = { Origin: origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' };
  const good = await fetch(origin + '/api/settings', { method: 'POST', headers, body: JSON.stringify({ intervalMinutes: 5 }) });
  assert.equal(good.status, 200); assert.equal(service.db.settings.intervalMinutes, 5);
  const bad = await fetch(origin + '/api/settings', { method: 'POST', headers, body: JSON.stringify({ intervalMinutes: 0 }) });
  assert.equal(bad.status, 400); assert.equal((await bad.json()).error.code, 'INVALID_INTERVAL');
});
test('rejects invalid JSON and unknown endpoints', async t => {
  const { origin } = await running(t);
  const { csrf } = await (await fetch(origin + '/api/state')).json();
  const headers = { Origin: origin, 'X-CSRF-Token': csrf };
  const bad = await fetch(origin + '/api/settings', { method: 'POST', headers, body: '[' });
  assert.equal(bad.status, 400); assert.equal((await bad.json()).error.code, 'INVALID_JSON');
  assert.equal((await fetch(origin + '/.local/state.json')).status, 404);
  assert.equal((await fetch(origin + '/lib/hoyo.mjs')).status, 404);
  assert.equal((await fetch(origin + '/api/unknown', { method: 'POST', headers, body: '{}' })).status, 404);
});
test('serves the settings UI and all local frontend assets', async t => {
  const { origin } = await running(t);
  for (const path of ['/', '/app.js', '/style.css']) {
    const res = await fetch(origin + path);
    assert.equal(res.status, 200, path);
    assert.ok((await res.text()).length > 200, path);
  }
});
test('source archive includes source but excludes saved credentials', async t => {
  const { origin } = await running(t);
  const res = await fetch(origin + '/source');
  assert.equal(res.status, 200);
  const content = Buffer.from(await res.arrayBuffer());
  const files = execFileSync('tar', ['-tzf', '-'], { input: content }).toString();
  assert.match(files, /lib\/hoyo\.mjs/);
  assert.match(files, /public\/index\.html/);
  assert.match(files, /LICENSE/);
  assert.doesNotMatch(files, /(^|\n)(?:\.local|node_modules|\.git)\//);
});
test('rejects a rebinding Host header', async t => {
  const { origin } = await running(t);
  const status = await new Promise((resolve, reject) => {
    const req = http.get(origin + '/api/state', { headers: { Host: 'foreign.test:18766' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(status, 403);
});
test('all mutations are serialized without duplicate parallel upstream calls', async t => {
  const { origin, service } = await running(t);
  const { csrf } = await (await fetch(origin + '/api/state')).json();
  let active = 0; let peak = 0;
  service.createQR = async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 15)); active--; };
  const headers = { Origin: origin, 'X-CSRF-Token': csrf };
  await Promise.all([1, 2, 3].map(() => fetch(origin + '/api/auth/qr', { method: 'POST', headers, body: '{}' })));
  assert.equal(peak, 1);
});
