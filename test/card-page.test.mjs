import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../bridge/card-main.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '');

test('card entry restores the snapshot page and saves every flip before asynchronous background reads', async () => {
  let snapshot = { schema: 1, games: {}, page: 0 };
  const storage = new Map();
  let options;
  const bridge = {
    storage: {
      get: async key => storage.get(key) ?? null,
      set: async (key, value) => { storage.set(key, value); },
    },
    card: {
      readSnapshot: () => snapshot,
      saveSnapshot: async value => { snapshot = value; },
      onRefresh: () => {},
    },
    log: { error: message => assert.fail(message) },
  };
  const context = {
    bridge, setTimeout, clearTimeout,
    document: { getElementById: () => ({}) },
    bridgeCardProvider: () => ({ initialSnapshot: snapshot }),
    HoyoCard: {
      mount(value) {
        options = value;
        return { getState: () => ({ page: value.initialPage }), setBackgrounds() {} };
      },
    },
  };
  vm.runInNewContext(source, context);
  assert.equal(options.initialPage, 0);
  options.onPageChange(4);
  assert.equal(snapshot.page, 4, '页码必须立即进入宿主快照');
  assert.equal(storage.get('hoyolab.card.page'), 4);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(snapshot.page, 4, '异步背景缓存不能重置页码');
});

test('tapping empty space during a page slide does not leave it halfway', async () => {
  let now = 0;
  let frameId = 0;
  const frames = new Map();
  const events = {};
  const noop = () => {};
  const ctx = new Proxy({
    measureText: text => ({ width: String(text).length * 16 }),
    createLinearGradient: () => ({ addColorStop: noop }),
  }, { get: (target, key) => target[key] ?? noop });
  const canvas = {
    width: 912, height: 596, getContext: () => ctx,
    addEventListener: (type, fn) => { events[type] = fn; },
    removeEventListener: noop,
  };
  const context = {
    requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  vm.runInNewContext(await readFile(new URL('../card/card.js', import.meta.url), 'utf8'), context);
  const card = context.HoyoCard.mount({ canvas, now: () => now });
  function draw(time) {
    now = time;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(fn => fn(time));
  }
  draw(0);
  card.goTo(2);
  draw(100);
  const tap = { pointerId: 1, clientX: 100, clientY: 300 };
  events.pointerdown(tap);
  events.pointerup(tap);
  draw(150);
  assert.ok(frames.size > 0, '未完成的滑动应继续申请帧');
  draw(400);
  assert.equal(card.getState().page, 2);
  assert.equal(frames.size, 0, '滑动结束后停止申请帧');
  card.destroy();
});
