// SPDX-License-Identifier: AGPL-3.0-or-later
// This file is part of rear-card-hoyolab and is licensed under AGPL-3.0-or-later.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_BASE, GAMES, QR_BASE, RECORD_BASE, WIDGET_UA,
  HoyoClient, defaultHeaders, fpExtFields, makeDS, makeFPBody, md5,
  parseConfirmation, qrHeaders, completeCookie, stokenCookie, summarize,
} from '../lib/hoyo.mjs';
import { initialState } from '../lib/store.mjs';

globalThis.fetch = async () => {
  throw new Error('external network is disabled in tests');
};

const BBS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) miHoYoBBS/2.40.1';
const DEVICE = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const QUERY = 'role_id=1001&server=cn_gf01';
const SALT_TIME = 1710000000;
const SALT_RANDOM = 123456;

// Preimage locked by the fixed vector below:
// md5("salt=xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs&t=1710000000&r=123456&b=&q=role_id=1001&server=cn_gf01")
const DS_QUERY = '1710000000,123456,ab25d85844ead39b40b03be1c6691416';
const DS_EMPTY = '1710000000,123456,23d159b345ec9278db4df4c194289d6c';
const DS_SWAPPED = '1710000000,123456,bb70e3e30e5201bb5de5cc3238d80093';
const DS_BODY = '1710000000,123456,01059efa91365083e3e2bce479dc64fa';
const DS_BIZ = '1700000000,100000,d8dad757852a0280fb0738112d77380b';
const DEVICE_MD5 = 'c2610e51de2e0fa5c7f50c3e6a5d4386';

const NOTE_SPECS = [
  {
    game: 'genshin',
    fullPath: '/game_record/app/genshin/api/dailyNote',
    widgetPath: '/game_record/app/genshin/aapi/widget/v2',
    fullUA: BBS_UA,
    widgetUA: BBS_UA,
  },
  {
    game: 'hsr',
    fullPath: '/game_record/app/hkrpg/api/note',
    widgetPath: '/game_record/app/hkrpg/aapi/widget',
    fullUA: BBS_UA,
    widgetUA: WIDGET_UA,
  },
  {
    game: 'zzz',
    fullPath: '/event/game_record_zzz/api/zzz/note',
    widgetPath: '/event/game_record_zzz/api/zzz/widget',
    fullUA: WIDGET_UA,
    widgetUA: WIDGET_UA,
  },
];

function expectedExt(deviceID) {
  const idfv = String(deviceID).toUpperCase();
  return `{"ramCapacity":"3746","hasVpn":"0","proxyStatus":"0","screenBrightness":"0.550","packageName":"com.miHoYo.mhybbs","romRemain":"100513","deviceName":"iPhone","isJailBreak":"0","magnetometer":"-160.495300x-206.488358x58.534348","buildTime":"1706406805675","ramRemain":"97","accelerometer":"-0.419876x-0.748367x-0.508057","cpuCores":"6","cpuType":"CPU_TYPE_ARM64","packageVersion":"2.20.1","gyroscope":"0.133974x-0.051780x-0.062961","batteryStatus":"45","appUpdateTimeDiff":"1707130080397","appMemory":"57","screenSize":"414\u00d7896","vendor":"--","model":"iPhone12,5","IDFV":"${idfv}","romCapacity":"488153","isPushEnabled":"1","appInstallTimeDiff":"1696756955347","osVersion":"17.2.1","chargeStatus":"1","isSimInserted":"1","networkType":"WIFI"}`;
}

function clientWith(handler) {
  const calls = [];
  const transport = async (url, options, stage) => {
    const call = { url, options, stage };
    calls.push(call);
    return handler(call, calls);
  };
  return { calls, client: new HoyoClient({ transport, deviceID: 'client-device' }) };
}

function account(v2 = true) {
  const stoken = v2 ? 'v2_token' : 'legacy_token';
  return {
    id: '9',
    stoken,
    ltoken: stoken,
    mid: 'm',
    cookie: `stuid=9; stoken=${stoken}; ltuid=9; ltoken=${stoken}; mid=m; cookie_token=ct; account_id=9; `,
    deviceFP: 'fp-1',
    deviceID: 'account-device',
  };
}

