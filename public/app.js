// SPDX-License-Identifier: AGPL-3.0-or-later
// Local settings page. QR codes are created only after a click.
// Polling is serial: about 3s between starts, never overlapping.
// qr.query* keeps the same code and calls /api/auth/poll.
// auth.cookieToken / auth.fingerprint / auth.complete call /api/auth/complete.

'use strict';

const GAMES = [
  { id: 'genshin', code: 'GI', name: '原神' },
  { id: 'hsr', code: 'HSR', name: '崩坏：星穹铁道' },
  { id: 'zzz', code: 'ZZZ', name: '绝区零' },
];

const POLL_GAP_MS = 3000;
const POLL_MIN_MS = 1000;
// Confirmation also runs Cookie/FP and per-role provisioning before this POST returns.
const POLL_TIMEOUT_MS = 300000;
const STATE_QR_MS = 8000;
const STATE_AUTH_MS = 15000;

const model = {
  csrf: '',
  upstream: null,
  account: null,
  qr: null,
  roles: [],
  roleErrors: {},
  settings: { selectedRoles: {}, intervalMinutes: 15 },
  notes: {},
  events: [],
};

const busy = new Set();
let draftDirty = false;
let draftSelected = {};
let connOk = false;
let connError = null;
let actionError = null;
let lastRetry = null;
let lastSyncAt = null;
let lastSvg = '';
let lastPollAt = 0;
let pollTimer = 0;
let pollInFlight = false;
let pollPaused = false;
let stateTimer = 0;
let stateInFlight = false;
let requestEpoch = 0;
let mutationTail = Promise.resolve();
let roleSignature = '';
let confirmResolve = null;

function enqueue(task) {
  const run = mutationTail.then(task, task);
  mutationTail = run.then(() => {}, () => {});
  return run;
}

