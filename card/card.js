// SPDX-License-Identifier: AGPL-3.0-or-later
// Rear-screen Hoyolab card. Classic script: Canvas 2D and pointer events only.
// The provider owns network, storage and the persisted snapshot. This file only draws.
(function () {
  'use strict';

  var DESIGN_W = 912;
  var DESIGN_H = 596;
  var SAFE_L = 318;
  var SAFE_R = 890;
  // Header keeps the left edge aligned with the card grid, but stops short of
  // the top-right rounded corner. Its right edge is intentionally not tied to SAFE_R.
  var HEADER_W = 520;
  var HEADER_R = SAFE_L + HEADER_W;
  var COL_GAP = 12;
  var COL_TOP = 76;
  var COL_BOTTOM = 502;
  var SCROLL_BOTTOM = 508;
  var DOT_GAP = 86;
  var LOCK = 12;
  var SWIPE = 60;
  var PULL = 70;
  var BANNER_TOP = 112;
  var BANNER_H = 44;

  var GAMES = [
    { id: 'genshin', code: 'GI', name: '原神', hint: '下拉刷新原神', primary: '原粹树脂', daily: '每日委托', accent: '#3ee0c5', accentSoft: 'rgba(62,224,197,0.16)' },
    { id: 'hsr', code: 'HSR', name: '星穹铁道', hint: '下拉刷新星穹铁道', primary: '开拓力', daily: '每日实训', accent: '#ff8d42', accentSoft: 'rgba(255,141,66,0.16)' },
    { id: 'zzz', code: 'ZZZ', name: '绝区零', hint: '下拉刷新绝区零', primary: '电量', daily: '每日活跃', accent: '#c084fc', accentSoft: 'rgba(192,132,252,0.18)' }
  ];
  var DOT_CY = 546;
  var HOME_THEMES = [
    { paper: '#eeeade', ink: '#315c50', soft: '#d8e3d8', track: '#d5d6c8' },
    { paper: '#e5eaf0', ink: '#395974', soft: '#cddbe7', track: '#cbd3db' },
    { paper: '#e9ebd5', ink: '#535e2a', soft: '#d7ddac', track: '#cfd3b8' }
  ];
  var CARD_RADIUS = 25;
  var PAGE_TRANSITION_MS = 360;
  // 角色背景按 912×596 直接裁切；blur 版本用于卡片背板的真实模糊。
  var BG_ASSETS = {
    genshin: { sharp: 'assets/bg-genshin.jpg', blur: 'assets/bg-genshin-blur.jpg' },
    hsr: { sharp: 'assets/bg-hsr.jpg', blur: 'assets/bg-hsr-blur.jpg' },
    zzz: { sharp: 'assets/bg-zzz.jpg', blur: 'assets/bg-zzz-blur.jpg' }
  };
  var BACKGROUND_PAGES = ['home', 'genshin', 'hsr', 'zzz'];

  // QuickJS 宿主缺省没有 globalThis 与 crypto；这里就地补 polyfill，
  // 保证 lib/platform.mjs（uuid/randomInt）在模块卡片环境可运行。
  var _getGlobal = function () {
    if (typeof globalThis !== 'undefined') return globalThis;
    if (typeof self !== 'undefined') return self;
    if (typeof window !== 'undefined') return window;
    if (typeof this !== 'undefined' && this) return this;
    return null;
  };
  var root = _getGlobal() || {};
  try {
    if (root && !root.globalThis) root.globalThis = root;
  } catch (_) { /* ignore */ }
  try {
    if (root && (!root.crypto || typeof root.crypto.getRandomValues !== 'function')) {
      var _randState = (typeof Date !== 'undefined' ? Date.now() : 1) >>> 0;
      var _nextRand = function () {
        // xorshift32：非安全随机，仅用于 deviceID/签名随机数。
        _randState ^= _randState << 13; _randState ^= _randState >>> 17; _randState ^= _randState << 5;
        return _randState >>> 0;
      };
      var _bytes = function (arr) {
        for (var i = 0; i < arr.length; i++) { arr[i] = _nextRand() & 0xff; }
        return arr;
      };
      root.crypto = { getRandomValues: _bytes };
    }
  } catch (_) { /* ignore */ }
  // URLSearchParams：lib/hoyo.mjs 的 signed() 只用 `new URLSearchParams(pairs).toString()`。
  try {
    if (root && typeof root.URLSearchParams === 'undefined') {
      root.URLSearchParams = function URLSearchParams(entries) {
        var _pairs = [];
        if (entries) {
          if (Array.isArray(entries)) {
            for (var i = 0; i < entries.length; i++) _pairs.push([String(entries[i][0]), String(entries[i][1])]);
          } else if (typeof entries === 'object') {
            for (var k in entries) if (Object.prototype.hasOwnProperty.call(entries, k)) _pairs.push([k, String(entries[k])]);
          }
        }
        this.append = function (k, v) { _pairs.push([String(k), String(v)]); };
        this.toString = function () {
          var out = [];
          for (var i = 0; i < _pairs.length; i++) {
            out.push(encodeURIComponent(_pairs[i][0]) + '=' + encodeURIComponent(_pairs[i][1]));
          }
          return out.join('&');
        };
      };
    }
  } catch (_) { /* ignore */ }
  // TextEncoder/Decoder：@noble/hashes 的 utf8ToBytes 依赖它；QuickJS 宿主无此全局。
  try {
    if (root && typeof root.TextEncoder === 'undefined') {
      root.TextEncoder = function TextEncoder() {
        this.encoding = 'utf-8';
        this.encode = function (str) {
          str = String(str);
          var bytes = [], code = 0;
          for (var i = 0; i < str.length; i++) {
            code = str.charCodeAt(i);
            if (code < 0x80) { bytes.push(code); }
            else if (code < 0x800) {
              bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
            } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
              var lo = str.charCodeAt(++i);
              code = 0x10000 + ((code - 0xd800) << 10) + (lo - 0xdc00);
              bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
            } else if (code >= 0xdc00 && code <= 0xdfff) {
              bytes.push(0xef, 0xbf, 0xbd); // 孤立低代理 → U+FFFD
            } else {
              bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
            }
          }
          return new Uint8Array(bytes);
        };
        this.encodeInto = function (str, target) {
          var src = this.encode(str), n = Math.min(src.length, target.length);
          for (var i = 0; i < n; i++) target[i] = src[i];
          return { read: str.length, written: n };
        };
      };
      root.TextDecoder = function TextDecoder() {
        this.encoding = 'utf-8';
        this.decode = function (buf) {
          if (!buf) return '';
          var out = '', i = 0, c;
          while (i < buf.length) {
            c = buf[i++];
            if (c < 0x80) out += String.fromCharCode(c);
            else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (buf[i++] & 0x3f));
            else if (c < 0xf0) out += String.fromCharCode(((c & 0x0f) << 12) | ((buf[i++] & 0x3f) << 6) | (buf[i++] & 0x3f));
            else {
              var cp = ((c & 0x07) << 18) | ((buf[i++] & 0x3f) << 12) | ((buf[i++] & 0x3f) << 6) | (buf[i++] & 0x3f);
              cp -= 0x10000;
              out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
            }
          }
          return out;
        };
      };
    }
  } catch (_) { /* ignore */ }

  function clamp(n, a, b) {
    if (n < a) return a;
    if (n > b) return b;
    return n;
  }

  function tint(hex, alpha) {
    var value = String(hex || '#ffffff').replace('#', '');
    if (value.length === 3) value = value.charAt(0) + value.charAt(0) + value.charAt(1) + value.charAt(1) + value.charAt(2) + value.charAt(2);
    var n = parseInt(value, 16);
    if (!isFinite(n)) return 'rgba(255,255,255,' + alpha + ')';
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  function easeInOut(progress) {
    var p = clamp(progress, 0, 1);
    return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  }

  function normalizePageBackground(value) {
    if (!value || typeof value !== 'object') return null;
    var custom = typeof value.custom === 'string' && value.custom ? value.custom : null;
    var customBlur = typeof value.customBlur === 'string' && value.customBlur ? value.customBlur : null;
    if (!custom) return null;
    return { custom: custom, customBlur: customBlur };
  }

  function pad2(n) {
    n = Math.floor(Math.abs(n));
    return (n < 10 ? '0' : '') + n;
  }

  function positive(n) {
    return typeof n === 'number' && isFinite(n) && n > 0 ? n : 0;
  }

  function displayScalar(value) {
    if (value == null || value === '') return '—';
    if (typeof value === 'number') return isFinite(value) ? String(value) : '—';
    if (typeof value === 'string') return value;
    return '—';
  }

  function asNumber(value) {
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string' && value !== '' && isFinite(Number(value))) return Number(value);
    return null;
  }

  function isSnapshot(next) {
    return !!next && typeof next === 'object' && next.schema === 1 &&
      next.games && typeof next.games === 'object' && !Array.isArray(next.games);
  }

  function columnWidth() {
    return (SAFE_R - SAFE_L - COL_GAP * 2) / 3;
  }

  function columnRect(index) {
    var w = columnWidth();
    return { x: SAFE_L + index * (w + COL_GAP), y: COL_TOP, w: w, h: COL_BOTTOM - COL_TOP };
  }

  function dotCenter(index) {
    return (SAFE_L + SAFE_R) / 2 + (index - 2) * DOT_GAP;
  }

  function dotHit(index) {
    var cx = dotCenter(index);
    return { x: cx - 34, y: DOT_CY - 38, w: 68, h: 76 };
  }

  function contains(rect, x, y) {
    return !!rect && x >= rect.x && y >= rect.y && x <= rect.x + rect.w && y <= rect.y + rect.h;
  }

  function mount(options) {
    if (!options || !options.canvas || typeof options.canvas.getContext !== 'function') {
      throw new Error('HoyoCard.mount 需要 canvas');
    }
    var canvas = options.canvas;
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('HoyoCard.mount 需要 2d 上下文');
    if (typeof canvas.__hoyoCardControllerDestroy === 'function') {
      try { canvas.__hoyoCardControllerDestroy(); } catch (err) {}
    }

    var view = typeof window !== 'undefined' ? window : root;
    var snapshot = { schema: 1, updatedAt: null, games: {} };
    var initialPage = typeof options.initialPage === 'number' ? Math.round(options.initialPage) : 1;
    if (!isFinite(initialPage)) initialPage = 1;
    var page = clamp(initialPage, 0, 4);
    var scrollY = 0;
    var scrollOrigin = 0;
    var maxScroll = 0;
    var refreshing = false;
    var pull = 0;
    var fault = '';
    var refreshToken = 0;
    var axis = null;
    var mode = null;
    var startX = null;
    var startY = null;
    var lastX = 0;
    var lastY = 0;
    var dragX = 0;
    var activeId = null;
    var stopped = false;
    var queued = false;
    var painting = false;
    var rafId = 0;
    var recoveryTimer = 0;
    var bound = [];
    var homeImages = {};
    var homeImageLoaders = [];
    var pageBackgrounds = options.backgrounds || {};
    var homeGame = GAMES[Math.floor(Math.random() * GAMES.length)].id;
    var backgrounds = {};
    var customBackgrounds = {};
    var backgroundLoaders = [];
    var paintedPage = page;
    var pagePosition = page;
    var pageTransition = null;

    for (var gi = 0; gi < GAMES.length; gi++) {
      backgrounds[GAMES[gi].id] = loadBackgroundPair(BG_ASSETS[GAMES[gi].id].sharp, BG_ASSETS[GAMES[gi].id].blur);
    }
    for (var bp = 0; bp < BACKGROUND_PAGES.length; bp++) {
      customBackgrounds[BACKGROUND_PAGES[bp]] = loadPageBackground(pageBackgrounds[BACKGROUND_PAGES[bp]]);
    }

    function clock() {
      if (options && typeof options.now === 'function') {
        try {
          var value = options.now();
          if (typeof value === 'number' && isFinite(value)) return value;
        } catch (err) {}
      }
      return Date.now();
    }

    function loadBackgroundImage(src) {
      var entry = { image: null, loaded: false, failed: true, src: src || null };
      var ImageType = view.Image || root.Image;
      if (!src || typeof ImageType !== 'function') return entry;
      var image = new ImageType();
      entry.image = image;
      entry.failed = false;
      backgroundLoaders.push(image);
      image.onload = function () {
        if (stopped) return;
        entry.loaded = true;
        entry.failed = false;
        requestDraw();
      };
      image.onerror = function () {
        if (stopped) return;
        entry.loaded = false;
        entry.failed = true;
        requestDraw();
      };
      try { image.src = src; } catch (err) { entry.failed = true; }
      return entry;
    }

    function loadBackgroundPair(sharpSrc, blurSrc) {
      return { sharp: loadBackgroundImage(sharpSrc), blur: loadBackgroundImage(blurSrc) };
    }

    function loadPageBackground(value) {
      var normalized = normalizePageBackground(value);
      if (!normalized) return null;
      var pair = loadBackgroundPair(normalized.custom, normalized.customBlur);
      pair.custom = normalized.custom;
      pair.customBlur = normalized.customBlur;
      return pair;
    }

    function backgroundKeyFor(current) {
      return current <= 1 ? 'home' : GAMES[current - 2].id;
    }

    function backgroundEntry(key) {
      var custom = customBackgrounds[key];
      if (custom && custom.sharp && custom.sharp.src) return custom;
      var defaultKey = key === 'home' ? homeGame : key;
      return backgrounds[defaultKey] || null;
    }

    function parseTime(value) {
      if (value == null || value === '') return null;
      if (typeof value === 'number' && isFinite(value)) {
        if (value > 1e12) return value;
        if (value > 1e9) return value * 1000;
        return null;
      }
      if (typeof value === 'string') {
        var ms = Date.parse(value);
        if (!isNaN(ms)) return ms;
      }
      return null;
    }

    function formatUpdated(value) {
      var ms = parseTime(value);
      if (ms == null) return '—';
      var date = new Date(ms);
      if (isNaN(date.getTime())) return '—';
      return pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
    }

    function recoveryLine(primary) {
      if (!primary || primary.recoveryAt == null || primary.recoveryAt === '') return '回满 —';
      var ms = parseTime(primary.recoveryAt);
      if (ms == null) return displayScalar(primary.recoveryAt);
      if (ms <= clock()) return '已回满';
      var date = new Date(ms);
      return pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ' 回满';
    }

    function gameById(id) {
      var games = snapshot && snapshot.games;
      if (!games || typeof games !== 'object') return null;
      var game = games[id];
      if (!game || typeof game !== 'object' || Array.isArray(game)) return null;
      return game;
    }

    function widgetRole(game) {
      return !!(game && (game.widgetDefaultRole === true || game.source === 'widget'));
    }

    function nicknameText(game) {
      if (!game || widgetRole(game)) return '';
      if (game.nickname == null || game.nickname === '') return '';
      return String(game.nickname);
    }

    function uidLine(game) {
      if (!game || widgetRole(game)) return '';
      if (game.uid != null && game.uid !== '') return 'UID ' + String(game.uid);
      if (game.source === 'full') return 'UID —';
      return '';
    }

    function bannerText(game) {
      if (!game) return '尚无数据';
      if (game.status === 'error') {
        if (game.error == null || game.error === '') return '获取失败';
        return String(game.error);
      }
      if (game.status === 'empty') return '尚无数据';
      if (game.status == null && !game.primary && !game.daily) return '尚无数据';
      return '';
    }

    function metricLabel(metric, fallback) {
      if (metric && metric.label != null && metric.label !== '') return String(metric.label);
      return fallback;
    }

    function rewardText(daily) {
      if (!daily || !Object.prototype.hasOwnProperty.call(daily, 'reward')) return null;
      return displayScalar(daily.reward);
    }

    function rewardColor(text) {
      if (text === '奖励已领') return '#9dcfb0';
      if (text === '奖励未领') return '#f0b27a';
      return '#d9cec0';
    }

    function toneColor(tone) {
      if (tone === 'good') return '#9dcfb0';
      if (tone === 'warn') return '#f0b27a';
      if (tone === 'muted') return '#b7ab9e';
      return '#f7f1e8';
    }

    function pairText(current, max) {
      return displayScalar(current) + ' / ' + displayScalar(max);
    }

    function fillRatio(current, max) {
      var currentNumber = asNumber(current);
      var maxNumber = asNumber(max);
      if (currentNumber == null || maxNumber == null || maxNumber <= 0) return null;
      return clamp(currentNumber / maxNumber, 0, 1);
    }

    function pageHint() {
      if (paintedPage >= 2 && paintedPage <= 4) return GAMES[paintedPage - 2].hint;
      return '下拉刷新全部';
    }

    function hintString() {
      if (refreshing) return '正在刷新';
      if (pull >= PULL) return '松开刷新';
      if (pull > 0) return pageHint();
      if (fault) return fault;
      return pageHint();
    }

    function pageTitle() {
      if (paintedPage === 1) return '总览';
      if (paintedPage <= 0) return '';
      var info = GAMES[paintedPage - 2];
      var game = gameById(info.id);
      if (game && game.name != null && String(game.name) !== '') return String(game.name);
      return info.name;
    }

    function scopeFor(index) {
      if (index >= 2 && index <= 4) return GAMES[index - 2].id;
      return 'all';
    }

    function emitStatus(payload) {
      if (!options || typeof options.onStatus !== 'function') return;
      try { options.onStatus(payload); } catch (err) {}
    }

    function emitPage() {
      if (!options || typeof options.onPageChange !== 'function') return;
      try { options.onPageChange(page); } catch (err) {}
    }

    function clearRecoveryTimer() {
      if (!recoveryTimer) return;
      if (typeof clearTimeout === 'function') clearTimeout(recoveryTimer);
      recoveryTimer = 0;
    }

    function armRecoveryTimer() {
      clearRecoveryTimer();
      if (stopped || typeof setTimeout !== 'function') return;
      var now = clock();
      var soonest = null;
      var i;
      for (i = 0; i < GAMES.length; i++) {
        var game = gameById(GAMES[i].id);
        var ms = game && game.primary ? parseTime(game.primary.recoveryAt) : null;
        if (ms != null && ms > now && (soonest == null || ms < soonest)) soonest = ms;
      }
      if (soonest == null) return;
      var delay = soonest - now + 30;
      if (delay < 0) delay = 0;
      if (delay > 2147483647) delay = 2147483647;
      recoveryTimer = setTimeout(function () {
        recoveryTimer = 0;
        if (stopped) return;
        requestDraw();
        armRecoveryTimer();
      }, delay);
    }

    function scrollTopFor(game) {
      return bannerText(game) ? BANNER_TOP + BANNER_H + 16 : 118;
    }

    function remeasure() {
      // 详情页是官方小组件式的左右两栏，一屏放下，不纵向滚动；
      // maxScroll 恒为 0 时，竖拖自然变成「下拉刷新」而非滚动。
      maxScroll = 0;
      scrollY = 0;
    }

    function applySnapshot(next, quiet) {
      if (!isSnapshot(next)) {
        if (!quiet) emitStatus({ type: 'snapshot-ignored' });
        return false;
      }
      snapshot = next;
      remeasure();
      armRecoveryTimer();
      return true;
    }

    function fitText(value, maxW) {
      if (maxW < 0) return '';
      if (ctx.measureText(value).width <= maxW) return value;
      var text = value;
      var ellipsis = '…';
      while (text.length > 0 && ctx.measureText(text + ellipsis).width > maxW) text = text.slice(0, -1);
      return text.length ? text + ellipsis : '';
    }

    function drawText(font, color, align, baseline, value, x, y, maxW, outline, outlineWidth) {
      var raw = value == null ? '' : String(value);
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      var shown = typeof maxW === 'number' ? fitText(raw, maxW) : raw;
      var tx = Math.round(x);
      var ty = Math.round(y);
      if (outline && typeof ctx.strokeText === 'function') {
        ctx.lineWidth = outlineWidth || 3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = outline;
        ctx.strokeText(shown, tx, ty);
      }
      ctx.fillText(shown, tx, ty);
    }

    function round(x, y, w, h, r) {
      if (!(w > 0) || !(h > 0)) return;
      var radius = r < 0 ? 0 : r;
      var maxR = Math.min(w, h) / 2;
      if (radius > maxR) radius = maxR;
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + w, y, x + w, y + h, radius);
      ctx.arcTo(x + w, y + h, x, y + h, radius);
      ctx.arcTo(x, y + h, x, y, radius);
      ctx.arcTo(x, y, x + w, y, radius);
      ctx.closePath();
    }

    // 顶部标题/详情信息用的轻量浅色玻璃条：只覆盖文字附近，不压暗整张背景。
    function paintHeaderGlass(x, y, w, h, r) {
      var layer;
      for (layer = 2; layer >= 1; layer--) {
        round(x - layer, y + 3 + layer, w + layer * 2, h + layer * 2, r + layer);
        ctx.fillStyle = 'rgba(8,12,16,' + (0.05 * layer) + ')';
        ctx.fill();
      }
      var pair = backgroundEntry(backgroundKeyFor(paintedPage));
      var blur = pair && pair.blur && pair.blur.loaded ? pair.blur.image : null;
      ctx.save();
      round(x, y, w, h, r);
      ctx.clip();
      if (blur && typeof ctx.drawImage === 'function') {
        ctx.drawImage(blur, 0, 0, DESIGN_W, DESIGN_H);
      }
      ctx.fillStyle = 'rgba(248,247,241,0.76)';
      ctx.fillRect(x, y, w, h);
      var sheen = ctx.createLinearGradient(x, y, x + w * 0.7, y + h);
      sheen.addColorStop(0, 'rgba(255,255,255,0.26)');
      sheen.addColorStop(0.55, 'rgba(255,255,255,0.06)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.60)';
      ctx.fillRect(x + r * 0.8, y + 1, w - r * 1.6, 1);
      ctx.restore();
      round(x + 0.6, y + 0.6, w - 1.2, h - 1.2, Math.max(1, r - 0.6));
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.stroke();
    }

    // 参考 WebTricks 的 liquid-glass CSS：单层模糊背板 + 顶部受光 tint + 1px 边缘
    // 内高光/底部返光 + 斜向 sheen。Canvas 没有 backdrop-filter，所以用预模糊图；
    // 不做内圈缩放/位移，避免出现硬边和“同一张卡片里模糊程度不一样”的接缝。
    function paintGlassPanel(x, y, w, h, radius, theme) {
      var r = radius == null ? CARD_RADIUS : radius;
      var layer;
      for (layer = 2; layer >= 1; layer--) {
        round(x - layer * 2, y + 4 + layer, w + layer * 4, h + layer * 2, r + layer * 2);
        ctx.fillStyle = 'rgba(8,12,16,' + (0.05 * layer) + ')';
        ctx.fill();
      }

      var key = backgroundKeyFor(paintedPage);
      var pair = backgroundEntry(key);
      var blur = pair && pair.blur && pair.blur.loaded ? pair.blur.image : null;

      ctx.save();
      round(x, y, w, h, r);
      ctx.clip();
      if (blur && typeof ctx.drawImage === 'function') {
        ctx.drawImage(blur, 0, 0, DESIGN_W, DESIGN_H);
      } else {
        ctx.fillStyle = tint(theme.paper, 0.76);
        ctx.fillRect(x, y, w, h);
      }

      // 顶部受光的体色渐变。
      var body = ctx.createLinearGradient(x, y, x + w, y + h);
      body.addColorStop(0, tint(theme.paper, 0.62));
      body.addColorStop(0.52, tint(theme.paper, 0.50));
      body.addColorStop(1, tint(theme.paper, 0.44));
      ctx.fillStyle = body;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x, y, w, h);

      // 斜向 specular sheen。
      var sheen = ctx.createLinearGradient(x, y, x + w * 0.66, y + h * 0.72);
      sheen.addColorStop(0, 'rgba(255,255,255,0.30)');
      sheen.addColorStop(0.30, 'rgba(255,255,255,0.08)');
      sheen.addColorStop(0.78, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(x, y, w, h);

      // 内底部返光/厚度。
      var depth = ctx.createLinearGradient(x, y + h * 0.62, x, y + h);
      depth.addColorStop(0, 'rgba(0,0,0,0)');
      depth.addColorStop(1, 'rgba(40,52,44,0.06)');
      ctx.fillStyle = depth;
      ctx.fillRect(x, y, w, h);

      // 1px 边缘：上亮下暗、两侧介于中间，不形成一条宽带。
      var rim = ctx.createLinearGradient(x, y, x + w, y + h);
      rim.addColorStop(0, 'rgba(255,255,255,0.62)');
      rim.addColorStop(0.35, 'rgba(255,255,255,0.22)');
      rim.addColorStop(0.7, 'rgba(255,255,255,0.10)');
      rim.addColorStop(1, 'rgba(255,255,255,0.18)');
      round(x + 0.75, y + 0.75, w - 1.5, h - 1.5, Math.max(1, r - 0.75));
      ctx.lineWidth = 1;
      ctx.strokeStyle = rim;
      ctx.stroke();
      // 顶部和底部各一条很轻的 inset 高光/返光。
      ctx.fillStyle = 'rgba(255,255,255,0.48)';
      ctx.fillRect(x + r * 0.75, y + 1, w - r * 1.5, 1);
      ctx.restore();

      round(x + 0.6, y + 0.6, w - 1.2, h - 1.2, Math.max(1, r - 0.6));
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(24,34,28,0.20)';
      ctx.stroke();
    }

    // Images are bundled data URLs: no network and no image-loading gate on the first frame.
    function loadHomeImages() {
      var sources = root.HoyoCardAssets || {};
      var ImageType = view.Image || root.Image;
      if (typeof ImageType !== 'function') return;
      Object.keys(sources).forEach(function (key) {
        var img = new ImageType();
        homeImageLoaders.push(img);
        img.onload = function () {
          if (stopped) return;
          homeImages[key] = img;
          requestDraw();
        };
        img.onerror = function () { if (!stopped) emitStatus({ type: 'asset-error', asset: key }); };
        img.src = sources[key];
      });
    }

    function paintHomeAsset(key, x, y, size) {
      var img = homeImages[key];
      if (!img || typeof ctx.drawImage !== 'function') return;
      ctx.drawImage(img, x, y, size, size);
    }

    // Generic status symbols; game resources and daily tasks use the PNG assets above.
    function paintHomeIcon(kind, x, y, size, color, backing) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(size / 32, size / 32);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (kind === 'clock') {
        ctx.arc(16, 16, 11, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(16, 9); ctx.lineTo(16, 16);
        ctx.lineTo(22, 19); ctx.stroke();
      } else if (kind === 'gift') {
        round(5, 13, 22, 6, 1); ctx.stroke();
        ctx.strokeRect(7, 19, 18, 10);
        ctx.beginPath(); ctx.moveTo(16, 13); ctx.lineTo(16, 29);
        ctx.moveTo(16, 13); ctx.lineTo(9, 10); ctx.lineTo(9, 5);
        ctx.lineTo(14, 6); ctx.lineTo(16, 13); ctx.lineTo(18, 6);
        ctx.lineTo(23, 5); ctx.lineTo(23, 10); ctx.closePath(); ctx.stroke();
      } else if (kind === 'check') {
        ctx.arc(16, 16, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(10, 16); ctx.lineTo(14, 20);
        ctx.lineTo(23, 11); ctx.stroke();
      } else {
        ctx.arc(16, 16, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(16, 9); ctx.lineTo(16, 18); ctx.stroke();
        ctx.fillRect(15, 22, 2, 2);
      }
      ctx.restore();
    }

    function paintHomeBar(x, y, w, ratio, theme) {
      round(x, y, w, 7, 4); ctx.fillStyle = theme.track; ctx.fill();
      if (ratio != null && ratio > 0) {
        round(x, y, Math.min(w, Math.max(7, w * ratio)), 7, 4);
        ctx.fillStyle = theme.ink; ctx.fill();
      }
    }

    function paintColumn(index) {
      var info = GAMES[index];
      var theme = HOME_THEMES[index];
      var game = gameById(info.id);
      var rect = columnRect(index);
      var primary = game && game.primary ? game.primary : null;
      var daily = game && game.daily ? game.daily : null;
      var banner = bannerText(game);
      var errored = !!(game && game.status === 'error');
      var x = rect.x + 16;
      var inner = rect.w - 32;
      var cx = rect.x + rect.w / 2;
      var top = rect.y;
      paintGlassPanel(rect.x, top, rect.w, rect.h, CARD_RADIUS, theme);
      ctx.save();
      round(rect.x, top, rect.w, rect.h, CARD_RADIUS); ctx.clip();
      drawText('700 25px sans-serif', theme.ink, 'left', 'middle', info.name, x, top + 31, inner);
      // A soft medallion gives each game's resource its own visual identity.
      ctx.beginPath(); ctx.arc(cx, top + 97, 37, 0, Math.PI * 2);
      ctx.fillStyle = tint(theme.soft, 0.76); ctx.fill();
      paintHomeAsset(info.id + 'Primary', cx - 35, top + 62, 70);
      drawText('600 17px sans-serif', theme.ink, 'center', 'middle', metricLabel(primary, info.primary), cx, top + 151, inner);
      drawText('700 59px sans-serif', '#28342f', 'center', 'middle', displayScalar(primary && primary.current), cx, top + 198, inner);
      drawText('500 18px sans-serif', '#69746b', 'center', 'middle', '/ ' + displayScalar(primary && primary.max), cx, top + 239, inner);
      paintHomeBar(x + 5, top + 261, inner - 10, fillRatio(primary && primary.current, primary && primary.max), theme);
      paintHomeIcon(banner ? 'alert' : 'clock', x + 2, top + 281, 19, errored ? '#9a542d' : theme.ink, theme.paper);
      drawText('600 17px sans-serif', errored ? '#9a542d' : theme.ink, 'left', 'middle', banner ? (errored ? (primary && primary.current != null ? '失败 · 旧数据' : '刷新失败') : banner) : recoveryLine(primary), x + 27, top + 291, inner - 27);
      // Daily progress has a separate surface; completion never implies reward collection.
      round(x - 3, top + 318, inner + 6, 70, 14);
      ctx.fillStyle = tint(theme.soft, 0.76); ctx.fill();
      round(x - 3, top + 318, inner + 6, 70, 14);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.34)';
      ctx.stroke();
      drawText('600 16px sans-serif', theme.ink, 'center', 'middle', metricLabel(daily, info.daily), cx, top + 341, inner - 8);
      var dailyValue = displayScalar(daily && daily.current) + ' / ' + displayScalar(daily && daily.max);
      drawText('700 23px sans-serif', '#28342f', 'center', 'middle', dailyValue, cx, top + 369, inner - 8);
      var reward = rewardText(daily);
      var footer = '';
      var footerIcon = 'alert';
      var footerColor = '#69746b';
      if (reward != null) {
        footer = reward;
        footerIcon = reward === '奖励已领' ? 'check' : (reward === '奖励未领' ? 'gift' : 'alert');
        footerColor = reward === '奖励未领' ? '#9a542d' : theme.ink;
      }
      if (footer) {
        paintHomeIcon(footerIcon, x + 1, top + 399, 17, footerColor, theme.paper);
        drawText('600 14px sans-serif', footerColor, 'left', 'middle', footer, x + 25, top + 408, inner - 25);
      }
      ctx.restore();
    }

    function paintDetailChrome(info, game) {
      var bits = [];
      var nick = nicknameText(game);
      var uid = uidLine(game);
      if (widgetRole(game)) {
        drawText('600 20px sans-serif', info.accent, 'left', 'middle', '组件默认角色', SAFE_L + 16, 84, 300);
      } else {
        if (nick) bits.push(nick);
        if (uid) bits.push(uid);
        drawText('600 20px sans-serif', '#3f4a43', 'left', 'middle', bits.length ? bits.join(' · ') : '—', SAFE_L + 16, 84, 400);
      }
      drawText('600 20px sans-serif', '#5f6a61', 'right', 'middle', '更新 ' + formatUpdated(game && game.updatedAt), HEADER_R - 16, 84, 200);
      var banner = bannerText(game);
      if (banner) {
        drawText('600 22px sans-serif', game && game.status === 'error' ? '#9a542d' : '#5f6a61', 'left', 'middle', banner, SAFE_L + 16, BANNER_TOP + BANNER_H / 2, HEADER_W - 32);
      }
    }

    function paintWidgetDetail(info, game, top, h) {
      var theme = HOME_THEMES[paintedPage - 2];
      var primary = game && game.primary ? game.primary : null;
      var daily = game && game.daily ? game.daily : null;
      var compact = h < 370;
      var panelW = 256;
      var leftX = SAFE_L + 16;
      var leftW = panelW - 32;
      var cx = SAFE_L + panelW / 2;
      // Match the overview's type scale, soft surfaces and spacing.
      paintGlassPanel(SAFE_L, top, panelW, h, CARD_RADIUS, theme);
      ctx.save();
      round(SAFE_L, top, panelW, h, CARD_RADIUS); ctx.clip();
      if (compact) {
        paintHomeAsset(info.id + 'Primary', leftX + 12, top + 18, 46);
        drawText('600 20px sans-serif', theme.ink, 'left', 'middle', metricLabel(primary, info.primary), leftX + 74, top + 41, leftW - 74);
      } else {
        ctx.beginPath(); ctx.arc(cx, top + 62, 37, 0, Math.PI * 2);
        ctx.fillStyle = tint(theme.soft, 0.76); ctx.fill();
        paintHomeAsset(info.id + 'Primary', cx - 33, top + 29, 66);
        drawText('600 19px sans-serif', theme.ink, 'center', 'middle', metricLabel(primary, info.primary), cx, top + 119, leftW);
      }
      drawText('700 64px sans-serif', '#28342f', 'center', 'middle', displayScalar(primary && primary.current), cx, top + (compact ? 104 : 166), leftW);
      drawText('500 20px sans-serif', '#69746b', 'center', 'middle', '/ ' + displayScalar(primary && primary.max), cx, top + (compact ? 146 : 209), leftW);
      paintHomeBar(leftX + 8, top + (compact ? 168 : 232), leftW - 16, fillRatio(primary && primary.current, primary && primary.max), theme);
      paintHomeIcon('clock', leftX + 35, top + (compact ? 186 : 249), 19, theme.ink, theme.paper);
      drawText('600 20px sans-serif', theme.ink, 'left', 'middle', recoveryLine(primary), leftX + 62, top + (compact ? 196 : 259), leftW - 66);
      var dailyY = top + h - 110;
      round(leftX, dailyY, leftW, 90, 16);
      ctx.fillStyle = tint(theme.soft, 0.76); ctx.fill();
      round(leftX, dailyY, leftW, 90, 16);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.34)';
      ctx.stroke();
      var dailyValue = displayScalar(daily && daily.current) + ' / ' + displayScalar(daily && daily.max);
      if (info.id === 'genshin') {
        drawText('600 20px sans-serif', theme.ink, 'left', 'middle', metricLabel(daily, info.daily), leftX + 14, dailyY + 25, 100);
        drawText('700 26px sans-serif', '#28342f', 'right', 'middle', dailyValue, leftX + leftW - 14, dailyY + 25, 90);
        paintHomeBar(leftX + 14, dailyY + 46, leftW - 28, fillRatio(daily && daily.current, daily && daily.max), theme);
      } else {
        // Three-digit daily scores need their own line, as on the overview.
        drawText('600 20px sans-serif', theme.ink, 'center', 'middle', metricLabel(daily, info.daily), cx, dailyY + 21, leftW - 28);
        drawText('700 26px sans-serif', '#28342f', 'center', 'middle', dailyValue, cx, dailyY + 49, leftW - 28);
        paintHomeBar(leftX + 14, dailyY + 70, leftW - 28, fillRatio(daily && daily.current, daily && daily.max), theme);
      }
      var reward = rewardText(daily);
      if (reward != null) drawText('600 17px sans-serif', reward === '奖励未领' ? '#9a542d' : theme.ink, 'left', 'middle', reward, leftX + 14, dailyY + 72, leftW - 28);
      ctx.restore();

      var panelX = SAFE_L + panelW + 16;
      var panelRightW = SAFE_R - panelX;
      paintGlassPanel(panelX, top, panelRightW, h, CARD_RADIUS, theme);
      var rightX = panelX + 18;
      var rightW = panelRightW - 36;
      drawText('700 24px sans-serif', theme.ink, 'left', 'middle', '今日一览', rightX, top + 33, rightW);
      var rows = game && Array.isArray(game.list) ? game.list.slice(0, 6) : [];
      var rowH = (h - 74) / 6;
      if (!rows.length) drawText('500 22px sans-serif', '#69746b', 'center', 'middle', '暂无其他便笺', rightX + rightW / 2, top + h / 2, rightW);
      for (var ri = 0; ri < rows.length; ri++) {
        var row = rows[ri] || {};
        var ry = top + 59 + ri * rowH;
        var value = displayScalar(row.value);
        var valueFont = '700 24px sans-serif';
        ctx.font = valueFont;
        var valueW = ctx.measureText(value).width;
        var label = displayScalar(row.label);
        ctx.font = '600 22px sans-serif';
        var labelW = ctx.measureText(label).width;
        if (labelW + valueW + 12 > rightW) {
          valueFont = '700 22px sans-serif';
          ctx.font = valueFont;
          valueW = ctx.measureText(value).width;
        }
        var stacked = labelW + valueW + 12 > rightW;
        if (stacked) {
          drawText('600 20px sans-serif', '#5f6e61', 'left', 'middle', label, rightX, ry + rowH * 0.24, rightW);
          drawText('700 22px sans-serif', row.highlight ? theme.ink : '#28342f', 'right', 'middle', value, rightX + rightW, ry + rowH * 0.73, rightW);
        } else {
          drawText('600 22px sans-serif', '#5f6e61', 'left', 'middle', label, rightX, ry + rowH / 2, rightW - valueW - 12);
          drawText(valueFont, row.highlight ? theme.ink : '#28342f', 'right', 'middle', value, rightX + rightW, ry + rowH / 2, valueW + 2);
        }
        if (ri < rows.length - 1) {
          ctx.fillStyle = 'rgba(70,84,70,0.16)'; ctx.fillRect(rightX, ry + rowH, rightW, 1);
        }
      }
    }

    function paintDetail() {
      var info = GAMES[paintedPage - 2];
      var game = gameById(info.id);
      paintDetailChrome(info, game);
      var top = scrollTopFor(game);
      var h = SCROLL_BOTTOM - top;
      paintWidgetDetail(info, game, top, h);
    }

    function paintSpinner(x, y, color) {
      var angle = ((clock() % 1000) / 1000) * Math.PI * 2;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0.2, Math.PI * 1.45);
      ctx.strokeStyle = color || '#f7f1e8';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    function paintChrome() {
      var game = paintedPage >= 2 ? gameById(GAMES[paintedPage - 2].id) : null;
      var banner = paintedPage >= 2 ? bannerText(game) : '';
      var headerY = 10;
      var headerH = paintedPage <= 1 ? 56 : (banner ? 156 : 100);
      paintHeaderGlass(SAFE_L, headerY, HEADER_W, headerH, 24);
      var contentX = SAFE_L + 16;
      var contentRight = HEADER_R - 16;

      var title = fitText(pageTitle(), 220);
      ctx.font = '700 36px sans-serif';
      var titleW = ctx.measureText(title).width;
      var hint = hintString();
      var hintX = contentX + titleW + 18;
      var hintMax = contentRight - hintX - (refreshing ? 72 : 0);
      ctx.font = '600 16px sans-serif';
      var shownHint = fitText(hint, hintMax);
      var hintW = ctx.measureText(shownHint).width;
      var hintColor = '#5a665c';
      if (fault && pull <= 0 && !refreshing) hintColor = '#9a542d';
      if (pull >= PULL || refreshing) hintColor = '#2f3a33';
      drawText('700 36px sans-serif', '#2f3a33', 'left', 'middle', title, contentX, 38, 220);
      drawText('600 16px sans-serif', hintColor, 'left', 'middle', shownHint, hintX, 40, hintMax);
      if (refreshing) {
        var spinnerX = hintX + hintW + 22;
        paintSpinner(spinnerX, 40, '#315c50');
      }
      if (pull > 0) {
        round(contentX, headerY + headerH - 4, (contentRight - contentX) * Math.min(1, pull / PULL), 3, 1.5);
        ctx.fillStyle = paintedPage >= 2 ? GAMES[paintedPage - 2].accent : '#315c50';
        ctx.fill();
      }
    }

    function paintStaminaHeader() {
      paintHeaderGlass(SAFE_L, 10, HEADER_W, 56, 24);
      var innerX = SAFE_L + 12;
      var columnW = (HEADER_W - 24) / 3;
      ctx.font = '700 32px sans-serif';
      for (var i = 0; i < 3; i++) {
        var info = GAMES[i];
        var game = gameById(info.id);
        var primary = game && game.primary ? game.primary : null;
        var value = fitText(displayScalar(primary && primary.current), 72);
        var textW = ctx.measureText(value).width;
        var groupW = 40 + 10 + textW;
        var startX = innerX + columnW * i + (columnW - groupW) / 2;
        paintHomeAsset(info.id + 'Primary', startX, 18, 40);
        drawText('700 32px sans-serif', '#28342f', 'left', 'middle', value, startX + 50, 39, 72);
      }
    }

    function paintDots() {
      if (page === 0) return;
      round(dotCenter(0) - 20, DOT_CY - 18, dotCenter(4) - dotCenter(0) + 40, 36, 18);
      ctx.fillStyle = 'rgba(8,12,18,0.18)'; ctx.fill();
      round(dotCenter(0) - 20, DOT_CY - 18, dotCenter(4) - dotCenter(0) + 40, 36, 18);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.stroke();
      var i;
      for (i = 0; i < 5; i++) {
        var cx = dotCenter(i);
        var active = i === page;
        var color = active ? (i <= 1 ? '#f7f1e8' : GAMES[i - 2].accent) : 'rgba(255,255,255,0.34)';
        if (active) {
          ctx.beginPath();
          ctx.arc(cx, DOT_CY, 15, 0, Math.PI * 2);
          ctx.fillStyle = tint(color, 0.14);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(cx, DOT_CY, active ? 7 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    }

    function paintBackdropBase(key) {
      var palette = {
        genshin: ['#0d1b19', '#071013'],
        hsr: ['#191426', '#090a12'],
        zzz: ['#1c1426', '#0a0c14'],
        home: ['#111722', '#07090f']
      }[key] || ['#111722', '#07090f'];
      if (ctx.createLinearGradient) {
        var gradient = ctx.createLinearGradient(0, 0, DESIGN_W, DESIGN_H);
        gradient.addColorStop(0, palette[0]);
        gradient.addColorStop(1, palette[1]);
        ctx.fillStyle = gradient;
      } else ctx.fillStyle = palette[1];
      ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
    }

    function paintBackdropImage(key, alpha) {
      var entry = backgroundEntry(key);
      if (!entry || !entry.sharp || !entry.sharp.loaded || !entry.sharp.image) return false;
      if (typeof ctx.drawImage !== 'function') return false;
      ctx.save();
      try {
        ctx.globalAlpha = alpha;
        ctx.drawImage(entry.sharp.image, 0, 0, DESIGN_W, DESIGN_H);
      } finally {
        ctx.restore();
      }
      return true;
    }

    function paintBackground(index) {
      var key = backgroundKeyFor(index);
      paintBackdropBase(key);
      paintBackdropImage(key, 1);
    }

    function dampPull() {
      if (pull <= 0) return 0;
      return Math.min(36, pull * 0.32);
    }

    function rubberX() {
      if (!dragX) return 0;
      var edge = (page <= 0 && dragX > 0) || (page >= 4 && dragX < 0);
      var limited = clamp(dragX, -110, 110);
      return edge ? limited * 0.22 : limited * 0.42;
    }

    function metrics() {
      var host = typeof window !== 'undefined' ? window : root;
      return {
        w: positive(host.CANVAS_W) || positive(canvas.width) || DESIGN_W,
        h: positive(host.CANVAS_H) || positive(canvas.height) || DESIGN_H
      };
    }

    function updatePagePosition() {
      if (!pageTransition) return pagePosition;
      var progress = clamp((clock() - pageTransition.start) / PAGE_TRANSITION_MS, 0, 1);
      if (progress >= 1) {
        pageTransition = null;
        pagePosition = page;
        return pagePosition;
      }
      pagePosition = pageTransition.from + (pageTransition.to - pageTransition.from) * easeInOut(progress);
      return pagePosition;
    }

    function paintSinglePage(index) {
      var previous = paintedPage;
      paintedPage = index;
      try {
        paintBackground(index);
        if (index === 0) {
          paintStaminaHeader();
          return;
        }
        paintChrome();
        ctx.save();
        try {
          ctx.translate(0, dampPull());
          if (index === 1) {
            for (var i = 0; i < 3; i++) paintColumn(i);
          } else paintDetail();
        } finally {
          ctx.restore();
        }
      } finally {
        paintedPage = previous;
      }
    }

    function paint() {
      var size = metrics();
      var position = updatePagePosition() - rubberX() / DESIGN_W;
      ctx.save();
      try {
        ctx.globalAlpha = 1;
        if (ctx.setTransform) ctx.setTransform(size.w / DESIGN_W, 0, 0, size.h / DESIGN_H, 0, 0);
        else if (ctx.scale) ctx.scale(size.w / DESIGN_W, size.h / DESIGN_H);
        // Fill the exposed strip while rubber-banding at either end.
        paintBackdropBase(backgroundKeyFor(page));
        for (var i = 0; i < 5; i++) {
          var offset = (i - position) * DESIGN_W;
          if (offset <= -DESIGN_W || offset >= DESIGN_W) continue;
          ctx.save();
          try {
            ctx.translate(offset, 0);
            paintSinglePage(i);
          } finally {
            ctx.restore();
          }
        }
        paintDots();
      } finally {
        ctx.restore();
      }
    }

    function requestDraw() {
      if (stopped || queued) return;
      var raf = view.requestAnimationFrame;
      if (typeof raf !== 'function') {
        if (painting) return;
        painting = true;
        try { paint(); } finally { painting = false; }
        return;
      }
      queued = true;
      rafId = raf.call(view, function () {
        queued = false;
        rafId = 0;
        if (stopped) return;
        paint();
        if (!stopped && (refreshing || pageTransition)) requestDraw();
      });
    }

    function errorText(err) {
      if (err && typeof err.message === 'string' && err.message) return err.message;
      if (typeof err === 'string' && err) return err;
      return '刷新未完成';
    }

    function beginRefresh(scope) {
      if (stopped || refreshing) return;
      pull = 0;
      dragX = 0;
      if (!options || typeof options.refresh !== 'function') {
        fault = '未提供刷新';
        emitStatus({ type: 'refresh-error', scope: scope, message: fault });
        requestDraw();
        return;
      }
      refreshing = true;
      fault = '';
      var token = ++refreshToken;
      emitStatus({ type: 'refreshing', scope: scope });
      requestDraw();
      Promise.resolve().then(function () {
        return options.refresh(scope);
      }).then(function (next) {
        if (stopped || token !== refreshToken) return;
        refreshing = false;
        var applied = false;
        if (next != null) applied = applySnapshot(next, true);
        if (applied) fault = '';
        else if (next != null) fault = '刷新结果无效';
        emitStatus({ type: 'refreshed', scope: scope, applied: applied });
        requestDraw();
      }, function (err) {
        if (stopped || token !== refreshToken) return;
        refreshing = false;
        fault = errorText(err);
        emitStatus({ type: 'refresh-error', scope: scope, message: fault });
        requestDraw();
      });
    }

    function setSnapshot(next) {
      if (stopped) return;
      applySnapshot(next, false);
      requestDraw();
    }

    function setBackgrounds(next) {
      if (stopped) return;
      var changed = false;
      for (var i = 0; i < BACKGROUND_PAGES.length; i++) {
        var pageKey = BACKGROUND_PAGES[i];
        var normalized = normalizePageBackground(next && next[pageKey]);
        var current = customBackgrounds[pageKey];
        var same = (!normalized && !current) ||
          (normalized && current && normalized.custom === current.custom && normalized.customBlur === current.customBlur);
        if (!same) {
          customBackgrounds[pageKey] = loadPageBackground(normalized);
          changed = true;
        }
      }
      if (changed) requestDraw();
    }

    function goTo(index) {
      if (stopped) return;
      var from = updatePagePosition() - rubberX() / DESIGN_W;
      var n = Math.round(Number(index));
      if (!isFinite(n)) n = 1;
      var next = clamp(n, 0, 4);
      var changed = next !== page;
      var continuing = !changed && pageTransition && pageTransition.to === next && !dragX;
      page = next;
      scrollY = 0;
      scrollOrigin = 0;
      pull = 0;
      dragX = 0;
      axis = null;
      mode = null;
      remeasure();
      if (!continuing) {
        if (Math.abs(from - next) < 0.001) {
          pageTransition = null;
          pagePosition = next;
        } else {
          pagePosition = from;
          pageTransition = { from: from, to: next, start: clock() };
        }
      }
      if (changed) emitPage();
      requestDraw();
    }

    function getState() {
      return {
        page: page,
        scrollY: page <= 1 ? 0 : scrollY,
        refreshing: refreshing,
        pull: pull
      };
    }

    function handleTap(x, y) {
      if (page === 0) return;
      var i;
      for (i = 0; i < 5; i++) {
        if (contains(dotHit(i), x, y)) {
          goTo(i);
          return;
        }
      }
      if (page !== 1) return;
      for (i = 0; i < 3; i++) {
        if (contains(columnRect(i), x, y)) {
          goTo(i + 2);
          return;
        }
      }
    }

    function finish(commit) {
      if (startX == null) return;
      var sx = startX;
      var ax = axis;
      var gestureMode = mode;
      var pulled = pull;
      var origin = scrollOrigin;
      var x = lastX;
      startX = null;
      startY = null;
      activeId = null;
      axis = null;
      mode = null;
      if (!commit) {
        pull = 0;
        goTo(page);
        scrollY = origin;
        scrollOrigin = origin;
        requestDraw();
        return;
      }
      pull = 0;
      if (ax === 'h') {
        var dx = x - sx;
        var step = Math.abs(dx) >= SWIPE ? (dx < 0 ? 1 : -1) : 0;
        goTo(page + step);
        return;
      }
      dragX = 0;
      if (ax === 'v') {
        if (gestureMode === 'pull' && pulled >= PULL) beginRefresh(scopeFor(page));
        else requestDraw();
        return;
      }
      handleTap(x, lastY);
    }

    function track(e) {
      if (activeId == null || !e) return false;
      if (e.pointerId === undefined) return activeId === 0;
      return e.pointerId === activeId;
    }

    function applyPoint(p) {
      lastX = p.x;
      lastY = p.y;
      if (startX == null) return;
      var dx = p.x - startX;
      var dy = p.y - startY;
      if (!axis) {
        if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
        if (axis === 'h') {
          updatePagePosition();
          pageTransition = null;
        }
        if (axis === 'v') mode = (scrollY === 0 && dy > 0 && !refreshing) ? 'pull' : 'scroll';
      }
      if (axis === 'h') {
        dragX = dx;
        requestDraw();
        return;
      }
      if (mode === 'pull') {
        pull = dy > 0 ? dy : 0;
        requestDraw();
        return;
      }
      if (maxScroll > 0) {
        scrollY = clamp(scrollOrigin - dy, 0, maxScroll);
        requestDraw();
      }
    }

    function toDesign(e) {
      var size = metrics();
      var x;
      var y;
      if (canvas.getBoundingClientRect) {
        var rect = canvas.getBoundingClientRect();
        var rw = rect.width || size.w;
        var rh = rect.height || size.h;
        x = ((e.clientX || 0) - (rect.left || 0)) * size.w / rw;
        y = ((e.clientY || 0) - (rect.top || 0)) * size.h / rh;
      } else {
        x = e.offsetX != null ? e.offsetX : (e.clientX || 0);
        y = e.offsetY != null ? e.offsetY : (e.clientY || 0);
      }
      return { x: x * DESIGN_W / size.w, y: y * DESIGN_H / size.h };
    }

    function onDown(e) {
      if (stopped || !e || e.isPrimary === false) return;
      if (e.button != null && e.button !== 0) return;
      if (activeId != null) return;
      if (e.preventDefault) e.preventDefault();
      activeId = e.pointerId === undefined ? 0 : e.pointerId;
      var p = toDesign(e);
      startX = p.x;
      startY = p.y;
      lastX = p.x;
      lastY = p.y;
      axis = null;
      mode = null;
      dragX = 0;
      scrollOrigin = scrollY;
      remeasure();
      if (canvas.setPointerCapture && e.pointerId !== undefined) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      }
    }

    function onMove(e) {
      if (!track(e) || startX == null) return;
      if (e.preventDefault) e.preventDefault();
      applyPoint(toDesign(e));
    }

    function onUp(e) {
      if (!track(e)) return;
      applyPoint(toDesign(e));
      finish(true);
    }

    function onCancel(e) {
      if (activeId == null) return;
      if (e && e.pointerId !== undefined && e.pointerId !== activeId) return;
      finish(false);
    }

    function onLost(e) {
      if (activeId == null) return;
      if (e && e.pointerId !== undefined && e.pointerId !== activeId) return;
      finish(false);
    }

    function onLeave(e) {
      if (!track(e)) return;
      if (canvas.hasPointerCapture && e && e.pointerId !== undefined) {
        try { if (canvas.hasPointerCapture(e.pointerId)) return; } catch (err) {}
      }
      finish(false);
    }

    function onWheel(e) {
      if (stopped || page <= 1 || !e) return;
      remeasure();
      if (maxScroll <= 0) return;
      var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      var rh = rect && rect.height ? rect.height : DESIGN_H;
      var dy = (e.deltaY || 0) * DESIGN_H / rh;
      if (!dy) return;
      scrollY = clamp(scrollY + dy, 0, maxScroll);
      requestDraw();
      if (e.preventDefault) e.preventDefault();
    }

    function onKey(e) {
      if (stopped || !e) return;
      var target = e.target;
      var body = typeof document !== 'undefined' ? document.body : null;
      var rootEl = typeof document !== 'undefined' ? document.documentElement : null;
      if (target && target !== canvas && target !== body && target !== rootEl) return;
      if (e.key === 'ArrowRight') { goTo(page + 1); if (e.preventDefault) e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { goTo(page - 1); if (e.preventDefault) e.preventDefault(); }
      else if (e.key === 'Home') { goTo(0); if (e.preventDefault) e.preventDefault(); }
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && page >= 2) {
        remeasure();
        scrollY = clamp(scrollY + (e.key === 'ArrowDown' ? 48 : -48), 0, maxScroll);
        requestDraw();
        if (e.preventDefault) e.preventDefault();
      }
    }

    function listen(target, type, fn) {
      if (!target || !target.addEventListener) return;
      try {
        target.addEventListener(type, fn, { passive: false });
        bound.push([target, type, fn, { passive: false }]);
      } catch (err) {
        target.addEventListener(type, fn, false);
        bound.push([target, type, fn, false]);
      }
    }

    function destroy() {
      if (stopped) return;
      stopped = true;
      refreshToken += 1;
      refreshing = false;
      pull = 0;
      clearRecoveryTimer();
      if (rafId && view.cancelAnimationFrame) {
        try { view.cancelAnimationFrame(rafId); } catch (err) {}
      }
      rafId = 0;
      queued = false;
      var i;
      for (i = 0; i < bound.length; i++) {
        var item = bound[i];
        if (!item[0].removeEventListener) continue;
        try { item[0].removeEventListener(item[1], item[2], item[3]); }
        catch (err) {
          try { item[0].removeEventListener(item[1], item[2], false); } catch (err2) {}
        }
      }
      bound.length = 0;
      homeImageLoaders.forEach(function (img) { img.onload = null; img.onerror = null; });
      homeImageLoaders.length = 0;
      homeImages = {};
      backgroundLoaders.forEach(function (img) { img.onload = null; img.onerror = null; });
      backgroundLoaders.length = 0;
      backgrounds = {};
      customBackgrounds = {};
      pageTransition = null;
      activeId = null;
      startX = null;
      if (canvas.__hoyoCardControllerDestroy === destroy) {
        try { delete canvas.__hoyoCardControllerDestroy; } catch (err) { canvas.__hoyoCardControllerDestroy = null; }
      }
    }

    if (options.initialSnapshot != null) applySnapshot(options.initialSnapshot, true);
    listen(canvas, 'pointerdown', onDown);
    listen(canvas, 'pointermove', onMove);
    listen(canvas, 'pointerup', onUp);
    listen(canvas, 'pointercancel', onCancel);
    listen(canvas, 'lostpointercapture', onLost);
    listen(canvas, 'pointerleave', onLeave);
    listen(canvas, 'wheel', onWheel);
    if (typeof document !== 'undefined') listen(document, 'keydown', onKey);
    canvas.__hoyoCardControllerDestroy = destroy;
    armRecoveryTimer();
    requestDraw();
    loadHomeImages();

    return {
      setSnapshot: setSnapshot,
      setBackgrounds: setBackgrounds,
      goTo: goTo,
      getState: getState,
      destroy: destroy
    };
  }

  root.HoyoCard = { mount: mount };
  if (typeof window !== 'undefined' && window !== root) window.HoyoCard = root.HoyoCard;
})();
