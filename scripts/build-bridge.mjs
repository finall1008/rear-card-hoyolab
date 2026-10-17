// SPDX-License-Identifier: AGPL-3.0-or-later
// Bridge artifact build. Reads the desktop prototype and writes a separate copy.
// Does not modify public/, lib/, or bridge/, and does not delete the output directory.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, copyFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SOURCE_MEMBERS = [
  'lib',
  'bridge',
  'card',
  'preview',
  'previews',
  'tools/card-build',
  '.github',
  'server.mjs',
  'preview-server.mjs',
  'CARD.md',
  'public',
  'scripts',
  'test',
  'package.json',
  'package-lock.json',
  'LICENSE',
  'NOTICE',
  'README.md',
  'BRIDGE.md',
  'UPSTREAM.md',
  'RELEASE.md',
  '.gitignore',
];

const SCHEDULER_NOTE = '后台刷新由卡片桥调度；请在桥的模块详情设置间隔。';

const browserBundle = {
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome90',
  // Unreachable statements are dropped only when syntax minification is on.
  // Identifier names stay intact. No Node polyfill is injected.
  minifySyntax: true,
  legalComments: 'none',
  charset: 'utf8',
  metafile: true,
};

// Confirmed by esbuild metafile inputs. encode-utf8, pngjs, yargs and esbuild are not inputs.
export const BROWSER_PACKAGES = ['@noble/hashes', 'dijkstrajs', 'qrcode'];

export async function bundleBrowser(options = {}) {
  return esbuild.build({
    absWorkingDir: root,
    logLevel: 'silent',
    ...options,
    ...browserBundle,
  });
}

function replaceOnce(source, from, to, label) {
  const index = source.indexOf(from);
  if (index < 0 || source.indexOf(from, index + from.length) !== -1) {
    throw new Error(`bridge copy transform failed: ${label}`);
  }
  return source.slice(0, index) + to + source.slice(index + from.length);
}

function relabel(source) {
  return source.replaceAll('本机服务', '卡片桥').replaceAll('本地服务', '卡片桥');
}

export function transformApp(source) {
  // Git checkouts on Windows may use CRLF; match the same build templates on both platforms.
  source = source.replace(/\r\n/g, '\n');
  let next = replaceOnce(
    source,
    'async function fetchJson(method, path, body, timeoutMs) {\n  const headers = { Accept: \'application/json\' };',
    'async function fetchJson(method, path, body, timeoutMs) {\n  return globalThis.hoyoRuntime.request(method, path, body);\n  const headers = { Accept: \'application/json\' };',
    'fetchJson',
  );
  next = replaceOnce(
    next,
    "  const text = $('interval').value.trim();\n  if (!/^-?\\d+(\\.\\d+)?$/.test(text)) {\n    showActionError({\n      detail: { stage: 'settings', code: 'INVALID_INTERVAL', message: '刷新间隔应为至少 5 分钟的整数。' },\n    }, 'settings');\n    return;\n  }\n  const selectedRoles = {};",
    '  const selectedRoles = {};',
    'interval validation',
  );
  next = replaceOnce(
    next,
    "await post('/api/settings', { selectedRoles, intervalMinutes: Number(text) }, 20000);",
    "await post('/api/settings', { selectedRoles }, 20000);",
    'settings body',
  );
  next = replaceOnce(
    next,
    "save.textContent = busy.has('settings') ? '正在保存…' : '保存选择与间隔';",
    "save.textContent = busy.has('settings') ? '正在保存…' : '保存选择';",
    'save label',
  );
  next = replaceOnce(
    next,
    `function renderSettingsMeta() {
  const dirty = $('settings-dirty');
  const saved = $('interval-saved');
  if (!dirty || !saved) return;
  dirty.hidden = !draftDirty;
  const minutes = model.settings && model.settings.intervalMinutes;
  saved.textContent = Number.isInteger(minutes) ? \`已保存的间隔：\${minutes} 分钟。\` : '还没有读到已保存的间隔。';
  const input = $('interval');
  if (!draftDirty && document.activeElement !== input && Number.isInteger(minutes)) input.value = String(minutes);
}`,
    `function renderSettingsMeta() {
  const dirty = $('settings-dirty');
  const saved = $('interval-saved');
  if (!dirty || !saved) return;
  dirty.hidden = !draftDirty;
  saved.textContent = '${SCHEDULER_NOTE}';
  const input = $('interval');
  if (input) input.disabled = true;
}`,
    'settings meta',
  );
  next = replaceOnce(
    next,
    'function init() {\n  bind();',
    "function init() {\n  const intervalInput = $('interval');\n  if (intervalInput) intervalInput.disabled = true;\n  bind();",
    'init',
  );
  next = relabel(next);
  if (next.includes('本机服务') || next.includes('本地服务')) {
    throw new Error('bridge app copy still names a local server');
  }
  if (!next.includes('return globalThis.hoyoRuntime.request(method, path, body);')) {
    throw new Error('bridge app copy does not call hoyoRuntime.request');
  }
  return next;
}

