// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCardSnapshot, refreshTargets } from '../lib/card-state.mjs';
import { createPreviewProvider, createPreviewServer } from '../preview-server.mjs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const at = '2026-05-01T12:00:00Z';
function state() {
  return { account: { savedAt: at, cookie: 'SECRET_COOKIE', stoken: 'SECRET_STOKEN' }, csrf: 'SECRET_CSRF',
    settings: { selectedRoles: { genshin: 'g1', hsr: 'h1', zzz: 'z1' } }, roles: [ { id: 'g1', nickname: '旅人', uid: '1' }, { id: 'h1', nickname: '开拓者', uid: '2' } ],
    notes: {
      genshin: { roleId: 'g1', status: 'ok', source: 'full', updatedAt: at, data: { current_resin: 0, max_resin: 200, resin_recovery_time: '600', finished_task_num: 4, total_task_num: 4, is_extra_task_reward_received: false, transformer: { obtained: true, recovery_time: { Day: 0, reached: false } }, daily_task: { stored_attendance: '12', task_rewards: [{ status: 2 }] }, expeditions: [{ avatar_side_icon: 'https://image.invalid', status: 'Ongoing', remained_time: 20 }] } },
      hsr: { roleId: 'h1', status: 'ok', source: 'full', updatedAt: at, data: { current_stamina: 80, max_stamina: 300, current_train_score: 500, max_train_score: 500, current_reserve_stamina: 0, accepted_epedition_num: 0, total_expedition_num: 4, stamina_full_ts: 1780000000 } },
      zzz: { roleId: 'z1', status: 'ok', source: 'widget', updatedAt: at, data: { energy: { progress: { current: 40, max: 240 }, restore: 600 }, vitality: { current: 0, max: 400 }, card_sign: 'CardSignNo',
        note_list: [ { name: '录像店经营', value: '待结算', value_highlight: true }, { name: '悬赏委托', value: '8000/8000' } ],
        bounty_commission: { num: 8000, total: 8000 }, weekly_task: { cur_point: 1550, max_point: 2100 },
        temple_running: { auto_work: { is_auto_work_running: false }, current_currency: '0' }, coffee: null } },
    } };
}
test('card DTO preserves zero/unknown/rewards and maps all three note structures', () => {
  const snapshot = buildCardSnapshot(state());
  assert.equal(snapshot.games.genshin.primary.current, 0);
  assert.equal(snapshot.games.genshin.daily.reward, '奖励未领');
  assert.equal(snapshot.games.genshin.primary.recoveryAt, Date.parse(at) + 600000);
  assert.equal(snapshot.games.hsr.primary.recoveryAt, 1780000000000);
  assert.equal(snapshot.games.zzz.primary.current, 40); assert.equal(snapshot.games.zzz.daily.current, 0);
  assert.equal(snapshot.games.zzz.uid, null); assert.equal(snapshot.games.zzz.widgetDefaultRole, true);
  const encoded = JSON.stringify(snapshot);
  for (const forbidden of ['SECRET_', 'avatar_side_icon', 'https://image.invalid', 'sections']) assert.ok(!encoded.includes(forbidden));
  assert.ok(encoded.includes('长效历练点')); assert.ok(encoded.includes('随便观经营')); assert.ok(encoded.includes('未经营'));
  const zzzLabels = snapshot.games.zzz.list.map(row => row.label);
  assert.deepEqual(zzzLabels.filter(label => label === '悬赏委托'), ['悬赏委托']);
  assert.ok(zzzLabels.includes('今日签到') && zzzLabels.includes('丽都周纪积分'));
  assert.equal(snapshot.games.zzz.list.find(row => row.label === '今日签到').value, '未签到');
  assert.equal(snapshot.games.zzz.list.find(row => row.label === '录像店经营').value, '待结算');
});
test('snapshot preserves cached AOD backgrounds across refresh', () => {
  const previous = buildCardSnapshot(state());
  previous.backgrounds = { home: { custom: 'data:image/jpeg;base64,AA==', customBlur: null } };
  const next = buildCardSnapshot(state(), previous);
  assert.deepEqual(next.backgrounds, previous.backgrounds);
});
test('failed refresh retains same-account same-role values but never after logout/role change', () => {
  const s = state(), old = buildCardSnapshot(s);
  s.notes.genshin = { roleId: 'g1', status: 'error', updatedAt: at, error: { message: '验证失败' } };
  const failed = buildCardSnapshot(s, old);
  assert.equal(failed.games.genshin.status, 'error'); assert.equal(failed.games.genshin.primary.current, 0);
  assert.equal(failed.games.genshin.error, '验证失败');
  s.settings.selectedRoles.genshin = 'g2';
  assert.equal(buildCardSnapshot(s, failed).games.genshin.primary.current, null);
  s.account = null;
  assert.ok(Object.values(buildCardSnapshot(s, old).games).every(game => game.primary.current === null));
});
test('missing fields do not become false zero or complete', () => {
  const s = state(); s.notes.genshin.data = {};
  const g = buildCardSnapshot(s).games.genshin;
  assert.equal(g.primary.current, null); assert.equal(g.daily.current, null); assert.equal(g.daily.reward, '奖励未知');
  assert.deepEqual(refreshTargets('all'), ['genshin', 'hsr', 'zzz']);
  assert.deepEqual(refreshTargets('hsr'), ['hsr']); assert.throws(() => refreshTargets('other'));
});
test('preview uses existing authenticated host, targets only requested game, awaits safe file persistence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hoyo-card-test-'));
  const file = join(dir, 'snapshot.json');
  const s = state(), refreshed = [];
  const provider = createPreviewProvider({ snapshotFile: file, request: async (url, options) => {
    if (url.includes('/api/background/')) return { ok: true, json: async () => ({ value: null }) };
    if (options.method === 'POST') {
      assert.equal(options.headers['X-CSRF-Token'], 'SECRET_CSRF'); assert.equal(options.headers.Origin, 'http://127.0.0.1:18766');
      refreshed.push(JSON.parse(options.body).game);
    }
    return { ok: true, json: async () => s };
  } });
  const first = await provider.read(); assert.equal(first.games.hsr.status, 'ok');
  await provider.refresh('hsr'); assert.deepEqual(refreshed, ['hsr']);
  await provider.refresh('all'); assert.deepEqual(refreshed, ['hsr', 'genshin', 'hsr', 'zzz']);
  const saved = await readFile(file, 'utf8'); assert.ok(!saved.includes('SECRET_')); assert.deepEqual(JSON.parse(saved).games, first.games);
});
test('preview serves the three card backgrounds and allows data-url custom images', async t => {
  const server = createPreviewServer({
    read: async () => buildCardSnapshot(state()),
    refresh: async () => buildCardSnapshot(state()),
    background: async page => page === 'home' ? { custom: 'data:image/jpeg;base64,AA==', customBlur: 'data:image/jpeg;base64,AA==' } : null,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const game of ['genshin', 'hsr', 'zzz']) {
    for (const suffix of ['.jpg', '-blur.jpg']) {
      const response = await fetch(`${base}/assets/bg-${game}${suffix}`);
      assert.equal(response.status, 200, `${game}${suffix}`);
      assert.equal(response.headers.get('content-type'), 'image/jpeg');
      assert.ok((await response.arrayBuffer()).byteLength > 10000, `${game}${suffix}`);
    }
  }
  const page = await fetch(`${base}/`);
  assert.match(page.headers.get('content-security-policy'), /img-src 'self' data:/);
  const background = await (await fetch(`${base}/api/card/background/home`)).json();
  assert.equal(background.page, 'home');
  assert.equal(background.value.custom, 'data:image/jpeg;base64,AA==');
});
test('preview refresh rejects cross-origin/missing CSRF and never returns upstream secrets', async t => {
  let scopes = [];
  const server = createPreviewServer({ read: async () => buildCardSnapshot(state()), refresh: async scope => { scopes.push(scope); return buildCardSnapshot(state()); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const first = await fetch(`${base}/api/card/state`); const payload = await first.json();
  assert.ok(!JSON.stringify(payload).includes('SECRET_'));
  assert.equal((await fetch(`${base}/api/card/refresh`, { method: 'POST', body: '{}' })).status, 403);
  const headers = { Origin: base, 'X-CSRF-Token': payload.csrf, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${base}/api/card/refresh`, { method: 'POST', headers, body: JSON.stringify({ scope: 'zzz' }) })).status, 200);
  assert.deepEqual(scopes, ['zzz']);
  assert.equal((await fetch(`${base}/api/card/refresh`, { method: 'POST', headers, body: JSON.stringify({ scope: 'invalid' }) })).status, 400);
});