function $(id) {
  return document.getElementById(id);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function clear(node) {
  node.replaceChildren();
}

function textOf(value) {
  if (value == null || value === '') return '—';
  return String(value);
}

function showValue(value) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '—';
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function gameById(id) {
  return GAMES.find((game) => game.id === id) || null;
}

function selectedMap() {
  if (draftDirty) return draftSelected;
  const saved = model.settings && model.settings.selectedRoles;
  return saved && typeof saved === 'object' ? saved : {};
}

function stageOf(error) {
  return String(error && error.stage || '');
}

function isQueryStage(error) {
  return stageOf(error).startsWith('qr.query');
}

function isCompleteStage(error) {
  const stage = stageOf(error);
  return stage.startsWith('auth.cookieToken')
    || stage.startsWith('auth.fingerprint')
    || stage.startsWith('auth.complete');
}

function needsComplete() {
  return isCompleteStage(model.qr && model.qr.error) || isCompleteStage(actionError);
}

function canPoll() {
  if (needsComplete()) return false;
  if (model.qr && (model.qr.status === 'Created' || model.qr.status === 'Scanned')) return true;
  return isQueryStage(model.qr && model.qr.error) || isQueryStage(actionError);
}

function shouldAutoPoll(qr) {
  return !!qr && (qr.status === 'Created' || qr.status === 'Scanned');
}

function normalizeError(error) {
  if (error && error.detail && typeof error.detail === 'object') return error.detail;
  if (error && error.name === 'AbortError') {
    return { stage: 'http', code: 'TIMEOUT', message: '等待响应超时。可以再试一次。' };
  }
  if (error instanceof TypeError) return { stage: 'http', code: 'NETWORK', message: '没有连上本机服务。' };
  return { stage: 'http', code: 'ERROR', message: (error && error.message) || '请求失败' };
}

function hasState(payload) {
  return !!payload && typeof payload === 'object' && (
    'csrf' in payload || 'upstream' in payload || 'account' in payload || 'qr' in payload || 'notes' in payload
  );
}

function svgDataUri(svg) {
  if (typeof svg !== 'string' || !/<svg/i.test(svg)) return '';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function setLive(text) {
  const node = $('live-status');
  if (node) node.textContent = text || '';
}

function setBusy(name, on) {
  if (on) busy.add(name);
  else busy.delete(name);
  render();
}

function applyState(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (typeof payload.csrf === 'string' && payload.csrf) model.csrf = payload.csrf;
  if ('upstream' in payload) model.upstream = payload.upstream;
  if ('account' in payload) model.account = payload.account || null;
  if ('qr' in payload) model.qr = payload.qr || null;
  if ('roles' in payload) model.roles = Array.isArray(payload.roles) ? payload.roles : [];
  if ('roleErrors' in payload) {
    model.roleErrors = payload.roleErrors && typeof payload.roleErrors === 'object' ? payload.roleErrors : {};
  }
  if ('settings' in payload && payload.settings && typeof payload.settings === 'object') model.settings = payload.settings;
  if ('notes' in payload) model.notes = payload.notes && typeof payload.notes === 'object' ? payload.notes : {};
  if ('events' in payload) model.events = Array.isArray(payload.events) ? payload.events : [];
  lastSyncAt = new Date();
  render();
}

async function fetchJson(method, path, body, timeoutMs) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = model.csrf;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) {
      const detail = payload && payload.error ? payload.error : {
        stage: 'http',
        code: String(response.status),
        message: response.statusText || '请求失败',
      };
      const error = new Error(detail.message || '请求失败');
      error.detail = detail;
      error.payload = payload;
      throw error;
    }
    if (!payload || typeof payload !== 'object') {
      const error = new Error('响应不是 JSON。');
      error.detail = { stage: 'http', code: 'INVALID_JSON', message: '响应不是 JSON。' };
      throw error;
    }
    return payload;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      const wrapped = new Error('等待响应超时。');
      wrapped.detail = { stage: 'http', code: 'TIMEOUT', message: '等待响应超时。可以再试一次。' };
      throw wrapped;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getState() {
  const seen = requestEpoch;
  try {
    const payload = await fetchJson('GET', '/api/state', undefined, 15000);
    if (seen !== requestEpoch) return;
    connOk = true;
    connError = null;
    applyState(payload);
  } catch (error) {
    if (seen !== requestEpoch) return;
    connOk = false;
    connError = normalizeError(error);
    render();
    throw error;
  }
}

async function post(path, body, timeoutMs) {
  if (!model.csrf) {
    const error = new Error('还没有拿到 CSRF，请先重新读取状态。');
    error.detail = { stage: 'http', code: 'CSRF', message: '还没有拿到 CSRF，请先重新读取状态。' };
    throw error;
  }
  return enqueue(() => send(path, body, timeoutMs));
}

async function send(path, body, timeoutMs) {
  requestEpoch += 1;
  try {
    const payload = await fetchJson('POST', path, body ?? {}, timeoutMs);
    requestEpoch += 1;
    connOk = true;
    connError = null;
    applyState(payload);
    return payload;
  } catch (error) {
    requestEpoch += 1;
    if (hasState(error && error.payload)) {
      connOk = true;
      connError = null;
      applyState(error.payload);
    } else if ((error == null || error.payload == null) && (!error || !error.detail || error.detail.code !== 'CSRF')) {
      connOk = false;
      connError = normalizeError(error);
      render();
    }
    throw error;
  }
}

function armPollTimer() {
  if (pollInFlight || pollPaused) return;
  if (!shouldAutoPoll(model.qr)) {
    clearTimeout(pollTimer);
    pollTimer = 0;
    return;
  }
  if (pollTimer) return;
  const wait = lastPollAt ? Math.max(0, POLL_GAP_MS - (Date.now() - lastPollAt)) : 400;
  pollTimer = setTimeout(() => {
    pollTimer = 0;
    pollOnce(false);
  }, wait);
}

function ensureStateLoop() {
  if (stateTimer || stateInFlight || document.hidden) return;
  const delay = shouldAutoPoll(model.qr) ? STATE_QR_MS : (model.account ? STATE_AUTH_MS : 0);
  if (!delay) return;
  stateTimer = setTimeout(() => { refreshStateTick(); }, delay);
}

async function refreshStateTick() {
  stateTimer = 0;
  if (document.hidden) return;
  stateInFlight = true;
  try {
    await getState();
  } catch {
    // Connection text is updated from the failed read. Background reads do not raise a success banner.
  } finally {
    stateInFlight = false;
    ensureStateLoop();
  }
}

function onVisibility() {
  if (document.hidden) {
    clearTimeout(stateTimer);
    stateTimer = 0;
    clearTimeout(pollTimer);
    pollTimer = 0;
    return;
  }
  armPollTimer();
  ensureStateLoop();
}

async function pollOnce(manual) {
  if (pollInFlight) return;
  pollInFlight = true;
  clearTimeout(pollTimer);
  pollTimer = 0;
  setBusy('poll', true);
  if (manual) clearActionError();
  setLive(manual ? '正在查询这张二维码…' : '正在查询扫码状态…');
  const started = Date.now();
  try {
    await post('/api/auth/poll', {}, POLL_TIMEOUT_MS);
    pollPaused = false;
    if (manual) clearActionError();
    setLive('');
  } catch (error) {
    pollPaused = true;
    showActionError(error, 'poll');
    setLive('查询未完成，可再查。');
  } finally {
    lastPollAt = Date.now();
    pollInFlight = false;
    clearTimeout(pollTimer);
    pollTimer = 0;
    if (!pollPaused && shouldAutoPoll(model.qr)) {
      const wait = Math.max(0, POLL_GAP_MS - (Date.now() - started));
      pollTimer = setTimeout(() => {
        pollTimer = 0;
        pollOnce(false);
      }, wait);
    }
    setBusy('poll', false);
  }
}

function onManualPoll() {
  if (pollInFlight || busy.has('poll')) return;
  pollPaused = false;
  clearTimeout(pollTimer);
  pollTimer = 0;
  const since = Date.now() - lastPollAt;
  if (lastPollAt && since < POLL_MIN_MS) {
    setLive('稍等再查询。');
    pollTimer = setTimeout(() => {
      pollTimer = 0;
      pollOnce(true);
    }, POLL_MIN_MS - since);
    return;
  }
  pollOnce(true);
}

async function loadState() {
  if (busy.has('state')) return;
  setBusy('state', true);
  setLive('正在读取本机状态…');
  try {
    await getState();
    clearActionError();
    setLive('');
  } catch (error) {
    showActionError(error, 'state');
    setLive('尚未读到状态。');
  } finally {
    setBusy('state', false);
  }
}

async function createQr() {
  if (busy.has('qr')) return;
  setBusy('qr', true);
  pollPaused = false;
  clearActionError();
  setLive('正在生成二维码…');
  try {
    await post('/api/auth/qr', {}, 30000);
    setLive('二维码已生成，等待手机扫码。');
  } catch (error) {
    showActionError(error, 'qr');
    setLive('二维码未生成。');
  } finally {
    setBusy('qr', false);
  }
}

async function onCreateQr() {
  if (model.qr) {
    const ok = await confirmDialog({
      title: '重新生成二维码？',
      body: '当前二维码将作废。已确认未完成时改用「继续认证」。',
      confirmLabel: '重新生成',
      danger: true,
    });
    if (!ok) return;
  }
  await createQr();
}

async function completeAuth() {
  if (busy.has('complete')) return;
  setBusy('complete', true);
  clearActionError();
  setLive('正在继续认证…');
  try {
    await post('/api/auth/complete', {}, 300000);
    setLive('');
  } catch (error) {
    showActionError(error, 'complete');
    setLive('认证未完成，请再点继续认证。');
  } finally {
    setBusy('complete', false);
  }
}

async function loadRoles() {
  if (busy.has('roles')) return;
  setBusy('roles', true);
  clearActionError();
  setLive('正在获取绑定角色…');
  try {
    await post('/api/account/roles', {}, 300000);
    const failed = GAMES.filter((game) => model.roleErrors && model.roleErrors[game.id]);
    if (failed.length) setLive(`${failed.map((game) => game.name).join('、')}的角色列表失败，详情在对应卡片上。`);
    else setLive('');
  } catch (error) {
    showActionError(error, 'roles');
    setLive('获取角色未完成。');
  } finally {
    setBusy('roles', false);
  }
}

async function saveSettings() {
  if (busy.has('settings')) return;
  const text = $('interval').value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    showActionError({
      detail: { stage: 'settings', code: 'INVALID_INTERVAL', message: '刷新间隔应为至少 5 分钟的整数。' },
    }, 'settings');
    return;
  }
  const selectedRoles = {};
  for (const game of GAMES) {
    const checked = document.querySelector(`input[name="role-${game.id}"]:checked`);
    if (checked && checked.value) selectedRoles[game.id] = checked.value;
  }
  setBusy('settings', true);
  clearActionError();
  setLive('正在保存设置…');
  try {
    await post('/api/settings', { selectedRoles, intervalMinutes: Number(text) }, 20000);
    draftDirty = false;
    draftSelected = {};
    setLive('');
    render();
  } catch (error) {
    showActionError(error, 'settings');
    setLive('保存未完成。');
  } finally {
    setBusy('settings', false);
  }
}

