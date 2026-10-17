/**
 * 背屏模块入口：与 tools/card-build 打包约定一致的经典脚本入口。
 * 宿主运行时以 (function(Promise){ ... }) 形式执行本文件，并把兼容的 Promise
 * 作为参数注入；文件内不得使用顶层 await，异步启动走 Promise 链。
 *
 * 注意：本文件经 esbuild 打包成 iife 后交给 card-build 编译 async→generator，
 * 因此这里可以正常写 async/await，但不要引入 ESM 语法残留到产物里。
 */
import '../card/card.js';
import '../card/home-assets.js';
import { bridgeCardProvider } from './card-provider.mjs';

(function () {
  'use strict';

  function fail(message) {
    if (typeof bridge !== 'undefined' && bridge.log) {
      try { bridge.log.error(message); return; } catch (_) { /* fallthrough */ }
    }
    try { console.log('[hoyolab] ' + message); } catch (_) { /* ignore */ }
  }

  function main() {
    var canvas = null;
    if (typeof document !== 'undefined') {
      canvas = document.getElementById('rear');
      // 活体载体的 canvas 名由目标卡片 id 映射而来；getElementById 兜底为唯一 canvas。
      if (!canvas && document.getElementsByTagName) {
        var list = document.getElementsByTagName('canvas');
        if (list && list.length) canvas = list[0];
      }
    }
    if (!canvas || !globalThis.HoyoCard || typeof globalThis.HoyoCard.mount !== 'function') {
      fail('卡片宿主缺少 canvas 或 HoyoCard，未挂载');
      return;
    }
    if (typeof bridge === 'undefined' || !bridge.card) {
      // 没有模块载体的桥时仍然挂载，显示空态而不是白屏。
      globalThis.HoyoCard.mount({
        canvas: canvas,
        initialSnapshot: null,
        refresh: function () { return null; },
        onStatus: function () {},
      });
      return;
    }
    var provider = bridgeCardProvider(bridge);
    var controller = globalThis.HoyoCard.mount({
      canvas: canvas,
      initialSnapshot: provider.initialSnapshot,
      refresh: provider.refresh,
      onStatus: function () {},
    });
    // 前台刷新或后台任务写入共享快照后，载体把 snapshotRev 同步进 localStorage；
    // 下一次 requestRefresh/刷新广播时重读即可。这里同时挂 onRefresh 兜底。
    if (typeof bridge.card.onRefresh === 'function') {
      bridge.card.onRefresh(function () {
        try {
          var next = bridge.card.readSnapshot();
          if (next) controller.setSnapshot(next);
        } catch (error) {
          fail('快照重读失败: ' + error);
        }
      });
    }
  }

  main();
})();
