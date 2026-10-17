// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBridge, bundleBrowser, SOURCE_MEMBERS } from '../scripts/build-bridge.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEDULER_NOTE = '后台刷新由卡片桥调度；请在桥的模块详情设置间隔。';
const OWNED = ['public/app.js', 'public/index.html', 'public/style.css', 'lib/hoyo.mjs', 'lib/service.mjs', 'lib/store.mjs', 'bridge/entry.mjs', 'bridge/runtime.mjs', 'bridge/background.mjs'];

function ownedBytes() {
  return Object.fromEntries(OWNED.map((rel) => [rel, readFileSync(path.join(root, rel))]));
}

function tempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'rear-card-hoyolab-bridge-'));
  t.after(() => {
    const resolved = path.resolve(dir);
    if (resolved.startsWith(path.resolve(tmpdir())) && path.basename(resolved).startsWith('rear-card-hoyolab-bridge-')) {
      rmSync(resolved, { recursive: true });
    }
  });
  return dir;
}

test('browser bundle rejects Node imports and does not polyfill them', async (t) => {
  const dir = tempDir(t);
  for (const specifier of ["import 'node:fs';", "import 'fs';"]) {
    await assert.rejects(
      () => bundleBrowser({
        stdin: {
          contents: `${specifier}\nconsole.log('no-polyfill');\n`,
          resolveDir: dir,
          sourcefile: 'node-import.js',
          loader: 'js',
        },
        outfile: path.join(dir, 'rejected.js'),
      }),
      (error) => {
        const text = String(error);
        assert.match(text, /Could not resolve/);
        assert.doesNotMatch(text, /polyfill/i);
        return true;
      },
    );
  }
  assert.equal(existsSync(path.join(dir, 'rejected.js')), false);
});