async function refreshNote(gameId) {
  const game = gameById(gameId);
  if (!game || busy.has(`note:${game.id}`)) return;
  setBusy(`note:${game.id}`, true);
  clearActionError();
  setLive(`正在刷新${game.name}…`);
  try {
    await post('/api/notes/refresh', { game: game.id }, 90000);
    const note = model.notes && model.notes[game.id];
    if (note && note.status === 'error') setLive(`${game.name}这一次的结果是失败，详情在该卡片上。`);
    else setLive('');
  } catch (error) {
    showActionError(error, 'note', game.id);
    setLive(`${game.name}刷新未完成。`);
  } finally {
    setBusy(`note:${game.id}`, false);
  }
}

async function removeAccount() {
  if (busy.has('remove')) return;
  const ok = await confirmDialog({
    title: '清除本机保存的账号？',
    body: '清除本机保存的账号、角色与缓存数据。',
    confirmLabel: '确认清除',
    danger: true,
  });
  if (!ok) return;
  setBusy('remove', true);
  clearActionError();
  setLive('正在清除本机账号…');
  try {
    await post('/api/account/remove', {}, 20000);
    draftDirty = false;
    draftSelected = {};
    pollPaused = true;
    clearTimeout(pollTimer);
    pollTimer = 0;
    setLive('');
    render();
  } catch (error) {
    showActionError(error, 'remove');
    setLive('清除未完成。');
  } finally {
    setBusy('remove', false);
  }
}

function confirmDialog({ title, body, confirmLabel, danger }) {
  return new Promise((resolve) => {
    if (confirmResolve) {
      resolve(false);
      return;
    }
    confirmResolve = resolve;
    $('modal-title').textContent = title;
    $('modal-body').textContent = body;
    const ok = $('modal-ok');
    ok.textContent = confirmLabel;
    ok.className = danger ? 'btn danger' : 'btn primary';
    $('modal').hidden = false;
    $('modal-cancel').focus();
  });
}

function closeConfirm(result) {
  $('modal').hidden = true;
  const resolve = confirmResolve;
  confirmResolve = null;
  if (resolve) resolve(result);
}

function clearActionError() {
  actionError = null;
  lastRetry = null;
  renderActionError();
}

function showActionError(error, action, extra) {
  actionError = normalizeError(error);
  lastRetry = action ? { action, extra } : null;
  renderActionError();
}