export function transformHtml(source) {
  let next = replaceOnce(
    source,
    '<link rel="stylesheet" href="/style.css">',
    '<link rel="stylesheet" href="./style.css">',
    'stylesheet',
  );
  next = replaceOnce(
    next,
    '<p>选角色，定刷新周期。</p>',
    `<p>选角色。${SCHEDULER_NOTE}</p>`,
    'interval intro',
  );
  next = replaceOnce(
    next,
    '<input id="interval" name="intervalMinutes" type="number" inputmode="numeric" min="5" step="1" value="15" autocomplete="off" spellcheck="false">',
    '<input id="interval" name="intervalMinutes" type="number" inputmode="numeric" min="5" step="1" value="15" autocomplete="off" spellcheck="false" disabled>',
    'interval input',
  );
  next = replaceOnce(
    next,
    '<button type="submit" class="btn primary" id="btn-save">保存选择与间隔</button>',
    '<button type="submit" class="btn primary" id="btn-save">保存选择</button>',
    'save button',
  );
  next = replaceOnce(
    next,
    '<p id="interval-saved" class="fine">已保存的间隔会在读到状态后显示。</p>',
    `<p id="interval-saved" class="fine">${SCHEDULER_NOTE}</p>`,
    'interval saved',
  );
  next = replaceOnce(
    next,
    '<a href="/source">下载源码包</a>',
    '<a id="source-link" href="./source.tar.gz">下载源码包</a>',
    'source link',
  );
  next = replaceOnce(
    next,
    '<script src="/app.js" defer></script>',
    "<script src='bridge-shim.js'></script>\n  <script src=\"./runtime.js\"></script>\n  <script src=\"./app.js\" defer></script>",
    'scripts',
  );
  next = relabel(next);
  const scripts = [...next.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
  if (scripts.join('\n') !== [
    "<script src='bridge-shim.js'>",
    '<script src="./runtime.js">',
    '<script src="./app.js" defer>',
  ].join('\n')) {
    throw new Error(`bridge html script order is ${scripts.join(' | ')}`);
  }
  if (next.includes('本机服务') || next.includes('本地服务') || next.includes('href="/style.css"') || next.includes('src="/app.js"') || next.includes('href="/source"')) {
    throw new Error('bridge html copy still points at the desktop server');
  }
  return next;
}

function writeSourceArchive(archivePath) {
  const missing = SOURCE_MEMBERS.filter((member) => !existsSync(path.join(root, member)));
  if (missing.length) throw new Error(`source archive is missing ${missing.join(', ')}`);
  execFileSync('tar', [
    '-czf', archivePath,
    '--exclude=.local',
    '--exclude=node_modules',
    '--exclude=.git',
    '--exclude=dist',
    '-C', root,
    ...SOURCE_MEMBERS,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}

const LICENSE_FILENAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'license.txt', 'LICENSE-MIT.txt'];

function bundledPackageNames(metafiles) {
  const names = new Set();
  for (const meta of metafiles) {
    if (!meta || !meta.inputs) throw new Error('browser bundle metadata is missing');
    for (const input of Object.keys(meta.inputs)) {
      const norm = input.split(path.sep).join('/');
      const marker = 'node_modules/';
      const at = norm.indexOf(marker);
      if (at < 0) continue;
      const parts = norm.slice(at + marker.length).split('/');
      names.add(parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]);
    }
  }
  return [...names].sort();
}

function readPackageLicense(pkgName) {
  const dir = path.join(root, 'node_modules', ...pkgName.split('/'));
  const entries = new Set(readdirSync(dir));
  const filename = LICENSE_FILENAMES.find((name) => entries.has(name));
  if (!filename) throw new Error(`bundled package ${pkgName} has no license file`);
  const text = readFileSync(path.join(dir, filename), 'utf8');
  if (!text.trim()) throw new Error(`bundled package ${pkgName} license file is empty`);
  const { version } = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  return { filename, version, text: text.endsWith('\n') ? text : `${text}\n` };
}

export function thirdPartyLicenses(metafiles) {
  const actual = bundledPackageNames(metafiles);
  const expected = [...BROWSER_PACKAGES].sort();
  if (actual.join('\n') !== expected.join('\n')) {
    throw new Error(`browser bundle dependencies are ${actual.join(', ') || '(none)'}; expected ${expected.join(', ')}`);
  }
  const parts = [
    'Third-party licenses redistributed in the browser bundles runtime.js and background/main.js.',
    'The packages below are exactly the node_modules inputs of those bundles.',
    'source.tar.gz excludes node_modules, so these full license texts are copied next to the bundles.',
    'This project is licensed under AGPL-3.0-or-later. See LICENSE and NOTICE in this directory.',
    '',
  ];
  for (const name of expected) {
    const license = readPackageLicense(name);
    parts.push(
      '================================================================================',
      `${name} ${license.version}`,
      `License file: node_modules/${name}/${license.filename}`,
      '================================================================================',
      license.text,
    );
  }
  return parts.join('\n');
}

function assertBundle(appJs) {
  if (!appJs.includes('hoyoRuntime.request')) throw new Error('app bundle dropped hoyoRuntime.request');
  if (/\bfetch\s*\(/.test(appJs)) throw new Error('app bundle still contains fetch(');
  if (appJs.includes('X-CSRF-Token')) throw new Error('app bundle still installs the CSRF header');
  if (/globalThis\.fetch\s*=/.test(appJs) || /window\.fetch\s*=/.test(appJs)) {
    throw new Error('app bundle monkeypatches fetch');
  }
  if (/intervalMinutes\s*:\s*Number/.test(appJs) || /selectedRoles\s*,\s*intervalMinutes/.test(appJs)) {
    throw new Error('app bundle still sends intervalMinutes');
  }
  if (!appJs.includes(SCHEDULER_NOTE)) throw new Error('app bundle missing scheduler explanation');
  if (!/\.disabled\s*=\s*(?:true|!0)/.test(appJs)) throw new Error('app bundle does not disable the interval input');
}

export async function buildBridge(outDir = 'dist') {
  const absOut = path.resolve(root, outDir);
  const webroot = path.join(absOut, 'bridge', 'webroot');
  const backgroundDir = path.join(absOut, 'bridge', 'background');
  mkdirSync(webroot, { recursive: true });
  mkdirSync(backgroundDir, { recursive: true });

  const runtimeBuild = await bundleBrowser({
    entryPoints: [path.join(root, 'bridge/entry.mjs')],
    outfile: path.join(webroot, 'runtime.js'),
  });
  const backgroundBuild = await bundleBrowser({
    entryPoints: [path.join(root, 'bridge/background.mjs')],
    outfile: path.join(backgroundDir, 'main.js'),
  });

  const appSource = transformApp(readFileSync(path.join(root, 'public/app.js'), 'utf8'));
  const appBuild = await bundleBrowser({
    stdin: {
      contents: appSource,
      resolveDir: path.join(root, 'public'),
      sourcefile: 'app.js',
      loader: 'js',
    },
    outfile: path.join(webroot, 'app.js'),
  });
  const appJs = readFileSync(path.join(webroot, 'app.js'), 'utf8');
  assertBundle(appJs);

  writeFileSync(path.join(webroot, 'index.html'), transformHtml(readFileSync(path.join(root, 'public/index.html'), 'utf8')));
  copyFileSync(path.join(root, 'public/style.css'), path.join(webroot, 'style.css'));
  const licenses = path.join(webroot, 'THIRD_PARTY_LICENSES.txt');
  writeFileSync(licenses, thirdPartyLicenses([runtimeBuild.metafile, backgroundBuild.metafile, appBuild.metafile]));
  const projectLicense = path.join(webroot, 'LICENSE');
  const projectNotice = path.join(webroot, 'NOTICE');
  copyFileSync(path.join(root, 'LICENSE'), projectLicense);
  copyFileSync(path.join(root, 'NOTICE'), projectNotice);
  writeSourceArchive(path.join(webroot, 'source.tar.gz'));

  return {
    outDir: absOut,
    webroot,
    runtime: path.join(webroot, 'runtime.js'),
    app: path.join(webroot, 'app.js'),
    html: path.join(webroot, 'index.html'),
    css: path.join(webroot, 'style.css'),
    licenses,
    projectLicense,
    projectNotice,
    archive: path.join(webroot, 'source.tar.gz'),
    background: path.join(backgroundDir, 'main.js'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildBridge().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
