// (c) 2024 and onwards Pizza Studio (AGPL v3.0 or later).
// JavaScript adaptation, 2026. SPDX-License-Identifier: AGPL-3.0-or-later
// Protocol port of PizzaHelperUnited @ 29a063c4. See UPSTREAM.md for source mapping.
import { md5, randomInt, uuid } from './platform.mjs';
export { md5, uuid } from './platform.mjs';

export const UPSTREAM = Object.freeze({ name: 'The Latte Helper', commit: '29a063c4d906d9f02954ddf1f422e9a4d087aa59' });
export const GAMES = Object.freeze({
  genshin: { biz: 'hk4e_cn', full: '/game_record/app/genshin/api/dailyNote', widget: '/game_record/app/genshin/aapi/widget/v2' },
  hsr: { biz: 'hkrpg_cn', full: '/game_record/app/hkrpg/api/note', widget: '/game_record/app/hkrpg/aapi/widget' },
  zzz: { biz: 'nap_cn', full: '/event/game_record_zzz/api/zzz/note', widget: '/event/game_record_zzz/api/zzz/widget' },
});
export const QR_BASE = 'https://passport-api.mihoyo.com/account/ma-cn-passport/app/';
export const ACCOUNT_BASE = 'https://api-takumi.mihoyo.com';
export const RECORD_BASE = 'https://api-takumi-record.mihoyo.com';
export const WIDGET_UA = 'WidgetExtension/434 CFNetwork/1492.0.1 Darwin/23.3.0';

export class HoyoError extends Error {
  constructor(stage, code, message) { super(message); this.stage = stage; this.code = code; }
  toJSON() { return { stage: this.stage, code: this.code, message: this.message }; }
}
export function errorJSON(error, stage = 'local') {
  return error instanceof HoyoError ? error.toJSON() : { stage, code: 'LOCAL_ERROR', message: '本地处理失败，请查看服务终端中的阶段信息。' };
}

// URLRequestHelper.getDS: query order and signed body MUST match the bytes sent.
export function makeDS(query, body = '', time = Math.floor(Date.now() / 1000), random = randomInt(100000, 200000)) {
  const hash = md5(`salt=xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs&t=${time}&r=${random}&b=${body}&q=${query}`);
  return `${time},${random},${hash}`;
}
export function defaultHeaders(deviceID, additional = {}) {
  return {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) miHoYoBBS/2.40.1',
    Referer: 'https://webstatic.mihoyo.com', Origin: 'https://webstatic.mihoyo.com',
    'Accept-Encoding': 'gzip, deflate, br', 'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
    Accept: 'application/json, text/plain, */*', Connection: 'keep-alive',
    'X-Requested-With': 'com.mihoyo.hyperion', 'x-rpc-app_version': '2.40.1',
    'x-rpc-client_type': '5', 'x-rpc-page': '3.1.3_#/rpg', 'x-rpc-device_id': deviceID,
    'x-rpc-language': 'zh-cn', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'cors',
    ...additional,
  };
}
export function qrHeaders(deviceID) {
  return { 'x-rpc-app_id': 'ddxf5dufpuyo', 'x-rpc-client_type': '3',
    'x-rpc-device_id': deviceID, 'User-Agent': 'HYPContainer/1.3.3.182', 'Content-Type': 'application/json' };
}

// GetDeviceFingerPrint.swift, CN branch, including the exact upstream ext_fields.
export function fpExtFields(deviceID) {
  return `{"ramCapacity":"3746","hasVpn":"0","proxyStatus":"0","screenBrightness":"0.550","packageName":"com.miHoYo.mhybbs","romRemain":"100513","deviceName":"iPhone","isJailBreak":"0","magnetometer":"-160.495300x-206.488358x58.534348","buildTime":"1706406805675","ramRemain":"97","accelerometer":"-0.419876x-0.748367x-0.508057","cpuCores":"6","cpuType":"CPU_TYPE_ARM64","packageVersion":"2.20.1","gyroscope":"0.133974x-0.051780x-0.062961","batteryStatus":"45","appUpdateTimeDiff":"1707130080397","appMemory":"57","screenSize":"414×896","vendor":"--","model":"iPhone12,5","IDFV":"${deviceID.toUpperCase()}","romCapacity":"488153","isPushEnabled":"1","appInstallTimeDiff":"1696756955347","osVersion":"17.2.1","chargeStatus":"1","isSimInserted":"1","networkType":"WIFI"}`;
}
function shuffled(text) {
  const chars = [...text];
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}
export function makeFPBody(deviceID, refreshDate, now = Date.now(), game = 'genshin') {
  const swiftDate = Number.isInteger(refreshDate) ? `${refreshDate}.0` : String(refreshDate);
  const device = md5(deviceID + swiftDate);
  return { seed_id: Array.from({ length: 16 }, () => '0123456789abcdef'[randomInt(16)]).join(''),
    device_id: device, platform: '1', seed_time: `${Math.floor(now / 1000)}000`,
    ext_fields: fpExtFields(device), app_name: GAMES[game].biz, device_fp: shuffled(md5(device)).slice(0, 13) };
}