function renderActionError() {
  const box = $('action-error');
  const body = $('action-error-body');
  const retry = $('action-retry');
  if (!box || !body || !retry) return;
  if (!actionError) {
    box.hidden = true;
    clear(body);
    retry.hidden = true;
    return;
  }
  box.hidden = false;
  clear(body);
  body.append(
    el('p', null, textOf(actionError.message)),
    el('p', 'error-meta', `阶段 ${textOf(actionError.stage)} · 代码 ${textOf(actionError.code)}`),
  );
  retry.hidden = !lastRetry;
}

function retryLast() {
  if (!lastRetry) return;
  const job = lastRetry;
  if (job.action === 'note') refreshNote(job.extra);
  else if (job.action === 'state') loadState();
  else if (job.action === 'qr') onCreateQr();
  else if (job.action === 'poll') onManualPoll();
  else if (job.action === 'complete') completeAuth();
  else if (job.action === 'roles') loadRoles();
  else if (job.action === 'settings') saveSettings();
  else if (job.action === 'background' && job.extra && job.extra.value) saveBackground(job.extra.page, job.extra.mode, job.extra.value);
  else if (job.action === 'remove') removeAccount();
}

function setPill(node, kind, text) {
  node.classList.remove('is-ok', 'is-bad', 'is-wait');
  node.classList.add(kind);
  node.textContent = text;
}

function renderConnection() {
  const waiting = !lastSyncAt && !connError;
  const kind = waiting ? 'is-wait' : (connOk ? 'is-ok' : 'is-bad');
  const label = waiting ? '正在读取状态' : (connOk ? '已连接本机服务' : '暂时连不上本机服务');
  setPill($('hero-status'), kind, label);
  $('hero-sync').textContent = lastSyncAt ? `本页收到状态：${formatTime(lastSyncAt)}` : '尚未收到状态';
  const upstream = model.upstream || {};
  $('footer-commit').textContent = upstream.commit ? String(upstream.commit) : '尚未读取';
}

function tokenNote(version) {
  if (version === 'v2') return '已登录，可正常取数。';
  if (version === 'other') return '登录信息不完整，请重新扫码。';
  return '';
}

function renderAccount() {
  const body = $('account-body');
  clear(body);
  const account = model.account;
  if (!account) {
    body.append(el('p', 'hint', '还没有账号，请先扫码登录。'));
  } else {
    const version = account.tokenVersion == null || account.tokenVersion === '' ? '未知' : String(account.tokenVersion);
    const list = el('dl', 'kv');
    const rows = [
      ['账号 ID', textOf(account.id)],
      ['令牌版本', version],
      ['设备指纹', account.deviceReady ? '已就绪' : '未就绪'],
      ['保存时间', formatTime(account.savedAt)],
    ];
    for (const [label, value] of rows) {
      const row = el('div');
      row.append(el('dt', null, label), el('dd', label === '账号 ID' ? 'mono' : null, value));
      list.append(row);
    }
    body.append(list, el('p', 'fine', tokenNote(account.tokenVersion)));
    if (!account.deviceReady) body.append(el('p', 'fine', '设备指纹未就绪，卡片可能无法刷新。'));
  }
  const remove = $('btn-remove');
  remove.disabled = busy.has('remove');
  remove.textContent = busy.has('remove') ? '正在清除…' : '清除本机账号';
}

function renderQr() {
  const qr = model.qr;
  const complete = needsComplete();
  const polling = canPoll();
  $('btn-qr').hidden = !!qr;
  $('btn-qr-restart').hidden = !qr;
  $('btn-poll').hidden = !polling;
  $('btn-complete').hidden = !complete;
  $('btn-qr').disabled = busy.has('qr') || busy.has('poll');
  $('btn-qr-restart').disabled = busy.has('qr') || busy.has('poll');
  $('btn-poll').disabled = busy.has('poll') || busy.has('qr') || busy.has('complete');
  $('btn-complete').disabled = busy.has('complete') || busy.has('poll');
  $('btn-qr').textContent = busy.has('qr') ? '正在生成…' : '生成登录二维码';
  $('btn-qr-restart').textContent = busy.has('qr') ? '正在生成…' : '重新生成二维码';
  $('btn-poll').textContent = busy.has('poll') ? '正在查询…' : '查询扫码状态';
  $('btn-complete').textContent = busy.has('complete') ? '正在继续认证…' : '继续认证';

  const frame = $('qr-frame');
  const image = $('qr-image');
  const uri = qr ? svgDataUri(qr.svg) : '';
  if (!uri) {
    frame.hidden = true;
    image.removeAttribute('src');
    lastSvg = '';
  } else if (qr.svg !== lastSvg) {
    lastSvg = qr.svg;
    image.src = uri;
    frame.hidden = false;
  } else {
    frame.hidden = false;
  }

  const labels = {
    Created: '等待扫码',
    Scanned: '已扫码，等待手机确认',
    Confirmed: '已确认',
    error: '出错',
  };
  if (busy.has('poll')) $('qr-status').textContent = '正在查询这张二维码…';
  else if (!qr) $('qr-status').textContent = '尚未开始';
  else $('qr-status').textContent = `${labels[qr.status] || '状态'} · 原值 ${textOf(qr.status)}`;

  let lead = '点按钮生成二维码。';
  let note = '自动查询约每 3 秒一次。';
  if (complete) {
    lead = '扫码已确认，还差令牌或设备指纹。点「继续认证」。';
    note = '继续认证只补做未完成的步骤。';
  } else if (qr && isQueryStage(qr.error)) {
    lead = '二维码还在，查询出错可再查同一张。';
    note = '自动查询已暂停，点「查询扫码状态」继续。';
  } else if (qr && shouldAutoPoll(qr) && !pollPaused) {
    lead = qr.status === 'Scanned'
      ? '手机已扫码，请在米游社 App 里确认。'
      : '请用米游社 App 扫描上面的二维码。';
    note = '约每 3 秒自动查询一次。';
  } else if (qr && qr.status === 'Confirmed') {
    lead = '最近一次扫码已确认。';
  } else if (qr && pollPaused) {
    lead = '自动查询已暂停，可手动再查。';
  }
  $('qr-lead').textContent = lead;
  $('qr-note').textContent = note;
  const errorBox = $('qr-error');
  if (qr && qr.error) {
    errorBox.hidden = false;
    clear(errorBox);
    errorBox.append(
      el('p', null, textOf(qr.error.message)),
      el('p', 'error-meta', `阶段 ${textOf(qr.error.stage)} · 代码 ${textOf(qr.error.code)}`),
    );
  } else {
    errorBox.hidden = true;
    clear(errorBox);
  }
}

