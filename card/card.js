// SPDX-License-Identifier: AGPL-3.0-or-later
// Rear-screen Hoyolab card. Classic script: Canvas 2D and pointer events only.
// The provider owns network, storage and the persisted snapshot. This file only draws.
(function () {
  'use strict';

  var DESIGN_W = 912;
  var DESIGN_H = 596;
  var SAFE_L = 318;
  var SAFE_R = 890;
  var COL_GAP = 12;
  var COL_TOP = 76;
  var COL_BOTTOM = 502;
  var SCROLL_BOTTOM = 508;
  var DOT_GAP = 86;
  var LOCK = 12;
  var SWIPE = 60;
  var PULL = 70;
  var CARD_R = 868;
  var BANNER_TOP = 112;
  var BANNER_H = 44;

  var GAMES = [
    { id: 'genshin', code: 'GI', name: '原神', hint: '下拉刷新原神', primary: '原粹树脂', daily: '每日委托', accent: '#3ee0c5', accentSoft: 'rgba(62,224,197,0.16)' },
    { id: 'hsr', code: 'HSR', name: '星穹铁道', hint: '下拉刷新星穹铁道', primary: '开拓力', daily: '每日实训', accent: '#ff8d42', accentSoft: 'rgba(255,141,66,0.16)' },
    { id: 'zzz', code: 'ZZZ', name: '绝区零', hint: '下拉刷新绝区零', primary: '电量', daily: '每日活跃', accent: '#c084fc', accentSoft: 'rgba(192,132,252,0.18)' }
  ];
  var DOT_CY = 546;
  var WIDGET_MARK = '组件默认角色';

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
    return (SAFE_L + SAFE_R) / 2 + (index - 1.5) * DOT_GAP;
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
    var page = 0;
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

    function clock() {
      if (options && typeof options.now === 'function') {
        try {
          var value = options.now();
          if (typeof value === 'number' && isFinite(value)) return value;
        } catch (err) {}
      }
      return Date.now();
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

    function homeSub(game) {
      if (widgetRole(game)) return WIDGET_MARK;
      var nick = nicknameText(game);
      return nick || '—';
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
      if (page === 1) return GAMES[0].hint;
      if (page === 2) return GAMES[1].hint;
      if (page === 3) return GAMES[2].hint;
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
      if (page <= 0) return '总览';
      var info = GAMES[page - 1];
      var game = gameById(info.id);
      if (game && game.name != null && String(game.name) !== '') return String(game.name);
      return info.name;
    }

    function scopeFor(index) {
      if (index === 1) return 'genshin';
      if (index === 2) return 'hsr';
      if (index === 3) return 'zzz';
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

    function drawText(font, color, align, baseline, value, x, y, maxW) {
      var raw = value == null ? '' : String(value);
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      var shown = typeof maxW === 'number' ? fitText(raw, maxW) : raw;
      ctx.fillText(shown, Math.round(x), Math.round(y));
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

    function paintCard(x, y, w, h, accent, warn) {
      round(x, y, w, h, 18);
      ctx.fillStyle = '#221e1a';
      ctx.fill();
      ctx.save();
      round(x, y, w, h, 18);
      ctx.clip();
      ctx.fillStyle = accent;
      ctx.fillRect(x, y, w, 3);
      ctx.restore();
      round(x, y, w, h, 18);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = warn ? 'rgba(240,178,122,0.55)' : 'rgba(255,236,214,0.10)';
      ctx.stroke();
    }

    function paintBar(x, y, w, h, ratio, color) {
      round(x, y, w, h, h / 2);
      ctx.fillStyle = 'rgba(255,248,240,0.10)';
      ctx.fill();
      if (ratio != null && ratio > 0) {
        var fillW = Math.max(h, w * ratio);
        if (fillW > w) fillW = w;
        round(x, y, fillW, h, h / 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    }

    function paintColumn(index) {
      var info = GAMES[index];
      var game = gameById(info.id);
      var rect = columnRect(index);
      var primary = game && game.primary ? game.primary : null;
      var daily = game && game.daily ? game.daily : null;
      var errored = !!(game && game.status === 'error');
      paintCard(rect.x, rect.y, rect.w, rect.h, info.accent, errored);
      ctx.save();
      round(rect.x, rect.y, rect.w, rect.h, 18);
      ctx.clip();
      var x = rect.x + 14;
      var inner = rect.w - 28;
      var y = rect.y + 32;
      drawText('700 28px sans-serif', '#f7f1e8', 'left', 'middle', game && game.name ? String(game.name) : info.name, x, y, inner);
      y += 38;
      drawText('600 20px sans-serif', widgetRole(game) ? info.accent : '#d9cec0', 'left', 'middle', homeSub(game), x, y, inner);
      y += 42;
      drawText('600 20px sans-serif', '#b7ab9e', 'left', 'middle', metricLabel(primary, info.primary), x, y, inner);
      y += 50;
      var curText = fitText(displayScalar(primary && primary.current), inner - 58);
      ctx.font = '700 54px sans-serif';
      var curW = ctx.measureText(curText).width;
      drawText('700 54px sans-serif', '#f7f1e8', 'left', 'middle', curText, x, y, inner);
      var maxBase = displayScalar(primary && primary.max);
      var maxFonts = ['600 22px sans-serif', '600 20px sans-serif', '600 18px sans-serif'];
      var maxDrawn = false;
      for (var mi = 0; mi < maxFonts.length && !maxDrawn; mi++) {
        var mt = (mi === 0 ? '/ ' : '/') + maxBase;
        ctx.font = maxFonts[mi];
        if (curW + 6 + ctx.measureText(mt).width <= inner) {
          drawText(maxFonts[mi], '#d9cec0', 'left', 'middle', mt, x + curW + 6, y + 10, inner - curW - 6);
          maxDrawn = true;
        }
      }
      y += 42;
      paintBar(x, y, inner, 12, fillRatio(primary && primary.current, primary && primary.max), info.accent);
      y += 24;
      var banner = bannerText(game);
      var recText = banner || recoveryLine(primary);
      var recH = 52;
      round(x, y, inner, recH, 14);
      ctx.fillStyle = errored ? 'rgba(240,178,122,0.10)' : info.accentSoft;
      ctx.fill();
      drawText('700 24px sans-serif', banner ? (errored ? '#f0b27a' : '#d9cec0') : info.accent, 'center', 'middle', recText, x + inner / 2, y + recH / 2, inner - 16);
      y += recH + 22;
      var dailyLabel = metricLabel(daily, info.daily);
      var dailyValue = displayScalar(daily && daily.current) + '/' + displayScalar(daily && daily.max);
      drawText('600 15px sans-serif', '#b7ab9e', 'left', 'middle', dailyLabel, x, y, inner * 0.44);
      ctx.font = '700 22px sans-serif';
      ctx.fillStyle = '#f7f1e8';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(dailyValue, Math.round(x + inner), Math.round(y - 1));
      y += 32;
      paintBar(x, y, inner, 12, fillRatio(daily && daily.current, daily && daily.max), info.accent);
      var reward = rewardText(daily);
      var note = reward != null ? { text: reward, color: rewardColor(reward) } : null;
      var footY = rect.y + rect.h - 38;
      ctx.fillStyle = 'rgba(255,244,230,0.08)';
      ctx.fillRect(x, footY - 36, inner, 1);
      var noteOrBanner = banner ? null : (note && note.text);
      if (noteOrBanner) {
        drawText('700 20px sans-serif', note.color, 'left', 'middle', noteOrBanner, x, footY - 10, inner);
      }
      drawText('500 16px sans-serif', '#b7ab9e', 'left', 'middle', formatUpdated(game && game.updatedAt), x, footY + 12, inner);
      ctx.restore();
    }

    function paintPill(x, y, label, info) {
      ctx.font = '700 20px sans-serif';
      var w = ctx.measureText(label).width + 28;
      round(x, y - 16, w, 32, 16);
      ctx.fillStyle = info.accentSoft;
      ctx.fill();
      drawText('700 20px sans-serif', info.accent, 'center', 'middle', label, x + w / 2, y, null);
    }

    function paintDetailChrome(info, game) {
      var bits = [];
      var nick = nicknameText(game);
      var uid = uidLine(game);
      if (widgetRole(game)) paintPill(SAFE_L, 84, WIDGET_MARK, info);
      else {
        if (nick) bits.push(nick);
        if (uid) bits.push(uid);
        drawText('600 20px sans-serif', '#d9cec0', 'left', 'middle', bits.length ? bits.join(' · ') : '—', SAFE_L, 84, 400);
      }
      drawText('600 20px sans-serif', '#b7ab9e', 'right', 'middle', '更新 ' + formatUpdated(game && game.updatedAt), SAFE_R, 84, 200);
      var banner = bannerText(game);
      if (!banner) return;
      round(SAFE_L, BANNER_TOP, SAFE_R - SAFE_L, BANNER_H, 12);
      ctx.fillStyle = game && game.status === 'error' ? 'rgba(240,178,122,0.14)' : 'rgba(255,248,240,0.06)';
      ctx.fill();
      drawText('600 22px sans-serif', game && game.status === 'error' ? '#f0b27a' : '#d9cec0', 'left', 'middle', banner, SAFE_L + 16, BANNER_TOP + BANNER_H / 2, SAFE_R - SAFE_L - 32);
    }

    function paintDetailPrimary(info, game, y, w, h) {
      var primary = game && game.primary ? game.primary : null;
      var daily = game && game.daily ? game.daily : null;
      paintCard(SAFE_L, y, w, h, info.accent, false);
      var x = SAFE_L + 20;
      var inner = w - 40;
      drawText('600 22px sans-serif', '#b7ab9e', 'left', 'middle', metricLabel(primary, info.primary), x, y + 36, inner);
      var curText = fitText(displayScalar(primary && primary.current), inner - 84);
      ctx.font = '700 68px sans-serif';
      var curW = ctx.measureText(curText).width;
      drawText('700 68px sans-serif', '#f7f1e8', 'left', 'middle', curText, x, y + 108, inner);
      var maxBase = displayScalar(primary && primary.max);
      var maxFonts = ['600 30px sans-serif', '600 24px sans-serif', '600 20px sans-serif'];
      var maxDrawn = false;
      for (var mi = 0; mi < maxFonts.length && !maxDrawn; mi++) {
        var mt = (mi === 0 ? '/ ' : '/') + maxBase;
        ctx.font = maxFonts[mi];
        if (curW + 6 + ctx.measureText(mt).width <= inner) {
          drawText(maxFonts[mi], '#d9cec0', 'left', 'middle', mt, x + curW + 6, y + 118, inner - curW - 6);
          maxDrawn = true;
        }
      }
      paintBar(x, y + 152, inner, 12, fillRatio(primary && primary.current, primary && primary.max), info.accent);
      drawText('600 20px sans-serif', info.accent, 'left', 'middle', recoveryLine(primary), x, y + 186, inner);
      // 每日块锚定卡底；高度有限时压缩分隔线和空隙
      var dy = y + h - 128;
      var reward = rewardText(daily);
      if (reward != null && dy > y + 210) {
        ctx.fillStyle = 'rgba(255,244,230,0.08)';
        ctx.fillRect(x, dy - 26, inner, 1);
      }
      var detailDailyLabel = metricLabel(daily, info.daily);
      var detailDailyValue = displayScalar(daily && daily.current) + '/' + displayScalar(daily && daily.max);
      drawText('600 20px sans-serif', '#b7ab9e', 'left', 'middle', detailDailyLabel, x, dy, inner * 0.5);
      ctx.font = '700 26px sans-serif';
      ctx.fillStyle = '#f7f1e8';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(detailDailyValue, Math.round(x + inner), Math.round(dy - 1));
      paintBar(x, dy + 34, inner, 12, fillRatio(daily && daily.current, daily && daily.max), info.accent);
      if (reward != null) drawText('700 22px sans-serif', rewardColor(reward), 'left', 'middle', reward, x, dy + 66, inner);
    }

    function paintList(info, game, y, w, h) {
      var x = SAFE_L + w + 16;
      round(x, y, CARD_R - x, h, 16);
      ctx.fillStyle = '#1c1916';
      ctx.fill();
      var pad = 18;
      var ix = x + pad;
      var inner = CARD_R - x - pad * 2;
      var compact = h < 360;
      var rowH = compact ? 42 : 48;
      var firstRow = y + (compact ? 74 : 80);
      var maxRows = Math.max(1, Math.floor((y + h - 14 - firstRow) / rowH));
      var listFont = compact ? '600 20px sans-serif' : '600 24px sans-serif';
      var valueFont = compact ? '600 20px sans-serif' : '600 24px sans-serif';
      drawText('700 26px sans-serif', info.accent, 'left', 'middle', '今日一览', ix, y + (compact ? 32 : 36), inner);
      var rows = game && Array.isArray(game.list) ? game.list.slice(0, maxRows) : [];
      if (!rows.length) {
        drawText(listFont, '#b7ab9e', 'left', 'middle', '—', ix, firstRow, inner);
        return;
      }
      var i;
      for (i = 0; i < rows.length; i++) {
        var row = rows[i] || {};
        var ry = firstRow + i * rowH;
        var label = row.label == null || row.label === '' ? '—' : String(row.label);
        var value = displayScalar(row.value);
        var vFont = valueFont;
        ctx.font = vFont;
        if (ctx.measureText(value).width > inner * 0.42) vFont = compact ? '600 16px sans-serif' : '600 18px sans-serif';
        ctx.font = vFont;
        var valueW = Math.min(inner * 0.5, ctx.measureText(value).width + 4);
        var labelW = inner - valueW - 10;
        drawText(listFont, '#d9cec0', 'left', 'middle', label, ix, ry, labelW);
        drawText(vFont, row.highlight ? info.accent : '#f7f1e8', 'right', 'middle', value, ix + inner, ry, valueW);
        if (i < rows.length - 1) {
          ctx.fillStyle = 'rgba(255,244,230,0.06)';
          ctx.fillRect(ix, ry + Math.round(rowH / 2) + 2, inner, 1);
        }
      }
    }

    function paintDetail() {
      var info = GAMES[page - 1];
      var game = gameById(info.id);
      paintDetailChrome(info, game);
      var top = scrollTopFor(game);
      var h = SCROLL_BOTTOM - top;
      var w = Math.round((CARD_R - SAFE_L - 16) * 0.44);
      paintDetailPrimary(info, game, top, w, h);
      paintList(info, game, top, w, h);
    }

    function paintSpinner(x, y) {
      var angle = ((clock() % 1000) / 1000) * Math.PI * 2;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0.2, Math.PI * 1.45);
      ctx.strokeStyle = '#f7f1e8';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    function paintChrome() {
      drawText('700 36px sans-serif', '#f7f1e8', 'left', 'middle', pageTitle(), SAFE_L, 38, 220);
      ctx.font = '700 36px sans-serif';
      var titleW = ctx.measureText(fitText(pageTitle(), 220)).width;
      var hint = hintString();
      var hintColor = '#e9dfd1';
      if (fault && pull <= 0 && !refreshing) hintColor = '#f0b27a';
      if (pull >= PULL || refreshing) hintColor = '#f7f1e8';
      var hintX = SAFE_L + titleW + 18;
      var hintMax = SAFE_R - hintX - (refreshing ? 28 : 12);
      drawText('600 16px sans-serif', hintColor, 'left', 'middle', hint, hintX, 40, hintMax);
      if (refreshing) paintSpinner(SAFE_R - 12, 40);
      if (pull > 0) {
        ctx.fillStyle = page > 0 ? GAMES[page - 1].accent : '#f3eadf';
        ctx.fillRect(SAFE_L, 62, (SAFE_R - SAFE_L) * Math.min(1, pull / PULL), 3);
      }
    }

    function paintDots() {
      var i;
      for (i = 0; i < 4; i++) {
        var cx = dotCenter(i);
        var active = i === page;
        var color = active ? (i === 0 ? '#f7f1e8' : GAMES[i - 1].accent) : 'rgba(255,244,230,0.28)';
        ctx.beginPath();
        ctx.arc(cx, DOT_CY, active ? 8 : 5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    }

    function paintBackground() {
      if (ctx.createLinearGradient) {
        var gradient = ctx.createLinearGradient(0, 0, DESIGN_W, DESIGN_H);
        gradient.addColorStop(0, '#141210');
        gradient.addColorStop(1, '#1b1714');
        ctx.fillStyle = gradient;
      } else ctx.fillStyle = '#141210';
      ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
    }

    function dampPull() {
      if (pull <= 0) return 0;
      return Math.min(36, pull * 0.32);
    }

    function rubberX() {
      if (!dragX) return 0;
      var edge = (page <= 0 && dragX > 0) || (page >= 3 && dragX < 0);
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

    function paint() {
      var size = metrics();
      ctx.save();
      try {
        ctx.globalAlpha = 1;
        if (ctx.setTransform) ctx.setTransform(size.w / DESIGN_W, 0, 0, size.h / DESIGN_H, 0, 0);
        else if (ctx.scale) ctx.scale(size.w / DESIGN_W, size.h / DESIGN_H);
        paintBackground();
        paintChrome();
        ctx.save();
        try {
          ctx.translate(rubberX(), dampPull());
          if (page <= 0) {
            var i;
            for (i = 0; i < 3; i++) paintColumn(i);
          } else paintDetail();
        } finally {
          ctx.restore();
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
        if (!stopped && refreshing) requestDraw();
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

    function goTo(index) {
      if (stopped) return;
      var n = Math.round(Number(index));
      if (!isFinite(n)) n = 0;
      var next = clamp(n, 0, 3);
      var changed = next !== page;
      page = next;
      scrollY = 0;
      scrollOrigin = 0;
      pull = 0;
      dragX = 0;
      axis = null;
      mode = null;
      remeasure();
      if (changed) emitPage();
      requestDraw();
    }

    function getState() {
      return {
        page: page,
        scrollY: page <= 0 ? 0 : scrollY,
        refreshing: refreshing,
        pull: pull
      };
    }

    function handleTap(x, y) {
      var i;
      for (i = 0; i < 4; i++) {
        if (contains(dotHit(i), x, y)) {
          goTo(i);
          return;
        }
      }
      if (page !== 0) return;
      for (i = 0; i < 3; i++) {
        if (contains(columnRect(i), x, y)) {
          goTo(i + 1);
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
      dragX = 0;
      if (!commit) {
        scrollY = origin;
        pull = 0;
        requestDraw();
        return;
      }
      pull = 0;
      if (ax === 'h') {
        var dx = x - sx;
        if (Math.abs(dx) >= SWIPE) goTo(page + (dx < 0 ? 1 : -1));
        else requestDraw();
        return;
      }
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
      if (stopped || page <= 0 || !e) return;
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
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && page > 0) {
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

    return {
      setSnapshot: setSnapshot,
      goTo: goTo,
      getState: getState,
      destroy: destroy
    };
  }

  root.HoyoCard = { mount: mount };
  if (typeof window !== 'undefined' && window !== root) window.HoyoCard = root.HoyoCard;
})();
