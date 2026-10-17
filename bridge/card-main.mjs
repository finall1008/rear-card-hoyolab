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

  var BACKGROUND_PAGES = ['home', 'genshin', 'hsr', 'zzz'];
  var REFRESH_TIMEOUT_MS = 30000;
  // Leave room for the card snapshot's data fields below the bridge's 512K limit.
  var SNAPSHOT_BACKGROUND_LIMIT = 460 * 1024;

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
    var cachedSnapshot = bridge.card.readSnapshot ? bridge.card.readSnapshot() : null;
    var loadedBackgrounds = {};
    if (cachedSnapshot && cachedSnapshot.backgrounds && typeof cachedSnapshot.backgrounds === 'object') {
      BACKGROUND_PAGES.forEach(function (page) {
        var value = cachedSnapshot.backgrounds[page];
        if (value && typeof value === 'object' && typeof value.custom === 'string' && value.custom) {
          loadedBackgrounds[page] = value;
        }
      });
    }
    var pendingBackgrounds = {};
    var currentPage = 0;
    var snapshotSaveChain = Promise.resolve();

    function pageKey(pageIndex) {
      return BACKGROUND_PAGES[pageIndex] || 'home';
    }

    // Read one page per bridge batch. The live carrier returns synchronous storage
    // results in one HostVar per batch; combining all four base64 backgrounds creates
    // a ~700K result that the carrier can drop, leaving the card on the default image
    // and stalling every later request.
    function readBackground(pageIndex) {
      var page = pageKey(pageIndex);
      return bridge.storage.get('hoyolab.background.' + page).then(function (value) {
        if (value) loadedBackgrounds[page] = value;
        else delete loadedBackgrounds[page];
        persistBackgrounds();
        return page;
      });
    }

    // The bridge's card snapshot is the only data path read synchronously before the
    // renderer's first frame. Keep a bounded set of backgrounds there so AOD recovery
    // can draw them before storage.get resolves.
    function snapshotBackgrounds() {
      var all = {};
      BACKGROUND_PAGES.forEach(function (page) {
        if (loadedBackgrounds[page]) all[page] = loadedBackgrounds[page];
      });
      if (JSON.stringify(all).length <= SNAPSHOT_BACKGROUND_LIMIT) return all;
      var current = pageKey(currentPage);
      var preferred = {};
      if (loadedBackgrounds.home) preferred.home = loadedBackgrounds.home;
      if (current !== 'home' && loadedBackgrounds[current]) preferred[current] = loadedBackgrounds[current];
      if (JSON.stringify(preferred).length <= SNAPSHOT_BACKGROUND_LIMIT) return preferred;
      var homeOnly = {};
      if (loadedBackgrounds.home) homeOnly.home = loadedBackgrounds.home;
      if (JSON.stringify(homeOnly).length <= SNAPSHOT_BACKGROUND_LIMIT) return homeOnly;
      return {};
    }

    function persistBackgrounds() {
      if (!bridge.card.saveSnapshot) return;
      snapshotSaveChain = snapshotSaveChain.then(function () {
        var base = bridge.card.readSnapshot() || {};
        var next = {};
        for (var key in base) {
          if (Object.prototype.hasOwnProperty.call(base, key)) next[key] = base[key];
        }
        var backgrounds = snapshotBackgrounds();
        if (Object.keys(backgrounds).length) next.backgrounds = backgrounds;
        else delete next.backgrounds;
        return bridge.card.saveSnapshot(next);
      }).catch(function (error) {
        fail('背景快照保存失败: ' + error);
      });
    }

    function refreshBackgrounds(pageIndex) {
      var page = pageKey(pageIndex);
      if (pendingBackgrounds[page]) return pendingBackgrounds[page];
      var request = readBackground(pageIndex).then(function () {
        controller.setBackgrounds(loadedBackgrounds);
      }).catch(function (error) {
        fail('背景读取失败: ' + error);
      });
      pendingBackgrounds[page] = request;
      request.then(function () {
        delete pendingBackgrounds[page];
      }, function () {
        delete pendingBackgrounds[page];
      });
      return request;
    }

    function refreshWithTimeout(promise, ms) {
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          reject(new Error('刷新超时，请检查网络后重试'));
        }, ms);
        promise.then(function (value) {
          clearTimeout(timer);
          resolve(value);
        }, function (error) {
          clearTimeout(timer);
          reject(error);
        });
      });
    }

    var controller = globalThis.HoyoCard.mount({
      canvas: canvas,
      initialSnapshot: provider.initialSnapshot,
      backgrounds: loadedBackgrounds,
      refresh: function (scope) {
        return refreshWithTimeout(provider.refresh(scope), REFRESH_TIMEOUT_MS).then(function (snapshot) {
          // Refresh only the page currently on screen. A full four-page read is the
          // failure mode this path is designed to avoid.
          refreshBackgrounds(currentPage);
          return snapshot;
        });
      },
      onPageChange: function (page) {
        currentPage = page;
        refreshBackgrounds(page);
      },
      onStatus: function () {},
    });
    try {
      var initialPage = controller.getState().page;
      if (typeof initialPage === 'number' && initialPage >= 0) currentPage = initialPage;
    } catch (_) { /* keep home */ }
    refreshBackgrounds(currentPage);
    if (currentPage !== 0 && !loadedBackgrounds.home) refreshBackgrounds(0);
    // 前台刷新或后台任务写入共享快照后，载体把 snapshotRev 同步进 localStorage；
    // 下一次 requestRefresh/刷新广播时重读即可。这里同时挂 onRefresh 兜底。
    if (typeof bridge.card.onRefresh === 'function') {
      bridge.card.onRefresh(function () {
        try {
          var next = bridge.card.readSnapshot();
          if (next) controller.setSnapshot(next);
          refreshBackgrounds(currentPage);
        } catch (error) {
          fail('快照重读失败: ' + error);
        }
      });
    }
  }

  main();
})();