function renderRoles() {
  const signature = JSON.stringify({
    roles: model.roles,
    roleErrors: model.roleErrors,
    selected: selectedMap(),
  });
  const grid = $('role-grid');
  if (signature !== roleSignature) {
    roleSignature = signature;
    clear(grid);
    const chosen = selectedMap();
    for (const game of GAMES) {
      const roles = model.roles.filter((role) => role && role.game === game.id);
      const card = el('article', 'card game-card');
      const head = el('header', 'role-top');
      const title = el('div');
      title.append(el('span', 'code-badge', game.code), el('h3', null, game.name));
      head.append(title);
      card.append(head);
      const failure = model.roleErrors && model.roleErrors[game.id];
      if (failure) {
        const alert = el('div', 'alert');
        alert.append(
          el('p', null, textOf(failure.message)),
          el('p', 'error-meta', `阶段 ${textOf(failure.stage)} · 代码 ${textOf(failure.code)}`),
        );
        card.append(alert);
      }
      if (!roles.length) {
        card.append(el('p', 'hint', failure
          ? '没有拿到玩家 ID。'
          : '登录后可以获取绑定角色。'));
      }
      for (const role of roles) {
        const label = el('label', 'role');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `role-${game.id}`;
        input.value = String(role.id);
        input.checked = chosen[game.id] === role.id;
        const copy = el('span', 'role-copy');
        const name = el('span', null, role.nickname || '未命名');
        const bits = [`UID ${textOf(role.uid)}`];
        if (role.regionName) bits.push(String(role.regionName));
        if (role.server) bits.push(String(role.server));
        if (role.level != null && role.level !== '') bits.push(`等级 ${role.level}`);
        copy.append(name, el('span', 'fine', bits.join(' · ')));
        label.append(input, copy);
        if (role.isChosen) label.append(el('span', 'pill', '列表当前角色'));
        card.append(label);
      }
      if (chosen[game.id] && !roles.some((role) => role.id === chosen[game.id])) {
        card.append(el('p', 'fine', '当前保存的选择已不在这个游戏的角色列表里。请重新选择后再保存。'));
      }
      if (roles.some((role) => role.isChosen)) {
        card.append(el('p', 'footnote', '「列表当前角色」是接口返回的标记。'));
      }
      grid.append(card);
    }
  }
  const save = $('btn-save');
  const rolesButton = $('btn-roles');
  save.disabled = busy.has('settings');
  rolesButton.disabled = busy.has('roles');
  save.textContent = busy.has('settings') ? '正在保存…' : '保存选择与间隔';
  rolesButton.textContent = busy.has('roles') ? '正在获取角色…' : '获取绑定角色';
  renderSettingsMeta();
}

function renderSettingsMeta() {
  const dirty = $('settings-dirty');
  const saved = $('interval-saved');
  if (!dirty || !saved) return;
  dirty.hidden = !draftDirty;
  const minutes = model.settings && model.settings.intervalMinutes;
  saved.textContent = Number.isInteger(minutes) ? `已保存的间隔：${minutes} 分钟。` : '还没有读到已保存的间隔。';
  const input = $('interval');
  if (!draftDirty && document.activeElement !== input && Number.isInteger(minutes)) input.value = String(minutes);
}

function sourceLabel(source) {
  if (source === 'full') return '完整接口';
  if (source === 'widget') return '风控降级';
  return textOf(source);
}

