// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeRuntime, refreshBackground, bridgeTransport } from '../bridge/runtime.mjs';
import { bridgeCardProvider } from '../bridge/card-provider.mjs';

// No browser or local daemon: only the documented API 2 bridge is available.
globalThis.fetch = async () => { throw new Error('HTTP host must not be used in bridge mode'); };
const copy = value => value == null ? null : structuredClone(value);
function fixture() {
  const data = new Map(); const calls = []; const snapshots = [];
  let snapshot = null;
  const api = {
    storage: { get: async key => copy(data.get(key)), set: async (key, value) => { data.set(key, copy(value)); }, remove: async key => { data.delete(key); } },
    card: { readSnapshot: () => copy(snapshot), saveSnapshot: async value => { snapshot = copy(value); snapshots.push(copy(value)); } },
    net: { request: async request => {
      calls.push(copy(request));
      if (api.beforeRequest) await api.beforeRequest(request);
      const url = new URL(request.url); const path = url.pathname;
      let body;
      if (path.endsWith('/createQRLogin')) body = { url: 'https://example.invalid/login', ticket: 'SECRET_TICKET' };
      else if (path.endsWith('/queryQRLoginStatus')) body = { status: 'Confirmed', tokens: [{ token: 'v2_SECRET_STOKEN' }], user_info: { aid: 'account1', mid: 'SECRET_MID' } };
      else if (path.endsWith('/getCookieAccountInfoBySToken')) body = { cookie_token: 'SECRET_COOKIE', uid: 'account1' };
      else if (path.endsWith('/getFp')) body = { device_fp: 'SECRET_FP' };
      else if (path.endsWith('/getUserGameRolesByCookie')) {
        const biz = url.searchParams.get('game_biz');
        body = { list: [{ game_uid: biz, region: 'cn', nickname: biz, level: 1, region_name: '国服', is_chosen: true }] };
      } else if (api.failNotes) return { status: 200, body: JSON.stringify({ retcode: 1034, message: '验证失败' }) };
      else if (path.includes('genshin')) body = { current_resin: 20, max_resin: 200, finished_task_num: 2, total_task_num: 4 };
      else if (path.includes('hkrpg')) body = { current_stamina: 30, max_stamina: 300 };
      else body = { energy: { progress: { current: 40, max: 240 } } };
      return { status: 200, body: JSON.stringify({ retcode: 0, data: body }) };
    } },
  };
  return { api, data, calls, snapshots, snapshot: () => copy(snapshot) };
}
async function login(api) {
  const runtime = await createBridgeRuntime(api);
  await runtime.request('POST', '/api/auth/qr', {});
  await runtime.request('POST', '/api/auth/poll', {});
  return runtime;
}
test('card provider reads first snapshot synchronously and refreshes only the requested game after storage', async () => {
  const { api, calls, data } = fixture();
  await login(api);
  const before = calls.length;
  const provider = bridgeCardProvider(api);
  assert.deepEqual(provider.initialSnapshot, api.card.readSnapshot());
  assert.equal(provider.initialSnapshot.games.hsr.status, 'empty');
  assert.equal(calls.length, before);
  const snapshot = await provider.refresh('hsr');
  assert.equal(calls.length, before + 1);
  assert.equal(snapshot.games.hsr.status, 'ok');
  assert.equal(data.get('hoyolab.note.hsr').note.status, 'ok');
  assert.equal(snapshot.games.genshin.status, 'empty');
  assertPublic(snapshot);
  await assert.rejects(provider.refresh('invalid'));
});
function assertPublic(value) {
  const encoded = JSON.stringify(value);
  for (const secret of ['SECRET_STOKEN', 'SECRET_COOKIE', 'SECRET_MID', 'SECRET_FP', 'SECRET_TICKET']) assert.ok(!encoded.includes(secret));
}

test('bridge stores per-page custom backgrounds outside the card package', async () => {
  const { api, data } = fixture();
  const runtime = await login(api);
  const custom = 'data:image/jpeg;base64,' + 'A'.repeat(2048);
  const customBlur = 'data:image/jpeg;base64,' + 'B'.repeat(512);
  await runtime.request('POST', '/api/background', { page: 'home', mode: 'custom', custom, customBlur, width: 912, height: 596 });
  assert.equal(data.get('hoyolab.background.home').custom, custom);
  const read = await runtime.request('GET', '/api/background/home');
  assert.equal(read.value.customBlur, customBlur);
  const state = await runtime.request('GET', '/api/state');
  assert.equal(state.settings.backgrounds.home, 'custom');
  await runtime.request('POST', '/api/background', { page: 'home', mode: 'default' });
  assert.equal(data.get('hoyolab.background.home'), undefined);
  const reset = await runtime.request('GET', '/api/state');
  assert.equal(reset.settings.backgrounds.home, 'default');
});
test('bridge transport uses native request with explicit Cookie/DS, not Profile cookies or fetch', async () => {
  const { api, calls } = fixture();
  const transport = bridgeTransport(api);
  await transport('https://official.invalid/note', { method: 'POST', headers: { Cookie: 'secret', DS: 'signed', 'x-rpc-device_fp': 'fp' }, body: '{}' }, 'qr.query');
  assert.deepEqual(calls[0], { url: 'https://official.invalid/note', method: 'POST', headers: { Cookie: 'secret', DS: 'signed', 'x-rpc-device_fp': 'fp', 'Accept-Encoding': 'identity' }, body: '{}', cookies: false, redirect: 'manual', responseType: 'text', timeoutMs: 15000 });
  api.net.request = async () => { throw { code: 'TIMEOUT' }; };
  await assert.rejects(transport('https://official.invalid', {}, 'note'), { code: 'TIMEOUT', stage: 'note' });
  api.net.request = async () => ({ status: 302, body: '' });
  await assert.rejects(transport('https://official.invalid', {}, 'note'), { code: 302 });
});