function assertSigned(call, { cookie, query, ua, deviceFP = 'fp-1', deviceID = 'account-device', expectDeviceFP = true }) {
  assert.equal(call.options.method, 'GET');
  assert.equal(call.options.body, undefined);
  const headers = call.options.headers;
  assert.equal(headers['User-Agent'], ua);
  assert.equal(headers['x-rpc-device_fp'], expectDeviceFP ? deviceFP : undefined);
  assert.equal(headers['x-rpc-device_id'], deviceID);
  assert.equal(headers.Cookie, cookie);
  assert.equal(headers['x-rpc-client_type'], '5');
  assert.equal(headers['x-rpc-app_version'], '2.40.1');
  assert.equal(headers['x-rpc-page'], '3.1.3_#/rpg');
  assert.equal(headers.Referer, 'https://webstatic.mihoyo.com');
  assert.equal(headers.Origin, 'https://webstatic.mihoyo.com');
  assert.equal(headers['X-Requested-With'], 'com.mihoyo.hyperion');
  assert.equal(headers.Accept, 'application/json, text/plain, */*');
  assert.equal(headers['Accept-Language'], 'zh-CN,zh-Hans;q=0.9');
  const [time, random, hash] = headers.DS.split(',');
  assert.equal(hash.length, 32);
  assert.ok(Number(random) >= 100000 && Number(random) < 200000);
  assert.equal(headers.DS, makeDS(query, '', Number(time), Number(random)));
  assert.notEqual(headers.DS, makeDS(query, '{}', Number(time), Number(random)));
  if (query.includes('&')) {
    const swapped = query.split('&').reverse().join('&');
    assert.notEqual(headers.DS, makeDS(swapped, '', Number(time), Number(random)));
  }
}

test('DS hashes the fixed salt, time, random, body, and query order', () => {
  assert.equal(makeDS(QUERY, '', SALT_TIME, SALT_RANDOM), DS_QUERY);
  assert.equal(makeDS('', '', SALT_TIME, SALT_RANDOM), DS_EMPTY);
  assert.equal(makeDS('server=cn_gf01&role_id=1001', '', SALT_TIME, SALT_RANDOM), DS_SWAPPED);
  assert.equal(makeDS(QUERY, '{}', SALT_TIME, SALT_RANDOM), DS_BODY);
  assert.equal(makeDS('game_biz=hk4e_cn', '', 1700000000, 100000), DS_BIZ);
  assert.notEqual(DS_QUERY, DS_SWAPPED);
  assert.notEqual(DS_QUERY, DS_BODY);
  const [time, random] = makeDS('a=1').split(',');
  assert.ok(Number(random) >= 100000 && Number(random) < 200000);
  assert.ok(Math.abs(Number(time) - Math.floor(Date.now() / 1000)) <= 2);
});

