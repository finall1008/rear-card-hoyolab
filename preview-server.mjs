// SPDX-License-Identifier: AGPL-3.0-or-later
// Development preview host only. Leaves the existing settings process/UI untouched.
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { buildCardSnapshot, refreshTargets } from './lib/card-state.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FILES = new Map([
  ['/', ['preview/index.html', 'text/html; charset=utf-8']],
  ['/preview.css', ['preview/style.css', 'text/css; charset=utf-8']],
  ['/preview.js', ['preview/app.js', 'text/javascript; charset=utf-8']],
  ['/card.js', ['card/card.js', 'text/javascript; charset=utf-8']],
  ['/source.tar.gz', ['dist/bridge/webroot/source.tar.gz', 'application/gzip']],
]);
export function createPreviewProvider({ upstream = 'http://127.0.0.1:18766', snapshotFile = resolve(ROOT, '.local/card-snapshot.json'), request = fetch } = {}) {
  const url = new URL(upstream);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Preview requires the local settings prototype');
  let previous = null, opened = false;
  let tail = Promise.resolve();
  async function getState() {
    const response = await request(`${url.origin}/api/state`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('设置原型状态读取失败');
    return response.json();
  }
  async function persist(state) {
    if (!opened) {
      try { previous = JSON.parse(await readFile(snapshotFile, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      opened = true;
    }
    const next = buildCardSnapshot(state, previous);
    await mkdir(dirname(snapshotFile), { recursive: true, mode: 0o700 });
    await writeFile(snapshotFile, JSON.stringify(next), { mode: 0o600 });
    previous = next;
    return next;
  }
  const enqueue = operation => {
    const next = tail.then(operation);
    tail = next.catch(() => {});
    return next;
  };
  return {
    read: () => enqueue(async () => persist(await getState())),
    refresh: scope => {
      const targets = refreshTargets(scope);
      return enqueue(async () => {
        for (const game of targets) {
          const state = await getState();
          if (!state.account || !state.settings?.selectedRoles?.[game]) continue;
          // The CSRF token stays in this server, never in the card DTO or preview storage.
          const response = await request(`${url.origin}/api/notes/refresh`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url.origin, 'X-CSRF-Token': state.csrf },
            body: JSON.stringify({ game }), signal: AbortSignal.timeout(75000),
          });
          if (!response.ok) throw new Error('设置原型未完成刷新，请在原设置页检查登录状态');
        }
        return persist(await getState());
      });
    },
  };
}
export function createPreviewServer(provider) {
  const csrf = randomBytes(24).toString('hex');
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    const port = server.address().port;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) return json(403, { error: '仅接受本地访问' });
    const path = new URL(req.url, `http://${req.headers.host}`).pathname;
    try {
      if (req.method === 'GET' && FILES.has(path)) {
        const [file, type] = FILES.get(path);
        const body = await readFile(resolve(ROOT, file));
        res.writeHead(200, { 'Content-Type': type }); return res.end(body);
      }
      if (req.method === 'GET' && path === '/api/card/state') return json(200, { snapshot: await provider.read(), csrf });
      if (req.method !== 'POST' || path !== '/api/card/refresh') return json(404, { error: '未找到页面' });
      if (req.headers.origin !== `http://${req.headers.host}`) return json(403, { error: '来源不匹配' });
      const token = Buffer.from(req.headers['x-csrf-token'] ?? '');
      if (token.length !== csrf.length || !timingSafeEqual(token, Buffer.from(csrf))) return json(403, { error: '请重新打开预览页' });
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 512) return json(413, { error: '请求过大' }); }
      let body;
      try { body = JSON.parse(raw); } catch { return json(400, { error: '请求格式错误' }); }
      if (!['all', 'genshin', 'hsr', 'zzz'].includes(body?.scope)) return json(400, { error: '未知刷新范围' });
      return json(200, { snapshot: await provider.refresh(body.scope), csrf });
    } catch {
      // Never echo an upstream response, account identifier or credentials.
      return json(503, { error: '暂时未能读取或保存数据；请确认原设置原型仍在运行。已有快照保留。' });
    }
  });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createPreviewServer(createPreviewProvider());
  server.listen(Number(process.env.PREVIEW_PORT ?? 18767), '127.0.0.1', () => console.log(`四页卡片预览 http://127.0.0.1:${server.address().port}\n沿用已有设置原型的真实数据；原设置页不变。`));
  server.on('error', error => { console.error(`预览启动失败：${error.code}`); process.exitCode = 1; });
}
