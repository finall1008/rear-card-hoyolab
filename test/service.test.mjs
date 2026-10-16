// SPDX-License-Identifier: AGPL-3.0-or-later
// This file is part of rear-card-hoyolab and is licensed under AGPL-3.0-or-later.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { makeDS, WIDGET_UA } from '../lib/hoyo.mjs';
import { SettingsService } from '../lib/service.mjs';
import { FileStore, initialState } from '../lib/store.mjs';

globalThis.fetch = async () => {
  throw new Error('external network is disabled in tests');
};

const BBS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) miHoYoBBS/2.40.1';
const DEVICE = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const DEVICE_MD5 = 'c2610e51de2e0fa5c7f50c3e6a5d4386';
const TICKET = 'ticket-SECRET-value';
const STOKEN = 'v2_STOKEN-secret';
const COOKIE_TOKEN = 'COOKIE-TOKEN-secret';
const MID = 'MID-secret';
const AID = 'aid-visible';
const DECOY_LTOKEN = 'decoy-ltoken';
const SECOND_TOKEN = 'second-token-ignored';
const UID_LOSES = 'uid-loses';
const ACCOUNT_LOSES = 'account-loses';
const EXCHANGE_UID = 'uid-from-exchange';
const TEMP_PREFIX = 'rear-card-hoyolab-test-';

class MemoryStore {
  constructor(state = null) {
    this.state = state == null ? null : structuredClone(state);
  }
  load() {
    return this.state == null ? null : structuredClone(this.state);
  }
  save(state) {
    this.state = structuredClone(state);
  }
}

function noNetwork() {
  return async () => { throw new Error('external network is disabled in tests'); };
}

function assertNoLeak(view, secrets) {
  const text = JSON.stringify(view);
  for (const secret of secrets) {
    assert.equal(text.includes(secret), false, 'view leaked a credential, fingerprint, device id, or QR ticket');
  }
  assert.equal(view.deviceID, undefined);
  assert.equal(view.account?.stoken, undefined);
  assert.equal(view.account?.ltoken, undefined);
  assert.equal(view.account?.cookie, undefined);
  assert.equal(view.account?.deviceFP, undefined);
  assert.equal(view.account?.deviceID, undefined);
  assert.equal(view.qr?.ticket, undefined);
}