test('same QR→SToken→Cookie→FP path runs entirely through bridge and survives a fresh context', async () => {
  const { api, data, calls } = fixture();
  const runtime = await login(api);
  const state = await runtime.request('GET', '/api/state');
  assert.equal(state.runtime.mode, 'bridge'); assert.equal(state.runtime.scheduler, 'bridge');
  assert.equal(state.account.tokenVersion, 'v2'); assert.equal(state.roles.length, 3); assertPublic(state);
  assert.ok(data.get('hoyolab.auth').account.cookie.includes('stoken=v2_SECRET_STOKEN'));
  const device = data.get('hoyolab.identity').deviceID;
  const before = calls.length;
  const reopened = await createBridgeRuntime(api);
  const restored = await reopened.request('GET', '/api/state');
  assert.equal(calls.length, before); assert.equal(restored.account.id, state.account.id);
  assert.equal(data.get('hoyolab.identity').deviceID, device);
  const result = await reopened.request('POST', '/api/notes/refresh', { game: 'genshin' });
  assert.equal(result.notes.genshin.status, 'ok'); assertPublic(result);
  assert.ok(calls.every(call => call.url.startsWith('https://')));
  const settings = await reopened.request('POST', '/api/settings', { intervalMinutes: 1, selectedRoles: restored.settings.selectedRoles });
  assert.equal(settings.settings.intervalMinutes, 15, 'bridge does not pretend a webpage field changes native scheduling');
});

test('independent background context updates cache + safe snapshot without rewriting auth/settings', async () => {
  const { api, data, snapshots, calls } = fixture();
  const runtime = await login(api);
  const authBefore = copy(data.get('hoyolab.auth')); const settingsBefore = copy(data.get('hoyolab.settings'));
  const callStart = calls.length;
  data.set('hoyolab.card.page', 0);
  const result = await refreshBackground(api);
  assert.equal(result.refreshed, 3);
  assert.equal(snapshots.at(-1).page, 0, '后台刷新保留已存储的简洁页位置');
  assert.deepEqual(data.get('hoyolab.auth'), authBefore); assert.deepEqual(data.get('hoyolab.settings'), settingsBefore);
  assert.equal(Object.values(snapshots.at(-1).games).filter(game => game.status === 'ok').length, 3); assertPublic(snapshots.at(-1));
  assert.ok(calls.slice(callStart).every(call => call.timeoutMs === 3000));
  const state = await runtime.request('GET', '/api/state');
  assert.equal(state.notes.hsr.status, 'ok'); assert.equal(state.notes.zzz.status, 'ok'); assertPublic(state);
  const beforeFailure = snapshots.length;
  api.failNotes = true;
  assert.equal((await refreshBackground(api)).refreshed, 0);
  assert.equal(snapshots.length, beforeFailure, 'all-failed refresh retains the last good frame');
  const failed = await runtime.request('GET', '/api/state');
  assert.equal(failed.notes.hsr.status, 'error'); assert.equal(failed.notes.hsr.attempts.length, 2);
  const removed = await runtime.request('POST', '/api/account/remove', {});
  assert.equal(removed.account, null); assert.ok(Object.values(snapshots.at(-1).games).every(game => game.status === 'empty' && game.primary.current === null));
  const mark = calls.length;
  assert.equal((await refreshBackground(api)).refreshed, 0); assert.equal(calls.length, mark);
  assertPublic([...data.values()]);
});

test('foreground logout while background request is in flight cannot resurrect auth or publish old snapshot', async () => {
  const { api, data, snapshots } = fixture();
  await login(api);
  let cleared = false;
  api.beforeRequest = async request => {
    if (!cleared && request.url.includes('/dailyNote')) {
      cleared = true;
      const auth = copy(data.get('hoyolab.auth'));
      auth.account = null; auth.pending = null; auth.profiles = {}; auth.roles = [];
      await api.storage.set('hoyolab.auth', auth);
      await api.storage.set('hoyolab.settings', { selectedRoles: {}, intervalMinutes: 15 });
    }
  };
  const mark = snapshots.length;
  await refreshBackground(api);
  assert.equal(data.get('hoyolab.auth').account, null);
  assert.deepEqual(data.get('hoyolab.settings').selectedRoles, {});
  assert.equal(snapshots.length, mark);
  assert.equal(data.has('hoyolab.note.genshin'), false, 'stale note was never written');
});

test('bridge failures keep their actual stage and partial confirmation is persisted before Token exchange', async () => {
  const { api, data } = fixture();
  api.beforeRequest = async request => {
    if (request.url.includes('getCookieAccountInfoBySToken')) {
      assert.equal(data.get('hoyolab.auth').pending.stoken, 'v2_SECRET_STOKEN');
      throw { code: 'TIMEOUT' };
    }
  };
  const runtime = await createBridgeRuntime(api);
  await runtime.request('POST', '/api/auth/qr', {});
  await assert.rejects(runtime.request('POST', '/api/auth/poll', {}), error => {
    assert.equal(error.detail.stage, 'auth.cookieToken'); assert.equal(error.detail.code, 'TIMEOUT'); assertPublic(error.payload); return true;
  });
  api.beforeRequest = null;
  const reopened = await createBridgeRuntime(api);
  assert.ok((await reopened.request('POST', '/api/auth/complete', {})).account);
});
