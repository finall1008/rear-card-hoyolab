// SPDX-License-Identifier: AGPL-3.0-or-later
// API 2 host adapter. No HTTP daemon, localhost, browser fetch or Node imports.
import { SettingsService } from '../lib/service.mjs';
import { initialState } from '../lib/state.mjs';
import { GAMES, HoyoError, errorJSON } from '../lib/hoyo.mjs';
import { buildCardSnapshot } from '../lib/card-state.mjs';
import { backgroundStorageKey, validateBackgroundInput } from '../lib/backgrounds.mjs';

const IDENTITY = 'hoyolab.identity';
const AUTH = 'hoyolab.auth';
const SETTINGS = 'hoyolab.settings';
const noteKey = game => `hoyolab.note.${game}`;
const clone = value => JSON.parse(JSON.stringify(value));
const stamp = db => db.account?.savedAt ?? null;
function groups(db) {
  const { version, deviceID, fpRefreshDate, account, pending, profiles, roles, roleErrors, settings } = db;
  return { [IDENTITY]: { version, deviceID, fpRefreshDate }, [AUTH]: { account, pending, profiles, roles, roleErrors }, [SETTINGS]: settings };
}

export function bridgeTransport(bridge, { timeoutMs } = {}) {
  return async (url, options, stage) => {
    let response;
    try {
      response = await bridge.net.request({ url, method: options.method,
        // Native text bridge does not decode an explicitly requested gzip/br body.
        // Compression negotiation only; Cookie, DS and all x-rpc values are unchanged.
        headers: { ...options.headers, 'Accept-Encoding': 'identity' },
        ...(options.body === undefined ? {} : { body: options.body }),
        // Explicit SToken Cookie: no mixing with WebView Profile cookies.
        cookies: false, redirect: 'manual', responseType: 'text',
        timeoutMs: timeoutMs ?? (stage === 'qr.query' ? 15000 : 30000) });
    } catch (error) {
      throw new HoyoError(stage, error?.code === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK', '桥网络请求未取得响应；可手动重试当前步骤。');
    }
    if (response.status < 200 || response.status >= 300) throw new HoyoError(stage, response.status, `上游 HTTP ${response.status}`);
    try { return JSON.parse(response.body); }
    catch { throw new HoyoError(stage, 'INVALID_JSON', '上游返回非 JSON 内容。'); }
  };
}

// Async bridge storage is mirrored for the shared controller's synchronous reads.
// Persist only changed domains: background note writes cannot overwrite foreground auth/settings.
export class BridgeStore {
  static async open(bridge) {
    const store = new BridgeStore(bridge);
    const [identity, auth, settings] = await Promise.all([IDENTITY, AUTH, SETTINGS].map(key => bridge.storage.get(key)));
    store.db = { ...initialState(), ...(identity ?? {}), ...(auth ?? {}), ...(settings ? { settings } : {}) };
    store.encoded = Object.fromEntries(Object.entries(groups(store.db)).map(([key, value]) => [key, JSON.stringify(value)]));
    // Missing records must be persisted on first save, including the stable device UUID.
    for (const [key, value] of [[IDENTITY, identity], [AUTH, auth], [SETTINGS, settings]]) if (value === null || value === undefined) delete store.encoded[key];
    await store.readNotes(store.db);
    return store;
  }
  constructor(bridge) { this.bridge = bridge; this.queue = Promise.resolve(); this.encoded = {}; this.noteEncoded = {}; this.failure = null; }
  load() { return clone(this.db); }
  async readNotes(db) {
    const entries = await Promise.all(Object.keys(GAMES).map(async game => [game, await this.bridge.storage.get(noteKey(game))]));
    db.notes = {};
    for (const [game, item] of entries) {
      if (item?.owner && item.owner === stamp(db) && item.note?.roleId === db.settings.selectedRoles[game]) db.notes[game] = item.note;
      this.noteEncoded[game] = JSON.stringify(db.notes[game] ?? null);
    }
  }
  save(db) {
    const snapshot = clone(db);
    const writes = [];
    for (const [key, value] of Object.entries(groups(snapshot))) {
      const encoded = JSON.stringify(value);
      if (this.encoded[key] !== encoded) {
        this.encoded[key] = encoded;
        writes.push(() => this.bridge.storage.set(key, value));
      }
    }
    for (const game of Object.keys(GAMES)) {
      const note = snapshot.notes[game] ?? null;
      const encoded = JSON.stringify(note);
      if (this.noteEncoded[game] === encoded) continue;
      this.noteEncoded[game] = encoded;
      writes.push(async () => {
        const [auth, settings] = await Promise.all([this.bridge.storage.get(AUTH), this.bridge.storage.get(SETTINGS)]);
        if ((auth?.account?.savedAt ?? null) !== stamp(snapshot)) return;
        if (note && settings?.selectedRoles?.[game] !== note.roleId) return;
        await this.bridge.storage.set(noteKey(game), note ? { owner: stamp(snapshot), note } : null);
      });
    }
    const operation = this.queue.then(async () => {
      if (this.failure) throw this.failure;
      for (const write of writes) await write();
      this.db = snapshot;
    });
    this.queue = operation;
    operation.catch(error => { this.failure = error; });
    return operation;
  }
  async flush() { await this.queue; }
}

async function publishSnapshot(bridge, db) {
  const owner = stamp(db);
  const [auth, settings] = await Promise.all([bridge.storage.get(AUTH), bridge.storage.get(SETTINGS)]);
  if ((auth?.account?.savedAt ?? null) !== owner) return;
  // The current persisted selection wins over a stale foreground/background mirror.
  const current = { ...db, settings: settings ?? db.settings };
  const snapshot = buildCardSnapshot(current, bridge.card.readSnapshot());
  // Display-only fields; no Cookie/SToken/MID/device fingerprint. Await before repaint.
  await bridge.card.saveSnapshot(snapshot);
}

export async function createBridgeRuntime(bridge, options = {}) {
  const store = await BridgeStore.open(bridge);
  const service = new SettingsService(store, { transport: bridgeTransport(bridge, options) });
  await service.ready;
  let tail = Promise.resolve();
  const view = () => ({ ...service.view(), csrf: 'bridge', runtime: { mode: 'bridge', name: '卡片桥', scheduler: 'bridge' } });
  async function execute(method, path, body = {}) {
    try {
      if (method === 'GET' && path === '/api/state') {
        await store.readNotes(service.db);
        return view();
      }
      const backgroundPath = path.match(/^\/api\/background\/(home|genshin|hsr|zzz)$/);
      if (method === 'GET' && backgroundPath) {
        return { page: backgroundPath[1], value: await bridge.storage.get(backgroundStorageKey(backgroundPath[1])) };
      }
      const actions = {
        '/api/auth/qr': () => service.createQR(), '/api/auth/poll': () => service.poll(), '/api/auth/complete': () => service.complete(),
        '/api/account/roles': () => service.loadRoles(), '/api/settings': () => service.settings({ selectedRoles: body.selectedRoles }),
        '/api/background': async () => {
          const validated = validateBackgroundInput(body);
          const key = backgroundStorageKey(validated.page);
          if (validated.mode === 'default') await bridge.storage.remove(key);
          else await bridge.storage.set(key, validated.value);
          service.settings({ backgrounds: { [validated.page]: validated.mode } });
        },
        '/api/notes/refresh': () => service.refresh(body.game), '/api/account/remove': () => service.remove(),
      };
      if (method !== 'POST' || !actions[path]) throw new HoyoError('bridge', 'NOT_FOUND', '未知模块操作。');
      const beforeOwner = stamp(service.db);
      await actions[path]();
      await store.flush();
      if (['/api/account/remove', '/api/settings', '/api/notes/refresh'].includes(path) || stamp(service.db) !== beforeOwner) await publishSnapshot(bridge, service.db);
      return view();
    } catch (error) {
      const wrapped = new Error('模块操作未完成');
      wrapped.detail = errorJSON(error, 'bridge');
      wrapped.payload = { ...view(), error: wrapped.detail };
      throw wrapped;
    }
  }
  return {
    mode: 'bridge',
    request(method, path, body) {
      const next = tail.then(() => execute(method, path, body));
      tail = next.catch(() => {});
      return next;
    },
  };
}

export async function refreshBackground(bridge) {
  const store = await BridgeStore.open(bridge);
  const service = new SettingsService(store, { transport: bridgeTransport(bridge, { timeoutMs: 3000 }) });
  await service.ready;
  if (!service.db.account) return { refreshed: 0 };
  const owner = stamp(service.db);
  let refreshed = 0;
  // Up to six note calls. Short connect/read timeouts leave room for storage;
  // the host still owns the hard 60-second lifetime (DNS/system scheduling can vary).
  for (const game of Object.keys(service.db.settings.selectedRoles)) {
    const auth = await bridge.storage.get(AUTH);
    if (auth?.account?.savedAt !== owner) return { refreshed: 0 };
    await service.refresh(game);
    const note = service.db.notes[game];
    if (note?.status !== 'ok') continue;
    refreshed++;
  }
  await store.flush();
  const auth = await bridge.storage.get(AUTH);
  if (refreshed && auth?.account?.savedAt === owner) {
    // An entirely failed refresh leaves the previous frame untouched.
    await publishSnapshot(bridge, service.db);
  }
  return { refreshed };
}
