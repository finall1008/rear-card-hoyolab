// SPDX-License-Identifier: AGPL-3.0-or-later
// 组装背屏卡片桥模块包 staging 目录（dist/module），随后由 card-build 打成安装 ZIP。
// 用法：node scripts/build-module.mjs [outDir]   默认 dist/module
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleBrowser } from './build-bridge.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(root, process.argv[2] || 'dist/module');
const bridgeDist = path.join(root, 'dist', 'bridge');

export const MODULE_MANIFEST = {
  id: 'dev.finall.hoyolab',
  name: '米游社',
  version: '0.1.4',
  versionCode: 5,
  apiVersion: 2,
  description: '米游社每日委托与体力卡片：首页三游戏并列，详情页左右两栏，支持下拉刷新与后台定时更新。',
  author: 'finall1008',
  capabilities: ['network', 'storage'],
  background: { intervalMinutes: 15 },
};

const CARD_INDEX_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <canvas id="rear" width="912" height="596"></canvas>
  <script src="main.js"></script>
</body>
</html>
`;

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.join(outDir, 'card'), { recursive: true });

  // 卡片脚本：preview 引擎 + bridge provider + 挂载入口 → 单个 iife 经典脚本，
  // 交给 card-build 把 async/await 编译为生成器（宿主注入兼容 Promise）。
  const result = await bundleBrowser({
    entryPoints: [path.join(root, 'bridge/card-main.mjs')],
    outfile: path.join(outDir, 'card', 'main.js'),
    write: false,
  });
  const file = result.outputFiles?.[0];
  if (!file) throw new Error('card main 打包无输出');
  writeFileSync(path.join(outDir, 'card', 'main.js'), file.contents);
  writeFileSync(path.join(outDir, 'card', 'index.html'), CARD_INDEX_HTML);
  // 角色背景是运行时通过 Image(src) 读取的静态文件；图标已由 home-assets.js 内嵌。
  mkdirSync(path.join(outDir, 'card', 'assets'), { recursive: true });
  for (const name of ['bg-genshin.jpg', 'bg-hsr.jpg', 'bg-zzz.jpg', 'bg-genshin-blur.jpg', 'bg-hsr-blur.jpg', 'bg-zzz-blur.jpg']) {
    copyFileSync(path.join(root, 'card', 'assets', name), path.join(outDir, 'card', 'assets', name));
  }
  writeFileSync(path.join(outDir, 'module.json'), JSON.stringify(MODULE_MANIFEST, null, 2) + '\n');

  // 设置页与后台刷新入口：直接复用 dist/bridge 产物（webroot 首脚本须为 bridge-shim.js）。
  const webroot = path.join(bridgeDist, 'webroot');
  const indexHtml = readFileSync(path.join(webroot, 'index.html'), 'utf8');
  const firstScript = indexHtml.match(/<script[^>]*src=["']([^"']+)["']/);
  if (!firstScript || !firstScript[1].endsWith('bridge-shim.js')) {
    throw new Error('webroot/index.html 第一个脚本必须是 bridge-shim.js');
  }
  cpSync(webroot, path.join(outDir, 'webroot'), { recursive: true });
  mkdirSync(path.join(outDir, 'background'), { recursive: true });
  copyFileSync(path.join(bridgeDist, 'background', 'main.js'), path.join(outDir, 'background', 'main.js'));

  console.log(`已组装模块源目录 ${outDir}`);
}

await main();