function renderNotes() {
  const grid = $('note-grid');
  clear(grid);
  for (const game of GAMES) {
    const note = model.notes && model.notes[game.id];
    const status = note && note.status;
    const card = el('article', `card game-card${status === 'error' ? ' is-error' : ''}${status === 'ok' ? ' is-ok' : ''}`);
    const head = el('header', 'note-top');
    const title = el('div');
    title.append(el('span', 'code-badge', game.code), el('h3', null, game.name));
    const badges = el('div', 'badge-row');
    if (status === 'ok') badges.append(el('span', 'pill is-ok', '已取得'));
    else if (status === 'error') badges.append(el('span', 'pill is-error', '失败'));
    else badges.append(el('span', 'pill', '尚无数据'));
    if (note && note.source) badges.append(el('span', 'pill', sourceLabel(note.source)));
    head.append(title, badges);
    card.append(head);
    if (note) {
      const bits = [];
      if (note.updatedAt) bits.push(`更新于 ${formatTime(note.updatedAt)}`);
      if (note.roleId) bits.push(`记录角色 ${note.roleId}`);
      if (bits.length) card.append(el('p', 'fine', bits.join(' · ')));
    }
    if (note && note.error) {
      const alert = el('div', 'alert');
      alert.append(
        el('p', null, textOf(note.error.message)),
        el('p', 'error-meta', `阶段 ${textOf(note.error.stage)} · 代码 ${textOf(note.error.code)}`),
      );
      card.append(alert);
    }
    const summary = note && Array.isArray(note.summary) ? note.summary : [];
    if (summary.length) {
      const gridList = el('div', 'summary');
      for (const item of summary) {
        if (!item || typeof item !== 'object') continue;
        const cell = el('div');
        cell.append(el('dt', null, textOf(item.label)), el('dd', null, showValue(item.value)));
        gridList.append(cell);
      }
      card.append(gridList);
    } else if (status === 'ok') {
      card.append(el('p', 'hint', '没有可展示的字段。'));
    } else if (status !== 'error') {
      card.append(el('p', 'hint', '还没有数据，选好角色后可手动刷新。'));
    }
    const attempts = note && Array.isArray(note.attempts) ? note.attempts : [];
    if (attempts.length) {
      const list = el('ul', 'attempts');
      for (const attempt of attempts) {
        if (!attempt || typeof attempt !== 'object') continue;
        const parts = [sourceLabel(attempt.source), `代码 ${textOf(attempt.code)}`];
        if (attempt.stage) parts.push(`阶段 ${attempt.stage}`);
        parts.push(textOf(attempt.message));
        list.append(el('li', null, parts.join(' · ')));
      }
      card.append(list);
    }
    const footnote = el('p', note && note.source === 'widget' ? 'footnote is-widget' : 'footnote');
    if (note && note.source === 'widget') {
      footnote.textContent = '完整接口失败，已风控降级。该接口不带玩家 ID，跟随默认角色，可能是别人。';
    } else if (note && note.source === 'full') {
      footnote.textContent = '这次走了完整接口。';
    }
    card.append(footnote);
    const button = el('button', 'btn', busy.has(`note:${game.id}`) ? '正在刷新…' : '手动刷新');
    button.type = 'button';
    button.setAttribute('data-refresh', game.id);
    button.disabled = busy.has(`note:${game.id}`);
    const actions = el('div', 'actions');
    actions.append(button);
    card.append(actions);
    grid.append(card);
  }
}

function renderEvents() {
  const list = $('event-list');
  clear(list);
  const events = Array.isArray(model.events) ? model.events : [];
  if (!events.length) {
    list.append(el('li', 'placeholder', '还没有阶段事件。'));
    return;
  }
  for (const event of [...events].reverse()) {
    const item = el('li');
    const time = el('time', null, formatTime(event && event.at));
    if (event && event.at) time.dateTime = String(event.at);
    item.append(
      time,
      el('strong', null, `阶段 ${textOf(event && event.stage)} · 代码 ${textOf(event && event.code)}`),
      el('p', 'fine', textOf(event && event.message)),
    );
    list.append(item);
  }
}

function render() {
  if (!$('hero-status')) return;
  renderConnection();
  renderAccount();
  renderQr();
  renderRoles();
  renderNotes();
  renderBackgrounds();
  renderEvents();
  renderActionError();
  document.body.setAttribute('aria-busy', busy.size ? 'true' : 'false');
  armPollTimer();
  ensureStateLoop();
}


const BACKGROUND_ITEMS = [
  { id: 'home', name: '首页', hint: '默认：三张角色图随机' },
  { id: 'genshin', name: '原神', hint: '默认：原神角色图' },
  { id: 'hsr', name: '星穹铁道', hint: '默认：星穹铁道角色图' },
  { id: 'zzz', name: '绝区零', hint: '默认：绝区零角色图' },
];
const BACKGROUND_DEFAULT_MODES = { home: 'default', genshin: 'default', hsr: 'default', zzz: 'default' };
const MAX_BACKGROUND_SHARP = 180 * 1024;
const MAX_BACKGROUND_BLUR = 30 * 1024;
const backgroundCache = {};
const backgroundLoading = new Set();
const backgroundBusy = new Set();

function backgroundModes() {
  const saved = model.settings && model.settings.backgrounds;
  return { ...BACKGROUND_DEFAULT_MODES, ...(saved && typeof saved === 'object' ? saved : {}) };
}

function backgroundRow(page) {
  return document.querySelector(`[data-bg-row="${page}"]`);
}