test('buildBridge writes an offline bridge copy without touching the desktop prototype', async (t) => {
  const before = ownedBytes();
  const dir = tempDir(t);
  const built = await buildBridge(dir);
  for (const [rel, bytes] of Object.entries(before)) {
    assert.deepEqual(readFileSync(path.join(root, rel)), bytes, rel);
  }
  assert.equal(buildBridge.length, 0);
  assert.match(String(buildBridge), /outDir = 'dist'/);

  const app = readFileSync(built.app, 'utf8');
  const html = readFileSync(built.html, 'utf8');
  const css = readFileSync(built.css);
  const runtime = readFileSync(built.runtime, 'utf8');
  const background = readFileSync(built.background, 'utf8');

  assert.equal(existsSync(path.join(built.webroot, 'bridge-shim.js')), false);
  assert.deepEqual(css, before['public/style.css']);
  assert.equal(runtime.startsWith('(() => {'), true);
  assert.equal(background.startsWith('(() => {'), true);
  assert.match(runtime, /globalThis\.hoyoRuntime/);
  assert.match(background, /globalThis\.refresh/);
  assert.match(runtime, /node_modules\/@noble\/hashes\/legacy\.js/);
  assert.match(runtime, /1732584193/);
  assert.match(runtime, /node_modules\/qrcode\/lib\/browser\.js/);
  assert.match(runtime, /node_modules\/dijkstrajs\/dijkstra\.js/);
  assert.doesNotMatch(runtime, /node_modules\/(?:pngjs|yargs|esbuild|encode-utf8)/);
  assert.match(runtime, /svg/);

  const thirdParty = readFileSync(path.join(built.webroot, 'THIRD_PARTY_LICENSES.txt'), 'utf8');
  const projectLicense = readFileSync(path.join(built.webroot, 'LICENSE'));
  const projectNotice = readFileSync(path.join(built.webroot, 'NOTICE'));
  assert.deepEqual(projectLicense, readFileSync(path.join(root, 'LICENSE')));
  assert.deepEqual(projectNotice, readFileSync(path.join(root, 'NOTICE')));
  assert.match(projectLicense.toString('utf8'), /GNU AFFERO GENERAL PUBLIC LICENSE/);
  for (const pkg of ['@noble/hashes', 'dijkstrajs', 'qrcode']) assert.match(thirdParty, new RegExp(pkg.replace('/', '\\/')));
  assert.match(thirdParty, /Copyright \(c\) 2012 Ryan Day/);
  assert.match(thirdParty, /Copyright \(c\) 2022 Paul Miller/);
  assert.match(thirdParty, /Wyatt Baldwin/);
  assert.equal(thirdParty.split('THE SOFTWARE IS PROVIDED').length - 1, 3);
  assert.doesNotMatch(thirdParty, /pngjs|yargs|encode-utf8|\besbuild\b/);
  assert.match(thirdParty, /node_modules\/qrcode\/license/);
  assert.match(thirdParty, /node_modules\/@noble\/hashes\/LICENSE/);
  assert.match(thirdParty, /node_modules\/dijkstrajs\/LICENSE\.md/);
  for (const text of [app, html, css.toString('utf8'), runtime, background]) {
    assert.doesNotMatch(text, /unpkg\.com|jsdelivr|cdnjs|esm\.sh|skypack|cdn\.jsdelivr/);
    assert.doesNotMatch(text, /node:fs|node:path|node:crypto/);
    assert.doesNotMatch(text, /\brequire\s*\(/);
  }

  assert.match(app, /return globalThis\.hoyoRuntime\.request\(method, path, body\)/);
  assert.doesNotMatch(app, /\bfetch\s*\(/);
  assert.doesNotMatch(app, /X-CSRF-Token/);
  assert.doesNotMatch(app, /globalThis\.fetch\s*=|window\.fetch\s*=/);
  assert.match(app, /还没有拿到 CSRF/);
  assert.match(app, /await post\("\/api\/settings", \{ selectedRoles \}, 2e4\)/);
  assert.doesNotMatch(app, /intervalMinutes\s*:\s*Number|selectedRoles\s*,\s*intervalMinutes/);
  assert.match(app, /intervalInput && \(intervalInput\.disabled = !0\)/);
  assert.match(app, /input && \(input\.disabled = !0\)/);
  assert.match(app, new RegExp(SCHEDULER_NOTE));
  assert.doesNotMatch(app, /本机服务|本地服务/);
  assert.match(app, /已连接卡片桥/);
  assert.match(app, /该接口不带玩家 ID，跟随默认角色/);
  assert.match(app, /阶段 \$\{textOf\(actionError\.stage\)\}/);

  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
  assert.deepEqual(scripts, [
    "<script src='bridge-shim.js'>",
    '<script src="./runtime.js">',
    '<script src="./app.js" defer>',
  ]);
  assert.match(html, /href="\.\/style\.css"/);
  assert.doesNotMatch(html, /href="\/style\.css"|src="\/app\.js"|href="\/source"/);
  assert.match(html, /<a id="source-link" href="\.\/source\.tar\.gz">/);
  assert.match(html, /id="interval"[^>]*disabled>/);
  assert.match(html, new RegExp(SCHEDULER_NOTE));
  assert.match(html, /保存选择</);
  assert.match(html, /id="background-grid"/);
  assert.match(app, /\/api\/background/);
  assert.doesNotMatch(html, /保存选择与间隔|本机服务|本地服务/);
  assert.match(html, /id="note-grid"/);

  const names = execFileSync('tar', ['-tzf', built.archive], { encoding: 'utf8' }).trim().split(/\r?\n/);
  for (const member of SOURCE_MEMBERS) assert.ok(names.some((name) => name === member || name.startsWith(`${member}/`)), member);
  for (const name of names) {
    for (const part of name.split('/')) {
      assert.notEqual(part, 'node_modules');
      assert.notEqual(part, '.local');
      assert.notEqual(part, '.git');
      assert.notEqual(part, 'dist');
    }
  }
  const archivedApp = execFileSync('tar', ['-xOf', built.archive, 'public/app.js'], { encoding: 'utf8' });
  assert.match(archivedApp, /await fetch\(path/);
  assert.doesNotMatch(archivedApp, /hoyoRuntime/);
  assert.match(before['public/app.js'].toString('utf8'), /await fetch\(path/);
  assert.doesNotMatch(before['public/index.html'].toString('utf8'), /bridge-shim\.js|source\.tar\.gz/);
});
