// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  'use strict';
  var KEY = 'hoyolab.card.display.v1';
  var csrf = null;
  var activePage = 0;
  var busy = false;
  var initialSnapshot = null;
  try { initialSnapshot = JSON.parse(localStorage.getItem(KEY)); } catch (_) { /* first open or unavailable cache */ }
  var status = document.getElementById('status');
  var refreshButton = document.getElementById('refresh');
  var scopes = ['all', 'genshin', 'hsr', 'zzz'];
  var names = ['全部', '原神', '星穹铁道', '绝区零'];
  var card;
  function store(snapshot) {
    // The server has already awaited disk persistence. This is an additional first-frame cache.
    localStorage.setItem(KEY, JSON.stringify(snapshot));
    return snapshot;
  }
  async function read() {
    var response = await fetch('/api/card/state');
    var result = await response.json();
    if (!response.ok) throw new Error(result.error);
    csrf = result.csrf;
    // Server persistence is authoritative even if browser storage is unavailable.
    try { store(result.snapshot); } catch (_) { status.textContent = '浏览器缓存不可用；服务端快照已保存。'; }
    return result.snapshot;
  }
  async function refresh(scope) {
    if (busy) throw new Error('上一轮刷新仍在进行');
    busy = true; refreshButton.disabled = true;
    status.textContent = '正在刷新' + names[scopes.indexOf(scope)] + '，保存数据后更新画面…';
    try {
      if (!csrf) await read();
      var response = await fetch('/api/card/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ scope: scope }) });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error);
      csrf = result.csrf;
      try { store(result.snapshot); } catch (_) { /* disk save succeeded */ }
      var failed = scopes.slice(1).filter(function (game) { return (scope === 'all' || scope === game) && result.snapshot.games[game].status === 'error'; });
      status.textContent = failed.length ? '部分刷新失败；已保留上次成功数据，详情页可查看状态。' : '刷新结果已保存 · ' + new Date().toLocaleTimeString('zh-CN');
      return result.snapshot;
    } catch (error) {
      status.textContent = error.message || '刷新失败；保留已保存的数据。';
      throw error;
    } finally { busy = false; refreshButton.disabled = false; }
  }
  function pageChanged(page) {
    activePage = page;
    document.querySelectorAll('[data-page]').forEach(function (button) { button.setAttribute('aria-pressed', String(Number(button.dataset.page) === page)); });
    refreshButton.textContent = '刷新' + names[page];
  }
  card = HoyoCard.mount({ canvas: document.getElementById('rear'), initialSnapshot: initialSnapshot, refresh: refresh, onPageChange: pageChanged });
  document.querySelectorAll('[data-page]').forEach(function (button) { button.addEventListener('click', function () { card.goTo(Number(button.dataset.page)); }); });
  refreshButton.addEventListener('click', function () {
    refresh(scopes[activePage]).then(function (snapshot) { card.setSnapshot(snapshot); }).catch(function () {});
  });
  // First RAF must be allowed to publish the cached frame before any awaited host work.
  requestAnimationFrame(function () {
    read().then(function (snapshot) {
      card.setSnapshot(snapshot);
      status.textContent = '已读取本地快照 · 左右拖动翻页，下拉刷新；详情为官方小组件式两栏。';
    }).catch(function (error) { status.textContent = error.message || '本地状态读取失败；保留缓存画面。'; });
  });
  window.addEventListener('pagehide', function () { card.destroy(); });
})();