function renderBackgrounds() {
  const grid = $('background-grid');
  if (!grid) return;
  if (grid.querySelector('.placeholder')) clear(grid);
  if (!grid.children.length) {
    for (const item of BACKGROUND_ITEMS) {
      const row = el('div', 'background-row');
      row.setAttribute('data-bg-row', item.id);
      const copy = el('div', 'bg-copy');
      copy.append(el('strong', null, item.name), el('span', 'fine', item.hint));
      const actions = el('div', 'bg-actions');
      const thumb = document.createElement('img');
      thumb.className = 'bg-thumb';
      thumb.alt = `${item.name}自定义背景`;
      thumb.hidden = true;
      thumb.setAttribute('data-bg-thumb', item.id);
      const upload = el('button', 'btn bg-upload', '更换图片');
      upload.type = 'button';
      upload.setAttribute('data-bg-upload', item.id);
      upload.hidden = true;
      const select = document.createElement('select');
      select.className = 'bg-mode';
      select.setAttribute('data-bg-page', item.id);
      select.setAttribute('aria-label', `${item.name}背景`);
      select.append(new Option('默认', 'default'), new Option('自定义', 'custom'));
      const file = document.createElement('input');
      file.type = 'file';
      file.className = 'bg-file';
      file.hidden = true;
      file.accept = 'image/jpeg,image/png,image/webp';
      file.setAttribute('data-bg-file', item.id);
      actions.append(thumb, upload, select, file);
      row.append(copy, actions);
      grid.append(row);
    }
  }
  const modes = backgroundModes();
  for (const item of BACKGROUND_ITEMS) {
    const row = backgroundRow(item.id);
    if (!row) continue;
    const mode = modes[item.id] === 'custom' ? 'custom' : 'default';
    const select = row.querySelector('select');
    const thumb = row.querySelector('img');
    const upload = row.querySelector('button[data-bg-upload]');
    const hint = row.querySelector('.bg-copy .fine');
    const cached = backgroundCache[item.id];
    if (hint) hint.textContent = mode === 'custom' ? '当前：自定义背景' : item.hint;
    if (document.activeElement !== select) select.value = mode;
    select.disabled = backgroundBusy.has(item.id);
    upload.disabled = backgroundBusy.has(item.id);
    const showCustom = mode === 'custom' && cached && cached.custom;
    thumb.hidden = !showCustom;
    if (showCustom && thumb.src !== cached.custom) thumb.src = cached.custom;
    upload.hidden = mode !== 'custom';
    if (mode === 'custom' && !cached && !backgroundLoading.has(item.id)) loadBackgroundInfo(item.id);
  }
}

async function loadBackgroundInfo(page) {
  backgroundLoading.add(page);
  try {
    const payload = await fetchJson('GET', `/api/background/${page}`, undefined, 15000);
    if (payload && payload.value) backgroundCache[page] = payload.value;
  } catch (_) { /* missing custom image is not fatal */ }
  finally {
    backgroundLoading.delete(page);
    renderBackgrounds();
  }
}

let canvasFilterSupport = null;
function canFilterCanvas() {
  if (canvasFilterSupport !== null) return canvasFilterSupport;
  try {
    const test = document.createElement('canvas');
    const ctx = test.getContext('2d');
    ctx.filter = 'blur(1px)';
    canvasFilterSupport = ctx.filter === 'blur(1px)';
  } catch (_) { canvasFilterSupport = false; }
  return canvasFilterSupport;
}

function backgroundBlur(canvas, outW, outH) {
  const blur = document.createElement('canvas');
  blur.width = outW;
  blur.height = outH;
  const bctx = blur.getContext('2d');
  if (!bctx) throw new Error('浏览器不支持图片压缩。');
  if (canFilterCanvas()) {
    bctx.filter = 'blur(16px) saturate(1.2)';
    bctx.drawImage(canvas, 0, 0);
    bctx.filter = 'none';
  } else {
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(outW / 10));
    small.height = Math.max(1, Math.round(outH / 10));
    const sctx = small.getContext('2d');
    if (!sctx) throw new Error('浏览器不支持图片压缩。');
    sctx.drawImage(canvas, 0, 0, small.width, small.height);
    bctx.drawImage(small, 0, 0, outW, outH);
  }
  let quality = 0.62;
  let url = blur.toDataURL('image/jpeg', quality);
  while (url.length > MAX_BACKGROUND_BLUR && quality > 0.4) {
    quality -= 0.06;
    url = blur.toDataURL('image/jpeg', quality);
  }
  return url;
}

function prepareBackgroundFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || '')) { reject(new Error('请选择图片文件。')); return; }
    if (file.size > 25 * 1024 * 1024) { reject(new Error('图片超过 25MB，请换一张。')); return; }
    const image = new Image();
    image.onload = () => {
      try {
        const aspect = 912 / 596;
        const iw = image.naturalWidth || image.width;
        const ih = image.naturalHeight || image.height;
        if (!iw || !ih) throw new Error('无法读取图片尺寸。');
        let cropW;
        let cropH;
        if (iw / ih > aspect) { cropH = ih; cropW = ih * aspect; }
        else { cropW = iw; cropH = iw / aspect; }
        const scale = Math.min(1, 912 / cropW, 596 / cropH);
        const outW = Math.max(1, Math.round(cropW * scale));
        const outH = Math.max(1, Math.round(cropH * scale));
        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('浏览器不支持图片压缩。');
        ctx.fillStyle = '#0b1018';
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(image, (iw - cropW) / 2, (ih - cropH) / 2, cropW, cropH, 0, 0, outW, outH);
        let quality = 0.82;
        let custom = canvas.toDataURL('image/jpeg', quality);
        while (custom.length > MAX_BACKGROUND_SHARP && quality > 0.4) {
          quality -= 0.08;
          custom = canvas.toDataURL('image/jpeg', quality);
        }
        if (custom.length > MAX_BACKGROUND_SHARP) throw new Error('图片压缩后仍然过大，请换一张。');
        const customBlur = backgroundBlur(canvas, outW, outH);
        if (!customBlur || customBlur.length > MAX_BACKGROUND_BLUR) throw new Error('模糊背板生成失败。');
        resolve({ custom, customBlur, width: outW, height: outH });
      } catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error('图片无法解码，请换一张。'));
    const reader = new FileReader();
    reader.onload = () => { image.src = String(reader.result); };
    reader.onerror = () => reject(new Error('图片无法读取。'));
    reader.readAsDataURL(file);
  });
}