export function parseConfirmation(data) {
  if (data.status !== 'Confirmed') return null;
  const user = data.user_info ?? {};
  const id = user.aid ?? user.uid ?? user.account_id ?? '';
  const stoken = data.tokens?.[0]?.token ?? '';
  // QueryQRCodeStatus.parsed(): ltoken is the returned stoken, not a web-login token.
  return { id, stoken, ltoken: stoken, mid: user.mid ?? '' };
}
export function stokenCookie(account) { return `stuid=${account.id}; stoken=${account.stoken}; mid=${account.mid}`; }
export function completeCookie(account, token) {
  return `stuid=${account.id}; stoken=${account.stoken}; ltuid=${account.id}; ltoken=${account.ltoken}; mid=${account.mid}; cookie_token=${token.cookie_token}; account_id=${token.uid}; `;
}

// Transport is injectable; no credentials in returned exceptions or logs.
export async function fetchJSON(url, options, stage) {
  let response;
  try { response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(stage === 'qr.query' ? 15000 : 30000) }); }
  catch (error) { throw new HoyoError(stage, error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', '请求未取得响应；可手动重试当前步骤。'); }
  if (!response.ok) throw new HoyoError(stage, response.status, `上游 HTTP ${response.status}`);
  try { return await response.json(); }
  catch { throw new HoyoError(stage, 'INVALID_JSON', '上游返回非 JSON 内容。'); }
}
export class HoyoClient {
  constructor({ transport = fetchJSON, deviceID = uuid(), onEvent = () => {} } = {}) {
    this.transport = transport; this.deviceID = deviceID; this.onEvent = onEvent;
  }
  async call(url, options, stage) {
    this.onEvent(stage, 'request', '请求上游');
    try {
      const body = await this.transport(url, options, stage);
      if (body.retcode !== 0) throw new HoyoError(stage, body.retcode ?? 'INVALID_RESPONSE', body.message || '上游返回错误。');
      if (body.data == null) throw new HoyoError(stage, 'NO_DATA', '上游未返回 data。');
      this.onEvent(stage, 0, '完成');
      return body.data;
    } catch (error) {
      const safe = errorJSON(error, stage); this.onEvent(stage, safe.code, safe.message); throw error;
    }
  }
  signed(base, path, query, cookie, stage, additional = {}) {
    const queryString = new URLSearchParams(query).toString();
    const url = base + path + (queryString ? `?${queryString}` : '');
    return this.call(url, { method: 'GET', headers: { ...defaultHeaders(this.deviceID, additional), Cookie: cookie, DS: makeDS(queryString) } }, stage);
  }
  createQR(deviceID) { return this.call(QR_BASE + 'createQRLogin', { method: 'POST', headers: qrHeaders(deviceID), body: '{}' }, 'qr.create'); }
  queryQR(deviceID, ticket) { return this.call(QR_BASE + 'queryQRLoginStatus', { method: 'POST', headers: qrHeaders(deviceID), body: JSON.stringify({ ticket }) }, 'qr.query'); }
  cookieToken(account) { return this.signed(ACCOUNT_BASE, '/auth/api/getCookieAccountInfoBySToken', [], stokenCookie(account), 'auth.cookieToken'); }
  async fingerprint(deviceID, refreshDate, game = 'genshin') {
    const body = makeFPBody(deviceID, refreshDate, Date.now(), game);
    const data = await this.call('https://public-data-api.mihoyo.com/device-fp/api/getFp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, 'auth.fingerprint');
    if (!data.device_fp) throw new HoyoError('auth.fingerprint', data.code ?? 'NO_FP', data.msg || '上游未返回 device_fp。');
    return { deviceFP: data.device_fp, seedID: body.seed_id, seedTime: body.seed_time };
  }
  async roles(game, cookie) {
    const data = await this.signed(ACCOUNT_BASE, '/binding/api/getUserGameRolesByCookie', [['game_biz', GAMES[game].biz]], cookie, `roles.${game}`);
    if (!Array.isArray(data.list)) throw new HoyoError(`roles.${game}`, 'INVALID_ROLES', '上游未返回角色列表。');
    return data.list.map(role => ({ id: `${game}:${role.region}:${role.game_uid}`, game, uid: role.game_uid,
      server: role.region, nickname: role.nickname, level: role.level, regionName: role.region_name, isChosen: role.is_chosen }));
  }
  async note(game, role, account) {
    const config = GAMES[game];
    const additional = { 'x-rpc-device_fp': account.deviceFP, 'x-rpc-device_id': account.deviceID };
    if (game === 'zzz') additional['User-Agent'] = WIDGET_UA;
    const attempts = [];
    try {
      const data = await this.signed(RECORD_BASE, config.full, [['role_id', role.uid], ['server', role.server]], account.cookie, `note.${game}.full`, additional);
      attempts.push({ source: 'full', code: 0, message: '完成' });
      return { source: 'full', data, attempts };
    } catch (error) { attempts.push({ source: 'full', ...errorJSON(error, `note.${game}.full`) }); }
    // This branch is upstream behavior, not a prototype-added web/anonymous fallback.
    if (!account.cookie.includes('stoken=v2_')) {
      const error = new HoyoError(`note.${game}`, 'STOKEN_V2_REQUIRED', '拿铁原逻辑：完整便笺失败且缺少 SToken v2。');
      error.attempts = attempts; throw error;
    }
    const widgetHeaders = { ...additional };
    if (game !== 'genshin') widgetHeaders['User-Agent'] = WIDGET_UA;
    try {
      const data = await this.signed(RECORD_BASE, config.widget, [], account.cookie, `note.${game}.widget`, widgetHeaders);
      attempts.push({ source: 'widget', code: 0, message: '完成' });
      return { source: 'widget', data, attempts };
    } catch (error) {
      attempts.push({ source: 'widget', ...errorJSON(error, `note.${game}.widget`) });
      error.attempts = attempts; throw error;
    }
  }
}

export function summarize(game, data) {
  const result = [];
  const pair = (label, current, max) => { if (current != null && max != null) result.push({ label, value: `${current} / ${max}` }); };
  const flag = (label, value) => { if (typeof value === 'boolean') result.push({ label, value: value ? '已领取' : '未领取' }); };
  if (game === 'genshin') {
    pair('原粹树脂', data.current_resin, data.max_resin);
    pair('每日委托', data.finished_task_num, data.total_task_num);
    flag('委托额外奖励', data.is_extra_task_reward_received);
    pair('洞天宝钱', data.current_home_coin, data.max_home_coin);
  } else if (game === 'hsr') {
    pair('开拓力', data.current_stamina, data.max_stamina);
    pair('每日实训活跃度', data.current_train_score, data.max_train_score);
    if (data.current_rogue_score != null) pair('模拟宇宙积分', data.current_rogue_score, data.max_rogue_score);
    if (data.current_reserve_stamina != null) result.push({ label: '后备开拓力', value: String(data.current_reserve_stamina) });
  } else {
    pair('电量', data.energy?.progress?.current, data.energy?.progress?.max);
    pair('每日活跃度', data.vitality?.current, data.vitality?.max);
    const state = data.video_store_state ?? data.vhs_sale?.sale_state;
    if (state != null) result.push({ label: '录像店', value: { SaleStateDone: '待领取收益', SaleStateNo: '待营业', SaleStateDoing: '营业中' }[state] ?? String(state) });
    if (data.card_sign != null) result.push({ label: '刮刮卡', value: data.card_sign.includes('Done') ? '已完成' : '未完成' });
  }
  // Deliberately do not infer that activity points mean rewards have been claimed.
  return result;
}