test('default and QR headers use the CN app client values', () => {
  assert.equal(QR_BASE, 'https://passport-api.mihoyo.com/account/ma-cn-passport/app/');
  assert.equal(ACCOUNT_BASE, 'https://api-takumi.mihoyo.com');
  assert.equal(RECORD_BASE, 'https://api-takumi-record.mihoyo.com');
  assert.equal(WIDGET_UA, 'WidgetExtension/434 CFNetwork/1492.0.1 Darwin/23.3.0');
  assert.deepEqual(GAMES, {
    genshin: { biz: 'hk4e_cn', full: '/game_record/app/genshin/api/dailyNote', widget: '/game_record/app/genshin/aapi/widget/v2' },
    hsr: { biz: 'hkrpg_cn', full: '/game_record/app/hkrpg/api/note', widget: '/game_record/app/hkrpg/aapi/widget' },
    zzz: { biz: 'nap_cn', full: '/event/game_record_zzz/api/zzz/note', widget: '/event/game_record_zzz/api/zzz/widget' },
  });
  assert.deepEqual(qrHeaders('DEV-QR'), {
    'x-rpc-app_id': 'ddxf5dufpuyo',
    'x-rpc-client_type': '3',
    'x-rpc-device_id': 'DEV-QR',
    'User-Agent': 'HYPContainer/1.3.3.182',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(defaultHeaders('DEV-1'), {
    'User-Agent': BBS_UA,
    Referer: 'https://webstatic.mihoyo.com',
    Origin: 'https://webstatic.mihoyo.com',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
    Accept: 'application/json, text/plain, */*',
    Connection: 'keep-alive',
    'X-Requested-With': 'com.mihoyo.hyperion',
    'x-rpc-app_version': '2.40.1',
    'x-rpc-client_type': '5',
    'x-rpc-page': '3.1.3_#/rpg',
    'x-rpc-device_id': 'DEV-1',
    'x-rpc-language': 'zh-cn',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Site': 'same-site',
    'Sec-Fetch-Mode': 'cors',
  });
});

test('QR create sends an empty JSON body and query sends the ticket', async () => {
  const { calls, client } = clientWith(() => ({ retcode: 0, data: { url: 'https://example.invalid/qr', ticket: 'ticket-1' } }));
  await client.createQR('QR-DEVICE');
  await client.queryQR('QR-DEVICE', 'ticket-1');
  assert.deepEqual(calls[0], {
    url: 'https://passport-api.mihoyo.com/account/ma-cn-passport/app/createQRLogin',
    stage: 'qr.create',
    options: { method: 'POST', headers: qrHeaders('QR-DEVICE'), body: '{}' },
  });
  assert.deepEqual(calls[1], {
    url: 'https://passport-api.mihoyo.com/account/ma-cn-passport/app/queryQRLoginStatus',
    stage: 'qr.query',
    options: { method: 'POST', headers: qrHeaders('QR-DEVICE'), body: '{"ticket":"ticket-1"}' },
  });
  assert.equal(calls[0].options.headers.DS, undefined);
  assert.equal(calls[1].options.headers.Cookie, undefined);
});

test('confirmed QR keeps the first token, aid precedence, mid, and ltoken equal to stoken', () => {
  assert.deepEqual(parseConfirmation({
    status: 'Confirmed',
    user_info: { aid: 'A', uid: 'U', account_id: 'C', mid: 'M', ltoken: 'decoy-ltoken' },
    tokens: [{ token: 'v2_first' }, { token: 'second-token' }],
  }), { id: 'A', stoken: 'v2_first', ltoken: 'v2_first', mid: 'M' });
  assert.deepEqual(parseConfirmation({
    status: 'Confirmed',
    user_info: { uid: 'U', account_id: 'C', mid: 'M' },
    tokens: [{ token: 'v2_uid' }],
  }), { id: 'U', stoken: 'v2_uid', ltoken: 'v2_uid', mid: 'M' });
  assert.deepEqual(parseConfirmation({
    status: 'Confirmed',
    user_info: { aid: null, uid: 'U', account_id: 'C' },
    tokens: [{ token: 'from-uid' }],
  }), { id: 'U', stoken: 'from-uid', ltoken: 'from-uid', mid: '' });
  assert.deepEqual(parseConfirmation({
    status: 'Confirmed',
    user_info: { account_id: 'C' },
    tokens: [{ token: 'only' }],
  }), { id: 'C', stoken: 'only', ltoken: 'only', mid: '' });
  assert.deepEqual(parseConfirmation({
    status: 'Confirmed', user_info: { aid: 'A' },
  }), { id: 'A', stoken: '', ltoken: '', mid: '' });
  for (const status of ['Init', 'Created', 'Scanned', 'Expired', '', undefined]) {
    assert.equal(parseConfirmation({ status, user_info: { aid: 'A' }, tokens: [{ token: 'x' }] }), null);
  }
  assert.equal(stokenCookie({ id: 'A', stoken: 'v2_s', mid: 'M' }), 'stuid=A; stoken=v2_s; mid=M');
  assert.equal(
    completeCookie({ id: 'A', stoken: 'v2_s', ltoken: 'v2_s', mid: 'M' }, { cookie_token: 'ct', uid: 'U' }),
    'stuid=A; stoken=v2_s; ltuid=A; ltoken=v2_s; mid=M; cookie_token=ct; account_id=U; ',
  );
});

test('cookie exchange uses the old SToken endpoint and the stoken cookie', async () => {
  const confirmed = { id: 'A', stoken: 'v2_s', ltoken: 'v2_s', mid: 'M' };
  const { calls, client } = clientWith(() => ({ retcode: 0, data: { cookie_token: 'ct', uid: 'U' } }));
  const data = await client.cookieToken(confirmed);
  assert.deepEqual(data, { cookie_token: 'ct', uid: 'U' });
  assert.equal(calls[0].stage, 'auth.cookieToken');
  assert.equal(calls[0].url, 'https://api-takumi.mihoyo.com/auth/api/getCookieAccountInfoBySToken');
  assert.equal(calls[0].url.includes('?'), false);
  assert.equal(calls[0].options.headers.Cookie, 'stuid=A; stoken=v2_s; mid=M');
  assertSigned(calls[0], {
    cookie: 'stuid=A; stoken=v2_s; mid=M', query: '', ua: BBS_UA, deviceID: 'client-device', expectDeviceFP: false,
  });
  assert.equal(calls.length, 1);
});

test('fingerprint sends the upstream ext_fields, platform 1, and md5(device + refresh date)', () => {
  assert.equal(fpExtFields('abc-DEF'), expectedExt('abc-DEF'));
  assert.equal(JSON.parse(expectedExt(DEVICE)).screenSize, '414\u00d7896');
  assert.equal(md5(`${DEVICE}1700000000.0`), DEVICE_MD5);
  assert.equal(md5(`${DEVICE}1700000000.5`), 'afbcbd756cc40dcea5edb04a515fc421');

  const body = makeFPBody(DEVICE, 1700000000, 1710000000123, 'genshin');
  assert.equal(body.device_id, DEVICE_MD5);
  assert.equal(body.platform, '1');
  assert.equal(body.app_name, 'hk4e_cn');
  assert.equal(body.seed_time, '1710000000000');
  assert.match(body.seed_id, /^[0-9a-f]{16}$/);
  assert.match(body.device_fp, /^[0-9a-f]{13}$/);
  assert.equal(typeof body.ext_fields, 'string');
  assert.equal(body.ext_fields, expectedExt(DEVICE_MD5));
  assert.equal(JSON.parse(body.ext_fields).IDFV, DEVICE_MD5.toUpperCase());
  assert.equal(JSON.parse(body.ext_fields).packageName, 'com.miHoYo.mhybbs');
  assert.equal(makeFPBody(DEVICE, 1700000000.5, 1710000000123).device_id, 'afbcbd756cc40dcea5edb04a515fc421');
  assert.equal(makeFPBody(DEVICE, 1700000000, 1710000000123, 'hsr').app_name, 'hkrpg_cn');
  assert.equal(makeFPBody(DEVICE, 1700000000, 1710000000123, 'zzz').app_name, 'nap_cn');

  const state = initialState();
  assert.equal(state.version, 1);
  assert.equal(state.account, null);
  assert.match(state.deviceID, /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
  assert.equal(Number.isFinite(state.fpRefreshDate), true);
  const swift = Number.isInteger(state.fpRefreshDate) ? `${state.fpRefreshDate}.0` : String(state.fpRefreshDate);
  const initial = makeFPBody(state.deviceID, state.fpRefreshDate, 1710000000123);
  assert.equal(initial.device_id, md5(state.deviceID + swift));
  assert.equal(initial.platform, '1');
  assert.equal(initial.app_name, 'hk4e_cn');
  assert.equal(initial.ext_fields, expectedExt(initial.device_id));
});

test('fingerprint posts that body and keeps the server device_fp', async () => {
  const { calls, client } = clientWith(call => {
    const sent = JSON.parse(call.options.body);
    assert.equal(sent.platform, '1');
    assert.equal(sent.app_name, 'hkrpg_cn');
    assert.equal(sent.device_id, DEVICE_MD5);
    assert.equal(sent.ext_fields, expectedExt(DEVICE_MD5));
    return { retcode: 0, data: { device_fp: 'server-fp-value' } };
  });
  const before = Math.floor(Date.now() / 1000);
  const result = await client.fingerprint(DEVICE, 1700000000, 'hsr');
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, 'https://public-data-api.mihoyo.com/device-fp/api/getFp');
  assert.equal(calls[0].stage, 'auth.fingerprint');
  assert.deepEqual(calls[0].options.headers, { 'Content-Type': 'application/json' });
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(result.deviceFP, 'server-fp-value');
  assert.equal(result.seedID, sent.seed_id);
  assert.equal(result.seedTime, sent.seed_time);
  assert.ok(Math.abs(Number(sent.seed_time) - before * 1000) <= 1000);
  const missing = clientWith(() => ({ retcode: 0, data: { msg: 'fp missing' } }));
  await assert.rejects(missing.client.fingerprint(DEVICE, 1700000000, 'zzz'), {
    stage: 'auth.fingerprint', code: 'NO_FP', message: 'fp missing',
  });
  assert.equal(JSON.parse(missing.calls[0].options.body).app_name, 'nap_cn');
});

test('role lookup uses each CN game_biz in that query order', async () => {
  const { calls, client } = clientWith(() => ({ retcode: 0, data: { list: [{
    game_uid: '1001', region: 'cn_gf01', nickname: '\u65c5\u884c\u8005', level: 60, region_name: '\u5929\u7a7a\u5c9b', is_chosen: true,
  }] } }));
  assert.deepEqual(await client.roles('genshin', 'cookie=1'), [{
    id: 'genshin:cn_gf01:1001', game: 'genshin', uid: '1001', server: 'cn_gf01',
    nickname: '\u65c5\u884c\u8005', level: 60, regionName: '\u5929\u7a7a\u5c9b', isChosen: true,
  }]);
  const empty = clientWith(() => ({ retcode: 0, data: { list: [] } }));
  await empty.client.roles('hsr', 'cookie=hsr');
  await empty.client.roles('zzz', 'cookie=zzz');
  assert.deepEqual(calls.concat(empty.calls).map(call => call.url), [
    'https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie?game_biz=hk4e_cn',
    'https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie?game_biz=hkrpg_cn',
    'https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie?game_biz=nap_cn',
  ]);
  assert.equal(calls[0].options.headers.Cookie, 'cookie=1');
  assertSigned(calls[0], { cookie: 'cookie=1', query: 'game_biz=hk4e_cn', ua: BBS_UA, deviceID: 'client-device', expectDeviceFP: false });
  const invalid = clientWith(() => ({ retcode: 0, data: { list: null } }));
  await assert.rejects(invalid.client.roles('genshin', 'cookie=1'), { stage: 'roles.genshin', code: 'INVALID_ROLES' });
});

test('full note success does not call widget; v2 failure does; both errors stay visible; non-v2 does not fall back', async () => {
  const role = { uid: '1001', server: 'cn_gf01' };
  for (const spec of NOTE_SPECS) {
    const fullURL = `${RECORD_BASE}${spec.fullPath}?${QUERY}`;
    const widgetURL = `${RECORD_BASE}${spec.widgetPath}`;
    const v2 = account(true);
    const success = clientWith(call => {
      assert.equal(call.url, fullURL);
      return { retcode: 0, data: { current_resin: 1, max_resin: 160 } };
    });
    const done = await success.client.note(spec.game, role, v2);
    assert.equal(done.source, 'full');
    assert.equal(success.calls.length, 1);
    assert.deepEqual(done.attempts, [{ source: 'full', code: 0, message: '\u5b8c\u6210' }]);
    assertSigned(success.calls[0], { cookie: v2.cookie, query: QUERY, ua: spec.fullUA });
    assert.equal(success.calls[0].stage, `note.${spec.game}.full`);

    const fallback = clientWith(call => {
      if (call.url === fullURL) return { retcode: 101, message: 'full failed' };
      assert.equal(call.url, widgetURL);
      assert.equal(call.url.includes('?'), false);
      return { retcode: 0, data: { from: 'widget' } };
    });
    const widget = await fallback.client.note(spec.game, role, v2);
    assert.equal(widget.source, 'widget');
    assert.equal(widget.data.from, 'widget');
    assert.deepEqual(fallback.calls.map(call => call.url), [fullURL, widgetURL]);
    assert.deepEqual(widget.attempts, [
      { source: 'full', stage: `note.${spec.game}.full`, code: 101, message: 'full failed' },
      { source: 'widget', code: 0, message: '\u5b8c\u6210' },
    ]);
    assertSigned(fallback.calls[1], { cookie: v2.cookie, query: '', ua: spec.widgetUA });
    assert.equal(fallback.calls[1].stage, `note.${spec.game}.widget`);

    const both = clientWith(call => {
      if (call.url === fullURL) return { retcode: 101, message: 'full failed' };
      assert.equal(call.url, widgetURL);
      return { retcode: 103, message: 'widget failed' };
    });
    await assert.rejects(both.client.note(spec.game, role, v2), error => {
      assert.equal(error.stage, `note.${spec.game}.widget`);
      assert.equal(error.code, 103);
      assert.equal(error.message, 'widget failed');
      assert.deepEqual(error.attempts, [
        { source: 'full', stage: `note.${spec.game}.full`, code: 101, message: 'full failed' },
        { source: 'widget', stage: `note.${spec.game}.widget`, code: 103, message: 'widget failed' },
      ]);
      return true;
    });
    assert.deepEqual(both.calls.map(call => call.url), [fullURL, widgetURL]);

    const legacy = account(false);
    assert.equal(legacy.cookie.includes('stoken=v2_'), false);
    const blocked = clientWith(call => {
      assert.equal(call.url, fullURL);
      return { retcode: 101, message: 'full failed' };
    });
    await assert.rejects(blocked.client.note(spec.game, role, legacy), error => {
      assert.equal(error.code, 'STOKEN_V2_REQUIRED');
      assert.equal(error.stage, `note.${spec.game}`);
      assert.equal(error.message, '\u62ff\u94c1\u539f\u903b\u8f91\uff1a\u5b8c\u6574\u4fbf\u7b3a\u5931\u8d25\u4e14\u7f3a\u5c11 SToken v2\u3002');
      assert.deepEqual(error.attempts, [
        { source: 'full', stage: `note.${spec.game}.full`, code: 101, message: 'full failed' },
      ]);
      return true;
    });
    assert.deepEqual(blocked.calls.map(call => call.url), [fullURL]);
  }
});

test('progress fields are shown without inferring that rewards were claimed', () => {
  const maxed = summarize('genshin', {
    current_resin: 0, max_resin: 160,
    finished_task_num: 4, total_task_num: 4,
    current_home_coin: 2400, max_home_coin: 2400,
    is_extra_task_reward_received: 1,
  });
  assert.deepEqual(maxed, [
    { label: '\u539f\u7cb9\u6811\u8102', value: '0 / 160' },
    { label: '\u6bcf\u65e5\u59d4\u6258', value: '4 / 4' },
    { label: '\u6d1e\u5929\u5b9d\u94b1', value: '2400 / 2400' },
  ]);
  assert.equal(maxed.some(item => item.value === '\u5df2\u9886\u53d6' || item.value === '\u672a\u9886\u53d6'), false);
  assert.deepEqual(summarize('genshin', { is_extra_task_reward_received: false }).find(item => item.label === '\u59d4\u6258\u989d\u5916\u5956\u52b1'), {
    label: '\u59d4\u6258\u989d\u5916\u5956\u52b1', value: '\u672a\u9886\u53d6',
  });
  assert.equal(summarize('genshin', { is_extra_task_reward_received: true }).find(item => item.label === '\u59d4\u6258\u989d\u5916\u5956\u52b1').value, '\u5df2\u9886\u53d6');

  const hsr = summarize('hsr', {
    current_stamina: 240, max_stamina: 240,
    current_train_score: 500, max_train_score: 500,
    current_rogue_score: 100, max_rogue_score: 100,
    current_reserve_stamina: 2400,
  });
  assert.deepEqual(hsr, [
    { label: '\u5f00\u62d3\u529b', value: '240 / 240' },
    { label: '\u6bcf\u65e5\u5b9e\u8bad\u6d3b\u8dc3\u5ea6', value: '500 / 500' },
    { label: '\u6a21\u62df\u5b87\u5b99\u79ef\u5206', value: '100 / 100' },
    { label: '\u540e\u5907\u5f00\u62d3\u529b', value: '2400' },
  ]);
  assert.equal(JSON.stringify(hsr).includes('\u5df2\u9886\u53d6'), false);

  const zzz = summarize('zzz', {
    energy: { progress: { current: 240, max: 240 } },
    vitality: { current: 100, max: 100 },
  });
  assert.deepEqual(zzz, [
    { label: '\u7535\u91cf', value: '240 / 240' },
    { label: '\u6bcf\u65e5\u6d3b\u8dc3\u5ea6', value: '100 / 100' },
  ]);
  assert.equal(zzz.some(item => item.label === '\u5f55\u50cf\u5e97' || item.label === '\u522e\u522e\u5361'), false);
  assert.deepEqual(summarize('zzz', {
    video_store_state: 'SaleStateDone',
    card_sign: 'CardSignDone',
    vhs_sale: { sale_state: 'SaleStateNo' },
  }).map(item => item.value), ['\u5f85\u9886\u53d6\u6536\u76ca', '\u5df2\u5b8c\u6210']);
  assert.equal(summarize('zzz', { vhs_sale: { sale_state: 'SaleStateDoing' } })[0].value, '\u8425\u4e1a\u4e2d');
});
