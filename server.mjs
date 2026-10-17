// SPDX-License-Identifier: AGPL-3.0-or-later
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { SettingsService } from './lib/service.mjs';
import { FileStore } from './lib/store.mjs';
import { HoyoError, errorJSON } from './lib/hoyo.mjs';
import { MemoryBackgroundStore, MAX_BACKGROUND_BODY, validateBackgroundInput } from './lib/backgrounds.mjs';
import { FileBackgroundStore } from './lib/background-file.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
const SOURCE_FILES = ['package.json', 'package-lock.json', 'server.mjs', 'lib', 'bridge', 'card', 'preview', 'preview-server.mjs', 'CARD.md', 'public', 'scripts', 'test', 'README.md', 'BRIDGE.md', 'UPSTREAM.md', 'LICENSE', 'NOTICE', 'RELEASE.md', 'previews', 'tools/card-build', '.github', '.gitignore'];

export function createServer(service, backgrounds = new MemoryBackgroundStore()) {
  const csrf = randomBytes(32).toString('hex');
  let queue = Promise.resolve();
  let autoRefreshing = false;
  let lastAuto = Date.now();
  const state = () => ({ ...service.view(), csrf });
  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body));
  }
  const server = http.createServer(async (req, res) => {
    const address = server.address();
    const validHosts = [`127.0.0.1:${address.port}`, `localhost:${address.port}`];
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    if (!validHosts.includes(req.headers.host)) return json(res, 403, { error: { stage: 'http', code: 'HOST', message: '仅接受本地访问。' } });
    const path = new URL(req.url, `http://${req.headers.host}`).pathname;
    try {
      if (req.method === 'GET' && path === '/api/state') return json(res, 200, state());
      const backgroundPath = path.match(/^\/api\/background\/(home|genshin|hsr|zzz)$/);
      if (req.method === 'GET' && backgroundPath) return json(res, 200, { page: backgroundPath[1], value: backgrounds.get(backgroundPath[1]) });
      if (req.method === 'GET' && PUBLIC.has(path)) {
        const [file, type] = PUBLIC.get(path);
        const body = await readFile(resolve(ROOT, 'public', file));
        res.writeHead(200, { 'Content-Type': type }); return res.end(body);
      }
      if (req.method === 'GET' && path === '/source') {
        // Fixed source allowlist. Credential storage, .git and node_modules never enter archive.
        for (const file of SOURCE_FILES) await stat(resolve(ROOT, file));
        const archive = spawn('tar', ['-czf', '-', '--exclude=.local', '--exclude=node_modules', '--exclude=.git', '--exclude=dist', ...SOURCE_FILES], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
        res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="rear-card-hoyolab-source.tar.gz"' });
        archive.stdout.pipe(res);
        archive.on('error', () => res.destroy());
        archive.on('exit', code => { if (code !== 0) res.destroy(); });
        return;
      }
      if (req.method !== 'POST' || !path.startsWith('/api/')) return json(res, 404, { error: { stage: 'http', code: 'NOT_FOUND', message: '未找到接口。' } });
      if (req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: { stage: 'http', code: 'ORIGIN', message: '来源不匹配。' } });
      const token = Buffer.from(req.headers['x-csrf-token'] ?? '');
      if (token.length !== csrf.length || !timingSafeEqual(token, Buffer.from(csrf))) return json(res, 403, { error: { stage: 'http', code: 'CSRF', message: '请刷新设置页后重试。' } });
      let raw = '';
      const maxBody = path === '/api/background' || path === '/api/settings' ? MAX_BACKGROUND_BODY : 16384;
      for await (const chunk of req) { raw += chunk; if (raw.length > maxBody) throw new HoyoError('http', 'TOO_LARGE', '请求过大。'); }
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { throw new HoyoError('http', 'INVALID_JSON', '请求不是 JSON。'); }
      if (!body || Array.isArray(body) || typeof body !== 'object') throw new HoyoError('http', 'INVALID_BODY', '请求应为 JSON 对象。');
      const actions = {
        '/api/auth/qr': () => service.createQR(), '/api/auth/poll': () => service.poll(), '/api/auth/complete': () => service.complete(),
        '/api/account/roles': () => service.loadRoles(), '/api/settings': () => service.settings(body),
        '/api/background': () => {
          const validated = validateBackgroundInput(body);
          if (validated.mode === 'default') backgrounds.remove(validated.page);
          else backgrounds.set(validated.page, validated.value);
          return service.settings({ backgrounds: { [validated.page]: validated.mode } });
        },
        '/api/notes/refresh': () => service.refresh(body.game), '/api/account/remove': () => service.remove(),
      };
      if (!actions[path]) return json(res, 404, { error: { stage: 'http', code: 'NOT_FOUND', message: '未找到接口。' } });
      const operation = queue.then(actions[path]);
      queue = operation.catch(() => {});
      await operation;
      json(res, 200, state());
    } catch (error) {
      const safe = errorJSON(error, 'http');
      // Never log upstream request/response/cookie/token bodies.
      if (!(error instanceof HoyoError)) console.error(`[local] ${safe.stage} ${error?.code ?? error?.name ?? 'ERROR'}`);
      json(res, 400, { ...state(), error: safe });
    }
  });
  // Local prototype background refresh. Same controller queue as foreground mutations.
  const timer = setInterval(() => {
    const interval = service.db.settings.intervalMinutes * 60000;
    if (autoRefreshing || !service.db.account || Date.now() - lastAuto < interval) return;
    autoRefreshing = true; lastAuto = Date.now();
    const job = queue.then(async () => {
      for (const game of Object.keys(service.db.settings.selectedRoles)) {
        if (!service.db.account) break;
        await service.refresh(game);
      }
    });
    queue = job.catch(() => {});
    job.catch(error => service.event('background', errorJSON(error).code, '后台刷新失败')).finally(() => { autoRefreshing = false; });
  }, 10000);
  timer.unref();
  server.on('close', () => clearInterval(timer));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 18766);
  const store = new FileStore(resolve(ROOT, '.local/state.json'));
  const backgrounds = new FileBackgroundStore(resolve(ROOT, '.local/backgrounds.json'));
  const service = new SettingsService(store);
  const server = createServer(service, backgrounds);
  server.listen(port, '127.0.0.1', () => console.log(`米游社设置 http://127.0.0.1:${server.address().port}\n认证来源：The Latte Helper @ ${service.view().upstream.commit.slice(0, 8)}\n凭据保存在本仓库 .local/，不输出到网页或终端。`));
  server.on('error', error => { console.error(`启动失败：${error.code}`); process.exitCode = 1; });
}
