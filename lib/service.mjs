// SPDX-License-Identifier: AGPL-3.0-or-later
import QRCode from 'qrcode';
import { GAMES, UPSTREAM, HoyoClient, HoyoError, completeCookie, parseConfirmation, errorJSON, summarize, uuid } from './hoyo.mjs';
import { initialState } from './state.mjs';

export class SettingsService {
  constructor(store, options = {}) {
    this.store = store;
    this.db = store.load() ?? initialState();
    this.events = [];
    this.qr = null;
    this.lastPoll = 0;
    this.client = new HoyoClient({ ...options, deviceID: this.db.deviceID, onEvent: (stage, code, message) => this.event(stage, code, message) });
    this.ready = Promise.resolve(this.save());
    this.ready.catch(() => {}); // Host awaits ready before exposing the controller.
  }
  save() { return this.store.save(this.db); }
  event(stage, code, message) {
    this.events.push({ at: new Date().toISOString(), stage, code, message });
    this.events = this.events.slice(-30);
  }
  view() {
    const a = this.db.account;
    return { upstream: UPSTREAM, account: a ? { id: a.id, tokenVersion: a.stoken.startsWith('v2_') ? 'v2' : 'other', deviceReady: Boolean(a.deviceFP), savedAt: a.savedAt } : null,
      qr: this.qr ? { status: this.qr.status, svg: this.qr.svg, ...(this.qr.error ? { error: this.qr.error } : {}) } :
        this.db.pending ? { status: 'error', svg: '', error: { stage: 'auth.complete', code: 'PENDING', message: '扫码已确认；点击继续认证完成 Token 和设备指纹步骤。' } } : null,
      roles: this.db.roles, roleErrors: this.db.roleErrors, settings: this.db.settings, notes: this.db.notes, events: this.events };
  }
  requireAccount() {
    if (!this.db.account) throw new HoyoError('account', 'LOGIN_REQUIRED', '请先完成 App 扫码认证。');
    return this.db.account;
  }
  async createQR() {
    const deviceID = uuid(); // Upstream QR task UUID is distinct from profile vendor UUID.
    const data = await this.client.createQR(deviceID);
    if (!data.url || !data.ticket) throw new HoyoError('qr.create', 'INVALID_QR', '上游未返回二维码 URL / ticket。');
    const svg = await QRCode.toString(data.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 3, width: 256 });
    this.qr = { status: 'Created', deviceID, ticket: data.ticket, svg };
    this.db.pending = null;
    await this.save();
    return this.view();
  }
  async poll() {
    if (this.qr?.status === 'Confirmed') return this.view();
    if (this.db.pending) return this.complete();
    if (!this.qr?.ticket) throw new HoyoError('qr.query', 'NO_QR', '请先创建二维码。');
    // Same-ticket requests are serialized by HTTP controller; enforce upstream's 1s minimum.
    const wait = 1000 - (Date.now() - this.lastPoll);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    this.lastPoll = Date.now();
    try {
      const data = await this.client.queryQR(this.qr.deviceID, this.qr.ticket);
      const parsed = parseConfirmation(data);
      if (parsed) {
        this.db.pending = parsed;
        await this.save();
        this.qr.status = 'Confirmed';
        return await this.complete();
      }
      if (!['Init', 'Created', 'Scanned'].includes(data.status)) throw new HoyoError('qr.query', 'UNKNOWN_STATUS', `上游二维码状态：${String(data.status)}`);
      this.qr.status = data.status === 'Init' ? 'Created' : data.status;
      delete this.qr.error;
      return this.view();
    } catch (error) {
      this.qr.status = 'error'; this.qr.error = errorJSON(error, 'qr.query'); throw error;
    }
  }
  async complete() {
    const pending = this.db.pending;
    if (!pending) { this.requireAccount(); return this.view(); }
    try {
      if (!pending.cookie) {
        const token = await this.client.cookieToken(pending);
        if (!token.cookie_token || !token.uid) throw new HoyoError('auth.cookieToken', 'NO_TOKEN', '上游未返回 cookie_token / uid。');
        pending.cookie = completeCookie(pending, token); await this.save();
      }
      if (!pending.deviceFP) {
        const fp = await this.client.fingerprint(this.db.deviceID, this.db.fpRefreshDate);
        Object.assign(pending, fp); await this.save();
      }
      this.db.account = { ...pending, deviceID: this.db.deviceID, savedAt: new Date().toISOString() };
      this.db.pending = null; this.db.profiles = {}; this.db.roles = []; this.db.notes = {}; this.db.roleErrors = {};
      await this.save();
      if (this.qr) { this.qr.status = 'Confirmed'; delete this.qr.error; this.qr.svg = ''; delete this.qr.ticket; }
      await this.loadRoles();
      return this.view();
    } catch (error) {
      if (this.qr) { this.qr.status = 'error'; this.qr.error = errorJSON(error, 'auth.complete'); }
      throw error;
    }
  }
  async loadRoles() {
    const account = this.requireAccount();
    // Keep per-game failures independent in this settings UI, never turn them into empty-success.
    for (const game of Object.keys(GAMES)) {
      try {
        const roles = await this.client.roles(game, account.cookie);
        const profiles = {};
        for (const role of roles) {
          const existing = this.db.profiles[role.id];
          if (existing) profiles[role.id] = existing;
          else {
            // CreateProfileSheetView.handleSingleFetchedUnit requests a region/game-specific FP.
            const fp = await this.client.fingerprint(account.deviceID, this.db.fpRefreshDate, game);
            profiles[role.id] = { ...fp, deviceID: account.deviceID };
          }
        }
        this.db.roles = [...this.db.roles.filter(role => role.game !== game), ...roles];
        for (const role of Object.keys(this.db.profiles)) if (role.startsWith(`${game}:`)) delete this.db.profiles[role];
        Object.assign(this.db.profiles, profiles);
        delete this.db.roleErrors[game];
        const selected = this.db.settings.selectedRoles[game];
        if (!roles.some(role => role.id === selected)) {
          const preferred = roles.find(role => role.isChosen) ?? roles[0];
          if (preferred) this.db.settings.selectedRoles[game] = preferred.id;
          else delete this.db.settings.selectedRoles[game];
          delete this.db.notes[game];
        }
      } catch (error) { this.db.roleErrors[game] = errorJSON(error, `roles.${game}`); }
      await this.save();
    }
    return this.view();
  }
  settings(input) {
    if (input.intervalMinutes !== undefined) {
      if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 5) throw new HoyoError('settings', 'INVALID_INTERVAL', '刷新间隔应为至少 5 分钟的整数。');
    }
    if (input.selectedRoles !== undefined) {
      for (const [game, id] of Object.entries(input.selectedRoles)) {
        if (!GAMES[game] || !this.db.roles.some(role => role.id === id && role.game === game)) throw new HoyoError('settings', 'INVALID_ROLE', '请选择当前账号绑定的角色。');
      }
      for (const [game, id] of Object.entries(input.selectedRoles)) {
        if (this.db.settings.selectedRoles[game] !== id) delete this.db.notes[game];
        this.db.settings.selectedRoles[game] = id;
      }
    }
    if (input.intervalMinutes !== undefined) this.db.settings.intervalMinutes = input.intervalMinutes;
    this.save(); return this.view();
  }
  async refresh(game) {
    const account = this.requireAccount();
    if (!GAMES[game]) throw new HoyoError('note', 'INVALID_GAME', '未知游戏。');
    const role = this.db.roles.find(role => role.id === this.db.settings.selectedRoles[game] && role.game === game);
    if (!role) throw new HoyoError(`note.${game}`, 'ROLE_REQUIRED', '请先发现并选择角色。');
    const profile = this.db.profiles[role.id];
    if (!profile?.deviceFP) throw new HoyoError(`note.${game}`, 'DEVICE_REQUIRED', '该角色缺少设备指纹；请重新发现角色完成认证。');
    const updatedAt = new Date().toISOString();
    try {
      const result = await this.client.note(game, role, { ...account, ...profile });
      this.db.notes[game] = { status: 'ok', ...result, updatedAt, roleId: role.id, summary: summarize(game, result.data) };
    } catch (error) {
      this.db.notes[game] = { status: 'error', updatedAt, roleId: role.id, error: errorJSON(error, `note.${game}`), attempts: error.attempts ?? [], summary: [] };
    }
    await this.save(); return this.view();
  }
  remove() {
    this.db.account = null; this.db.pending = null; this.db.profiles = {}; this.db.roles = [];
    this.db.roleErrors = {}; this.db.notes = {}; this.db.settings.selectedRoles = {}; this.qr = null; this.events = [];
    this.save(); return this.view();
  }
}