async function saveBackground(page, mode, value) {
  if (backgroundBusy.has(page)) return;
  backgroundBusy.add(page);
  renderBackgrounds();
  setLive(mode === 'custom' ? '正在保存自定义背景…' : '正在恢复默认背景…');
  try {
    const body = { page, mode, ...(value || {}) };
    await post('/api/background', body, 30000);
    if (mode === 'custom' && value) backgroundCache[page] = value;
    else delete backgroundCache[page];
    setLive('背景已保存。');
    if (typeof bridge !== 'undefined' && bridge.card && typeof bridge.card.requestRefresh === 'function') {
      try { bridge.card.requestRefresh(); } catch (_) { /* repaint is best-effort */ }
    }
  } catch (error) {
    showActionError(error, 'background', { page, mode, value: mode === 'custom' ? value : null });
    setLive('背景保存未完成。');
  } finally {
    backgroundBusy.delete(page);
    renderBackgrounds();
  }
}

async function onBackgroundChange(event) {
  const target = event.target;
  if (!target) return;
  if (target.matches('select[data-bg-page]')) {
    const page = target.getAttribute('data-bg-page');
    if (target.value === 'default') {
      await saveBackground(page, 'default');
      return;
    }
    const current = backgroundModes()[page] === 'custom' ? 'custom' : 'default';
    target.value = current;
    const file = backgroundRow(page) && backgroundRow(page).querySelector('input[data-bg-file]');
    if (file) file.click();
    return;
  }
  if (target.matches('input[data-bg-file]')) {
    const page = target.getAttribute('data-bg-file');
    const file = target.files && target.files[0];
    target.value = '';
    if (!file || backgroundBusy.has(page)) return;
    backgroundBusy.add(page);
    renderBackgrounds();
    setLive('正在按 912×596 裁切并生成模糊层…');
    try {
      const value = await prepareBackgroundFile(file);
      backgroundBusy.delete(page);
      await saveBackground(page, 'custom', value);
    } catch (error) {
      showActionError(error, 'background');
      setLive('自定义背景未保存。');
    } finally {
      backgroundBusy.delete(page);
      renderBackgrounds();
    }
  }
}

function onBackgroundClick(event) {
  const button = event.target && event.target.closest ? event.target.closest('button[data-bg-upload]') : null;
  if (!button) return;
  const row = button.closest('[data-bg-row]');
  const file = row && row.querySelector('input[data-bg-file]');
  if (file) file.click();
}

function onRoleChange(event) {
  const target = event.target;
  if (!target || !target.name || !String(target.name).startsWith('role-')) return;
  const selectedRoles = {};
  for (const game of GAMES) {
    const checked = document.querySelector(`input[name="role-${game.id}"]:checked`);
    if (checked && checked.value) selectedRoles[game.id] = checked.value;
  }
  draftSelected = selectedRoles;
  draftDirty = true;
  renderSettingsMeta();
}

function onNoteClick(event) {
  const button = event.target && event.target.closest ? event.target.closest('button[data-refresh]') : null;
  if (!button || !$('note-grid').contains(button)) return;
  refreshNote(button.getAttribute('data-refresh'));
}

function bind() {

  $('btn-qr').addEventListener('click', () => { onCreateQr(); });
  $('btn-qr-restart').addEventListener('click', () => { onCreateQr(); });
  $('btn-poll').addEventListener('click', () => { onManualPoll(); });
  $('btn-complete').addEventListener('click', () => { completeAuth(); });
  $('btn-remove').addEventListener('click', () => { removeAccount(); });
  $('btn-roles').addEventListener('click', () => { loadRoles(); });
  $('settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings();
  });
  $('interval').addEventListener('input', () => {
    if (!draftDirty) draftSelected = { ...selectedMap() };
    draftDirty = true;
    renderSettingsMeta();
  });
  $('role-grid').addEventListener('change', onRoleChange);
  const backgroundGrid = $('background-grid');
  if (backgroundGrid) {
    backgroundGrid.addEventListener('change', onBackgroundChange);
    backgroundGrid.addEventListener('click', onBackgroundClick);
  }
  $('note-grid').addEventListener('click', onNoteClick);
  $('action-retry').addEventListener('click', retryLast);
  $('modal-cancel').addEventListener('click', () => closeConfirm(false));
  $('modal-ok').addEventListener('click', () => closeConfirm(true));
  $('modal').addEventListener('click', (event) => {
    if (event.target === $('modal')) closeConfirm(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('modal').hidden) closeConfirm(false);
  });
  document.addEventListener('visibilitychange', onVisibility);
}

function init() {
  bind();
  render();
  loadState();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