function assertSafeTemp(dir) {
  const base = realpathSync(tmpdir());
  const info = lstatSync(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('refusing to use a non-directory temp path');
  const resolved = realpathSync(dir);
  if (resolved === base || !resolved.startsWith(`${base}${sep}`)) throw new Error('refusing a temp path outside the system temp directory');
  if (!basename(resolved).startsWith(TEMP_PREFIX)) throw new Error('refusing a temp path without the test prefix');
  return resolved;
}

function makeTempDir() {
  return assertSafeTemp(mkdtempSync(join(realpathSync(tmpdir()), TEMP_PREFIX)));
}

function removeTempDir(dir) {
  if (!dir || !existsSync(dir)) return;
  rmSync(assertSafeTemp(dir), { recursive: true, force: true });
}

function install(seed = null) {
  const calls = [];
  let fpSeq = 0;
  const transport = async (url, options, stage) => {
    const call = { url, options, stage };
    calls.push(call);
    const path = new URL(url).pathname;
    if (path.endsWith('/createQRLogin')) {
      return { retcode: 0, data: { url: 'https://example.invalid/app-login', ticket: TICKET } };
    }
    if (path.endsWith('/queryQRLoginStatus')) {
      return { retcode: 0, data: {
        status: 'Confirmed',
        user_info: { aid: AID, uid: UID_LOSES, account_id: ACCOUNT_LOSES, mid: MID, ltoken: DECOY_LTOKEN },
        tokens: [{ token: STOKEN }, { token: SECOND_TOKEN }],
      } };
    }
    if (path.endsWith('/getCookieAccountInfoBySToken')) {
      return { retcode: 0, data: { cookie_token: COOKIE_TOKEN, uid: EXCHANGE_UID } };
    }
    if (path.endsWith('/device-fp/api/getFp')) {
      fpSeq += 1;
      const body = JSON.parse(options.body);
      return { retcode: 0, data: { device_fp: `fp-${body.app_name}-${fpSeq}` } };
    }
    if (path.endsWith('/getUserGameRolesByCookie')) {
      const biz = new URL(url).searchParams.get('game_biz');
      const roles = {
        hk4e_cn: { game_uid: '1001', region: 'cn_gf01', nickname: '旅行者', level: 60, region_name: '天空岛', is_chosen: true },
        hkrpg_cn: { game_uid: '2002', region: 'prod_gf_cn', nickname: '开拓者', level: 70, region_name: '星穹列车', is_chosen: false },
        nap_cn: { game_uid: '3003', region: 'prod_gf_cn', nickname: '绳匠', level: 50, region_name: '新艾利都', is_chosen: true },
      };
      return { retcode: 0, data: { list: [roles[biz]] } };
    }
    if (path === '/game_record/app/genshin/api/dailyNote') {
      return { retcode: 0, data: { current_resin: 160, max_resin: 160, finished_task_num: 4, total_task_num: 4, current_home_coin: 2400, max_home_coin: 2400 } };
    }
    if (path === '/game_record/app/hkrpg/api/note') {
      return { retcode: 0, data: { current_stamina: 240, max_stamina: 240, current_train_score: 500, max_train_score: 500, current_reserve_stamina: 2400 } };
    }
    if (path === '/event/game_record_zzz/api/zzz/note') {
      return { retcode: 0, data: { energy: { progress: { current: 240, max: 240 } }, vitality: { current: 100, max: 100 } } };
    }
    throw new Error(`unexpected ${stage} ${url}`);
  };
  const store = new MemoryStore(seed);
  const service = new SettingsService(store, { transport });
  return { calls, store, service, transport };
}

function collectedSecrets(service, calls, extras = []) {
  const found = new Set(extras);
  const take = value => { if (typeof value === 'string' && value.length >= 8) found.add(value); };
  for (const call of calls) {
    take(call.options.headers?.['x-rpc-device_id']);
    take(call.options.headers?.Cookie);
    take(call.options.headers?.['x-rpc-device_fp']);
    if (typeof call.options.body === 'string' && call.url.includes('device-fp')) {
      const body = JSON.parse(call.options.body);
      take(body.seed_id);
      take(body.device_id);
      take(body.device_fp);
      take(body.ext_fields);
    }
    if (typeof call.options.body === 'string' && call.options.body.includes('ticket')) take(JSON.parse(call.options.body).ticket);
  }
  take(service.db.deviceID);
  for (const record of [service.db.account, service.db.pending]) {
    if (!record) continue;
    for (const key of ['stoken', 'ltoken', 'mid', 'cookie', 'deviceFP', 'deviceID', 'seedID', 'seedTime']) take(record[key]);
  }
  for (const profile of Object.values(service.db.profiles ?? {})) {
    take(profile.deviceFP);
    take(profile.seedID);
    take(profile.deviceID);
    take(profile.seedTime);
  }
  return [...found];
}

function signedQuery(call) {
  const query = call.url.includes('?') ? call.url.slice(call.url.indexOf('?') + 1) : '';
  const [time, random] = call.options.headers.DS.split(',');
  assert.equal(call.options.headers.DS, makeDS(query, '', Number(time), Number(random)));
  return query;
}

function loggedIn(stoken = STOKEN) {
  const state = initialState();
  state.deviceID = DEVICE;
  state.fpRefreshDate = 1700000000;
  state.account = {
    id: AID, stoken, ltoken: stoken, mid: MID,
    cookie: `stuid=${AID}; stoken=${stoken}; ltuid=${AID}; ltoken=${stoken}; mid=${MID}; cookie_token=${COOKIE_TOKEN}; account_id=${EXCHANGE_UID}; `,
    deviceFP: 'fp-account-secret', deviceID: DEVICE, seedID: 'seed-account-secret', seedTime: '1700000000000',
    savedAt: '2026-01-01T00:00:00.000Z',
  };
  state.roles = [{
    id: 'genshin:cn_gf01:1001', game: 'genshin', uid: '1001', server: 'cn_gf01',
    nickname: '旅行者', level: 60, regionName: '天空岛', isChosen: true,
  }];
  state.profiles = {
    'genshin:cn_gf01:1001': { deviceFP: 'fp-role-secret', deviceID: DEVICE, seedID: 'seed-role-secret', seedTime: '1700000000000' },
  };
  state.settings.selectedRoles = { genshin: 'genshin:cn_gf01:1001' };
  return state;
}

test('MemoryStore clones fixtures on load and save', () => {
  const fixture = initialState();
  fixture.deviceID = 'FIXTURE-DEVICE';
  fixture.fpRefreshDate = 1700000000;
  fixture.nested = { token: 'keep-me' };
  const store = new MemoryStore(fixture);
  fixture.deviceID = 'CHANGED-AFTER';
  fixture.nested.token = 'changed-after';
  const service = new SettingsService(store, { transport: noNetwork() });
  assert.equal(service.db.deviceID, 'FIXTURE-DEVICE');
  assert.equal(fixture.nested.token, 'changed-after');
  service.db.deviceID = 'MUTATED';
  service.save();
  assert.equal(fixture.deviceID, 'CHANGED-AFTER');
  assert.equal(store.load().deviceID, 'MUTATED');
  const loaded = store.load();
  loaded.deviceID = 'AGAIN';
  assert.equal(store.load().deviceID, 'MUTATED');
  assert.equal(store.state.nested.token, 'keep-me');
});

test('FileStore round-trips only inside a checked temporary directory', () => {
  const dir = makeTempDir();
  try {
    const file = join(dir, 'nested', 'state.json');
    const store = new FileStore(file);
    assert.equal(store.load(), null);
    const service = new SettingsService(store, { transport: noNetwork() });
    const deviceID = service.db.deviceID;
    service.db.fpRefreshDate = 1700000000;
    service.save();
    assert.equal(existsSync(`${file}.tmp`), false);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(readFileSync(file, 'utf8').endsWith('\n'), true);
    const again = new FileStore(file);
    assert.equal(again.load().deviceID, deviceID);
    assert.equal(again.load().fpRefreshDate, 1700000000);
    const loaded = again.load();
    loaded.deviceID = 'mutated-in-memory';
    assert.equal(again.load().deviceID, deviceID);
    const restored = new SettingsService(again, { transport: noNetwork() });
    assert.equal(restored.db.deviceID, deviceID);
    writeFileSync(file, '{', { mode: 0o600 });
    assert.throws(() => again.load(), SyntaxError);
  } finally {
    removeTempDir(dir);
  }
});

test('QR login persists tokens, per-role fingerprints, notes, and logout without leaking them', async () => {
  const seed = initialState();
  seed.deviceID = DEVICE;
  seed.fpRefreshDate = 1700000000;
  const { calls, store, service, transport } = install(seed);
  const created = await service.createQR();
  const qrDevice = calls[0].options.headers['x-rpc-device_id'];
  assert.match(qrDevice, /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
  assert.notEqual(qrDevice, DEVICE);
  assert.match(created.qr.svg, /<svg/);
  assert.equal(created.qr.status, 'Created');
  assertNoLeak(created, [TICKET, qrDevice, DEVICE]);
  assert.deepEqual(calls[0].options, {
    method: 'POST',
    headers: {
      'x-rpc-app_id': 'ddxf5dufpuyo', 'x-rpc-client_type': '3', 'x-rpc-device_id': qrDevice,
      'User-Agent': 'HYPContainer/1.3.3.182', 'Content-Type': 'application/json',
    },
    body: '{}',
  });

  const loggedInView = await service.poll();
  assert.equal(calls[1].options.body, JSON.stringify({ ticket: TICKET }));
  assert.equal(calls[1].options.headers['x-rpc-device_id'], qrDevice);
  assert.equal(calls[2].url, 'https://api-takumi.mihoyo.com/auth/api/getCookieAccountInfoBySToken');
  assert.equal(calls[2].options.headers.Cookie, `stuid=${AID}; stoken=${STOKEN}; mid=${MID}`);
  assert.equal(signedQuery(calls[2]), '');
  const expectedCookie = `stuid=${AID}; stoken=${STOKEN}; ltuid=${AID}; ltoken=${STOKEN}; mid=${MID}; cookie_token=${COOKIE_TOKEN}; account_id=${EXCHANGE_UID}; `;
  assert.equal(service.db.account.cookie, expectedCookie);
  assert.equal(service.db.account.ltoken, STOKEN);
  assert.equal(service.db.account.deviceID, DEVICE);
  assert.equal(service.db.pending, null);
  assert.equal(JSON.stringify(store.state).includes(TICKET), false);

  const fpBodies = calls.filter(call => call.url.endsWith('/device-fp/api/getFp')).map(call => JSON.parse(call.options.body));
  assert.deepEqual(fpBodies.map(body => body.app_name), ['hk4e_cn', 'hk4e_cn', 'hkrpg_cn', 'nap_cn']);
  for (const body of fpBodies) {
    assert.equal(body.platform, '1');
    assert.equal(body.device_id, DEVICE_MD5);
    assert.equal(JSON.parse(body.ext_fields).IDFV, DEVICE_MD5.toUpperCase());
  }
  assert.deepEqual(calls.filter(call => call.url.includes('device-fp')).map(call => call.options.headers), [
    { 'Content-Type': 'application/json' }, { 'Content-Type': 'application/json' },
    { 'Content-Type': 'application/json' }, { 'Content-Type': 'application/json' },
  ]);
  assert.deepEqual(service.db.roles, [
    { id: 'genshin:cn_gf01:1001', game: 'genshin', uid: '1001', server: 'cn_gf01', nickname: '旅行者', level: 60, regionName: '天空岛', isChosen: true },
    { id: 'hsr:prod_gf_cn:2002', game: 'hsr', uid: '2002', server: 'prod_gf_cn', nickname: '开拓者', level: 70, regionName: '星穹列车', isChosen: false },
    { id: 'zzz:prod_gf_cn:3003', game: 'zzz', uid: '3003', server: 'prod_gf_cn', nickname: '绳匠', level: 50, regionName: '新艾利都', isChosen: true },
  ]);
  assert.equal(service.db.account.deviceFP, 'fp-hk4e_cn-1');
  assert.equal(service.db.profiles['genshin:cn_gf01:1001'].deviceFP, 'fp-hk4e_cn-2');
  assert.equal(service.db.profiles['hsr:prod_gf_cn:2002'].deviceFP, 'fp-hkrpg_cn-3');
  assert.equal(service.db.profiles['zzz:prod_gf_cn:3003'].deviceFP, 'fp-nap_cn-4');
  assert.deepEqual(service.db.settings.selectedRoles, {
    genshin: 'genshin:cn_gf01:1001', hsr: 'hsr:prod_gf_cn:2002', zzz: 'zzz:prod_gf_cn:3003',
  });
  assert.deepEqual(calls.filter(call => call.url.includes('getUserGameRolesByCookie')).map(call => call.url), [
    'https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie?game_biz=hk4e_cn',
    'https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie?game_biz=hkrpg_cn',
    'https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie?game_biz=nap_cn',
  ]);
  for (const call of calls.filter(call => call.url.includes('getUserGameRolesByCookie'))) {
    assert.equal(call.options.headers.Cookie, expectedCookie);
    assert.equal(signedQuery(call), new URL(call.url).searchParams.toString());
  }
  assertNoLeak(loggedInView, collectedSecrets(service, calls, [TICKET, DECOY_LTOKEN, SECOND_TOKEN, UID_LOSES, ACCOUNT_LOSES, EXCHANGE_UID, STOKEN, COOKIE_TOKEN, MID]));
  assert.equal(Object.keys(loggedInView.account).sort().join(','), 'deviceReady,id,savedAt,tokenVersion');
  assert.equal(loggedInView.account.tokenVersion, 'v2');
  assert.equal(loggedInView.account.deviceReady, true);
  const beforeRepeat = calls.length;
  await service.poll();
  assert.equal(calls.length, beforeRepeat);

  const atRestore = calls.length;
  const restored = new SettingsService(store, { transport });
  assert.equal(calls.length, atRestore);
  assert.equal(restored.db.deviceID, DEVICE);
  assert.equal(restored.db.account.stoken, STOKEN);
  assert.deepEqual(restored.db.roles, service.db.roles);
  assert.equal(restored.db.profiles['hsr:prod_gf_cn:2002'].deviceFP, 'fp-hkrpg_cn-3');
  assert.equal(restored.view().qr, null);

  const noted = await restored.refresh('genshin');
  await restored.refresh('hsr');
  await restored.refresh('zzz');
  const noteCalls = calls.slice(atRestore);
  assert.deepEqual(noteCalls.map(call => call.url), [
    'https://api-takumi-record.mihoyo.com/game_record/app/genshin/api/dailyNote?role_id=1001&server=cn_gf01',
    'https://api-takumi-record.mihoyo.com/game_record/app/hkrpg/api/note?role_id=2002&server=prod_gf_cn',
    'https://api-takumi-record.mihoyo.com/event/game_record_zzz/api/zzz/note?role_id=3003&server=prod_gf_cn',
  ]);
  assert.deepEqual(noteCalls.map(call => call.options.headers['User-Agent']), [BBS_UA, BBS_UA, WIDGET_UA]);
  assert.deepEqual(noteCalls.map(call => call.options.headers['x-rpc-device_fp']), ['fp-hk4e_cn-2', 'fp-hkrpg_cn-3', 'fp-nap_cn-4']);
  for (const call of noteCalls) {
    assert.equal(call.options.headers['x-rpc-device_id'], DEVICE);
    assert.equal(call.options.headers.Cookie, expectedCookie);
    assert.equal(call.url.includes('widget'), false);
    signedQuery(call);
  }
  assert.deepEqual(restored.db.notes.genshin.summary, [
    { label: '原粹树脂', value: '160 / 160' },
    { label: '每日委托', value: '4 / 4' },
    { label: '洞天宝钱', value: '2400 / 2400' },
  ]);
  assert.deepEqual(restored.db.notes.hsr.summary, [
    { label: '开拓力', value: '240 / 240' },
    { label: '每日实训活跃度', value: '500 / 500' },
    { label: '后备开拓力', value: '2400' },
  ]);
  assert.deepEqual(restored.db.notes.zzz.summary, [
    { label: '电量', value: '240 / 240' },
    { label: '每日活跃度', value: '100 / 100' },
  ]);
  for (const game of ['genshin', 'hsr', 'zzz']) {
    assert.equal(restored.db.notes[game].status, 'ok');
    assert.equal(restored.db.notes[game].source, 'full');
    assert.equal(restored.db.notes[game].attempts.length, 1);
    assert.equal(JSON.stringify(restored.db.notes[game].summary).includes('已领取'), false);
  }
  assert.equal(noted.notes.genshin.summary.some(item => item.label === '委托额外奖励'), false);
  assertNoLeak(restored.view(), collectedSecrets(restored, calls, [TICKET, DECOY_LTOKEN, SECOND_TOKEN, UID_LOSES, ACCOUNT_LOSES, EXCHANGE_UID, qrDevice]));

  const cleared = restored.remove();
  assert.equal(cleared.account, null);
  assert.deepEqual(cleared.roles, []);
  assert.deepEqual(cleared.notes, {});
  assert.deepEqual(cleared.events, []);
  assert.equal(cleared.qr, null);
  assert.deepEqual(restored.db.settings.selectedRoles, {});
  assert.equal(restored.db.settings.intervalMinutes, 15);
  assert.equal(restored.db.deviceID, DEVICE);
  assert.equal(restored.db.pending, null);
  assert.deepEqual(restored.db.profiles, {});
  const reloaded = new SettingsService(store, { transport });
  assert.equal(reloaded.db.account, null);
  assert.equal(reloaded.view().account, null);
  const persisted = JSON.stringify(store.state);
  for (const secret of [STOKEN, COOKIE_TOKEN, MID, TICKET, 'fp-hk4e_cn', EXCHANGE_UID]) {
    assert.equal(persisted.includes(secret), false);
  }
});

test('a failed cookie or fingerprint keeps pending and complete resumes without another QR', async () => {
  const seed = initialState();
  seed.deviceID = DEVICE;
  seed.fpRefreshDate = 1700000000;
  let cookieFails = true;
  let fpFails = true;
  const calls = [];
  const transport = async (url, options, stage) => {
    calls.push({ url, options, stage });
    if (url.endsWith('/createQRLogin')) return { retcode: 0, data: { url: 'https://example.invalid/qr', ticket: TICKET } };
    if (url.endsWith('/queryQRLoginStatus')) {
      return { retcode: 0, data: { status: 'Confirmed', user_info: { aid: 'aid-1', mid: MID }, tokens: [{ token: STOKEN }] } };
    }
    if (url.includes('/getCookieAccountInfoBySToken')) {
      if (cookieFails) return { retcode: 401, message: 'cookie step failed' };
      return { retcode: 0, data: { cookie_token: COOKIE_TOKEN, uid: EXCHANGE_UID } };
    }
    if (url.includes('/device-fp/api/getFp')) {
      const body = JSON.parse(options.body);
      assert.equal(body.device_id, DEVICE_MD5);
      assert.equal(body.platform, '1');
      assert.equal(body.app_name, 'hk4e_cn');
      if (fpFails) return { retcode: 0, data: { msg: 'fp step failed' } };
      return { retcode: 0, data: { device_fp: 'fp-account-secret' } };
    }
    if (url.includes('/getUserGameRolesByCookie')) return { retcode: 0, data: { list: [] } };
    throw new Error(`unexpected ${stage} ${url}`);
  };
  const store = new MemoryStore(seed);
  const service = new SettingsService(store, { transport });
  await service.createQR();
  await assert.rejects(service.poll(), { stage: 'auth.cookieToken', code: 401 });
  assert.equal(service.db.account, null);
  assert.deepEqual(service.db.pending, { id: 'aid-1', stoken: STOKEN, ltoken: STOKEN, mid: MID });
  assert.equal(store.load().pending.cookie, undefined);
  assertNoLeak(service.view(), [TICKET, STOKEN, MID, DEVICE]);

  cookieFails = false;
  const resumed = new SettingsService(store, { transport });
  assert.deepEqual(resumed.view().qr, {
    status: 'error', svg: '',
    error: { stage: 'auth.complete', code: 'PENDING', message: '扫码已确认；点击继续认证完成 Token 和设备指纹步骤。' },
  });
  const mark = calls.length;
  await assert.rejects(resumed.complete(), { stage: 'auth.fingerprint', code: 'NO_FP' });
  const resumedCalls = calls.slice(mark);
  assert.deepEqual(resumedCalls.map(call => new URL(call.url).pathname), [
    '/auth/api/getCookieAccountInfoBySToken', '/device-fp/api/getFp',
  ]);
  assert.equal(resumedCalls[0].options.headers.Cookie, `stuid=aid-1; stoken=${STOKEN}; mid=${MID}`);
  assert.equal(resumed.db.account, null);
  assert.equal(resumed.db.pending.deviceFP, undefined);
  assert.equal(resumed.db.pending.cookie, `stuid=aid-1; stoken=${STOKEN}; ltuid=aid-1; ltoken=${STOKEN}; mid=${MID}; cookie_token=${COOKIE_TOKEN}; account_id=${EXCHANGE_UID}; `);
  assert.equal(store.load().account, null);
  assertNoLeak(resumed.view(), [TICKET, STOKEN, MID, COOKIE_TOKEN, EXCHANGE_UID, DEVICE, 'fp-account-secret']);

  fpFails = false;
  const finished = new SettingsService(store, { transport });
  const resumeAt = calls.length;
  const view = await finished.complete();
  const finalCalls = calls.slice(resumeAt).map(call => call.url);
  assert.equal(finalCalls.some(url => url.includes('QR') || url.includes('getCookieAccountInfoBySToken')), false);
  assert.equal(finalCalls.filter(url => url.includes('/device-fp/')).length, 1);
  assert.equal(finished.db.pending, null);
  assert.equal(view.account.id, 'aid-1');
  assert.equal(view.account.deviceReady, true);
  assert.equal(view.qr, null);
  assertNoLeak(view, [TICKET, STOKEN, MID, COOKIE_TOKEN, EXCHANGE_UID, DEVICE, 'fp-account-secret']);
});

test('unknown roles are rejected and a single game failure is not an empty success', async () => {
  const state = loggedIn();
  state.roles.push({
    id: 'genshin:cn_gf01:2', game: 'genshin', uid: '2', server: 'cn_gf01',
    nickname: 'B', level: 1, regionName: '天空岛', isChosen: false,
  });
  state.notes.genshin = { status: 'ok', summary: [{ label: '原粹树脂', value: '1 / 160' }] };
  const service = new SettingsService(new MemoryStore(state), { transport: noNetwork() });
  assert.throws(() => service.settings({ selectedRoles: { genshin: 'genshin:cn_gf01:nope' } }), { code: 'INVALID_ROLE' });
  assert.throws(() => service.settings({ selectedRoles: { hsr: 'genshin:cn_gf01:1001' } }), { code: 'INVALID_ROLE' });
  assert.throws(() => service.settings({ selectedRoles: { notAGame: 'x' } }), { code: 'INVALID_ROLE' });
  assert.throws(() => service.settings({ selectedRoles: { genshin: 'genshin:cn_gf01:2', zzz: 'missing' } }), { code: 'INVALID_ROLE' });
  assert.equal(service.db.settings.selectedRoles.genshin, 'genshin:cn_gf01:1001');
  assert.equal(service.db.notes.genshin.summary[0].value, '1 / 160');
  await assert.rejects(service.refresh('zzz'), { code: 'ROLE_REQUIRED', stage: 'note.zzz' });
  await assert.rejects(service.refresh('not-a-game'), { code: 'INVALID_GAME' });
  service.db.settings.selectedRoles.genshin = 'missing-role';
  await assert.rejects(service.refresh('genshin'), { code: 'ROLE_REQUIRED' });

  const calls = [];
  const transport = async (url, options) => {
    calls.push(url + (options.body ?? ''));
    if (url.includes('/device-fp/')) {
      const body = JSON.parse(options.body);
      return { retcode: 0, data: { device_fp: `fp-${body.app_name}` } };
    }
    const biz = new URL(url).searchParams.get('game_biz');
    if (biz === 'hkrpg_cn') return { retcode: 500, message: 'hsr down' };
    const role = biz === 'hk4e_cn'
      ? { game_uid: '1001', region: 'cn_gf01', nickname: '旅行者', level: 60, region_name: '天空岛', is_chosen: true }
      : { game_uid: '3003', region: 'prod_gf_cn', nickname: '绳匠', level: 50, region_name: '新艾利都', is_chosen: true };
    return { retcode: 0, data: { list: [role] } };
  };
  const isolated = initialState();
  isolated.deviceID = DEVICE;
  isolated.fpRefreshDate = 1700000000;
  isolated.account = state.account;
  const lookup = new SettingsService(new MemoryStore(isolated), { transport });
  const view = await lookup.loadRoles();
  assert.deepEqual(view.roles.map(role => role.game), ['genshin', 'zzz']);
  assert.equal(view.roleErrors.hsr.code, 500);
  assert.equal(view.roleErrors.hsr.message, 'hsr down');
  assert.equal(view.roles.some(role => role.uid === ''), false);
  assert.equal(lookup.db.profiles['genshin:cn_gf01:1001'].deviceFP, 'fp-hk4e_cn');
  assert.equal(lookup.db.profiles['zzz:prod_gf_cn:3003'].deviceFP, 'fp-nap_cn');
  assert.equal(lookup.db.profiles['hsr:prod_gf_cn:2002'], undefined);
  assert.equal(calls.filter(item => item.includes('hkrpg_cn') && item.includes('device-fp')).length, 0);
  assertNoLeak(view, [STOKEN, COOKIE_TOKEN, MID, DEVICE, 'fp-hk4e_cn', 'fp-nap_cn']);
});

test('note fallback stays on the widget path for v2 and reports every attempt', async () => {
  const secrets = [STOKEN, COOKIE_TOKEN, MID, DEVICE, 'fp-account-secret', 'fp-role-secret', EXCHANGE_UID];
  const script = (fullCode, widgetCode) => {
    const calls = [];
    const transport = async (url, options, stage) => {
      calls.push({ url, options, stage });
      if (url.includes('/api/dailyNote')) {
        return fullCode === 0
          ? { retcode: 0, data: { current_resin: 20, max_resin: 160, finished_task_num: 4, total_task_num: 4 } }
          : { retcode: fullCode, message: 'full failed' };
      }
      if (url.endsWith('/aapi/widget/v2')) {
        return widgetCode === 0
          ? { retcode: 0, data: { current_resin: 20, max_resin: 160, finished_task_num: 4, total_task_num: 4 } }
          : { retcode: widgetCode, message: 'widget failed' };
      }
      throw new Error(`unexpected ${stage} ${url}`);
    };
    return { calls, transport };
  };

  const full = script(0, 0);
  const fullService = new SettingsService(new MemoryStore(loggedIn()), { transport: full.transport });
  const fullView = await fullService.refresh('genshin');
  assert.equal(full.calls.length, 1);
  assert.equal(full.calls[0].url.includes('widget'), false);
  assert.equal(full.calls[0].options.headers['x-rpc-device_fp'], 'fp-role-secret');
  assert.equal(full.calls[0].options.headers['User-Agent'], BBS_UA);
  assert.equal(fullView.notes.genshin.source, 'full');
  assert.equal(fullView.notes.genshin.summary.some(item => item.value === '已领取'), false);
  assertNoLeak(fullView, secrets);

  const widget = script(101, 0);
  const widgetService = new SettingsService(new MemoryStore(loggedIn()), { transport: widget.transport });
  const widgetView = await widgetService.refresh('genshin');
  assert.deepEqual(widget.calls.map(call => new URL(call.url).pathname), [
    '/game_record/app/genshin/api/dailyNote', '/game_record/app/genshin/aapi/widget/v2',
  ]);
  assert.equal(widget.calls[1].url.includes('?'), false);
  assert.equal(widget.calls[1].options.headers['User-Agent'], BBS_UA);
  assert.equal(signedQuery(widget.calls[1]), '');
  assert.equal(widgetView.notes.genshin.status, 'ok');
  assert.equal(widgetView.notes.genshin.source, 'widget');
  assert.deepEqual(widgetView.notes.genshin.attempts, [
    { source: 'full', stage: 'note.genshin.full', code: 101, message: 'full failed' },
    { source: 'widget', code: 0, message: '完成' },
  ]);
  assert.equal(widgetView.notes.genshin.summary.some(item => item.value === '已领取'), false);
  assertNoLeak(widgetView, secrets);

  const both = script(101, 103);
  const bothService = new SettingsService(new MemoryStore(loggedIn()), { transport: both.transport });
  const bothView = await bothService.refresh('genshin');
  assert.equal(both.calls.length, 2);
  assert.equal(bothView.notes.genshin.status, 'error');
  assert.deepEqual(bothView.notes.genshin.summary, []);
  assert.deepEqual(bothView.notes.genshin.error, { stage: 'note.genshin.widget', code: 103, message: 'widget failed' });
  assert.deepEqual(bothView.notes.genshin.attempts, [
    { source: 'full', stage: 'note.genshin.full', code: 101, message: 'full failed' },
    { source: 'widget', stage: 'note.genshin.widget', code: 103, message: 'widget failed' },
  ]);
  assertNoLeak(bothView, secrets);

  const legacyToken = 'legacy-stoken-secret';
  const legacy = script(101, 0);
  const legacyService = new SettingsService(new MemoryStore(loggedIn(legacyToken)), { transport: legacy.transport });
  assert.equal(legacyService.db.account.cookie.includes('stoken=v2_'), false);
  const legacyView = await legacyService.refresh('genshin');
  assert.equal(legacy.calls.length, 1);
  assert.equal(legacy.calls[0].url.includes('widget'), false);
  assert.equal(legacyView.notes.genshin.status, 'error');
  assert.deepEqual(legacyView.notes.genshin.summary, []);
  assert.deepEqual(legacyView.notes.genshin.error, {
    stage: 'note.genshin', code: 'STOKEN_V2_REQUIRED',
    message: '拿铁原逻辑：完整便笺失败且缺少 SToken v2。',
  });
  assert.deepEqual(legacyView.notes.genshin.attempts, [
    { source: 'full', stage: 'note.genshin.full', code: 101, message: 'full failed' },
  ]);
  assertNoLeak(legacyView, [legacyToken, COOKIE_TOKEN, MID, DEVICE, 'fp-account-secret', 'fp-role-secret', EXCHANGE_UID]);
});

test('poll maps QR status without exchanging tokens, and complete requires a login', async () => {
  let status = 'Init';
  const calls = [];
  const transport = async (url, options, stage) => {
    calls.push(url);
    if (url.endsWith('/createQRLogin')) return { retcode: 0, data: { url: 'https://example.invalid/qr', ticket: TICKET } };
    if (url.endsWith('/queryQRLoginStatus')) return { retcode: 0, data: { status } };
    throw new Error(`unexpected ${stage} ${url}`);
  };
  const service = new SettingsService(new MemoryStore(), { transport });
  await assert.rejects(service.poll(), { code: 'NO_QR', stage: 'qr.query' });
  await assert.rejects(service.complete(), { code: 'LOGIN_REQUIRED' });
  await service.createQR();
  assert.equal((await service.poll()).qr.status, 'Created');
  status = 'Scanned';
  service.lastPoll = 0;
  const scanned = await service.poll();
  assert.equal(scanned.qr.status, 'Scanned');
  assert.equal(service.db.pending, null);
  assertNoLeak(scanned, [TICKET]);
  status = 'Expired';
  service.lastPoll = 0;
  await assert.rejects(service.poll(), { code: 'UNKNOWN_STATUS', stage: 'qr.query' });
  assert.equal(service.view().qr.status, 'error');
  assert.equal(service.view().qr.error.code, 'UNKNOWN_STATUS');
  assert.equal(service.db.pending, null);
  assertNoLeak(service.view(), [TICKET]);
  assert.equal(calls.some(url => url.includes('getCookie') || url.includes('device-fp') || url.includes('widget')), false);
});
