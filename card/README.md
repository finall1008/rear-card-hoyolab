# 背屏卡片绘制

`card.js` 是经典脚本，只负责 Canvas 绘制和指针手势。登录、网络和持久化由调用方提供；本文件不读写 `bridge.storage`，也不发起请求。

## 挂载

```js
var card = globalThis.HoyoCard.mount({
  canvas: canvas,                  // 必填，2d 上下文
  initialSnapshot: snapshot,       // schema 1；可为 null。首帧只画它
  refresh: function (scope) {},    // 'all' | 'genshin' | 'hsr' | 'zzz'
                                   // 必须在持久化完成后才 resolve，并返回新快照
  onPageChange: function (index) {},
  onStatus: function (status) {},  // 可选
  now: function () { return Date.now(); }
});
```

返回 `{ setSnapshot(snapshot), goTo(index), getState(), destroy() }`。

`getState()` 为 `{ page, scrollY, refreshing, pull }`。`pull` 是设计坐标下的下拉距离，松手后为 0。

`onPageChange` 收到页码 `0..3`（总览、原神、星穹铁道、绝区零），首次挂载不回调。

挂载同步记下快照并排一次 `requestAnimationFrame`，不等待 `refresh`。绘制统一通过按需申请的帧执行，图片解码完成也会触发重绘。静止时不循环；刷新转圈期间持续申请帧。

## 画面

- 体力使用 `assets/` 的三张真实游戏资源 PNG，来源和版权见 `assets/sources.json`。先加载 `home-assets.js`，再挂载 `card.js`；桥入口已包含两者。运行 `node scripts/build-home-assets.mjs` 可从原图重建离线素材脚本。图片不阻塞首帧，解码后按需重绘；首页和详情不展示默认角色提示，仍不把 widget 来源的昵称/UID 当作所选角色信息展示。

- 布局基准 912×596。实际尺寸优先 `window.CANVAS_W` / `CANVAS_H`，其次是 canvas 宽高，再回退到 912×596。指针先按元素盒逆算到该尺寸，再逆算回设计坐标。
- 首页三列在右侧安全区 x=318..890，各列展示体力大数字、回满时间和每日进度区。点击列进入该游戏详情。
- 三游戏详情统一为浅色两栏组件，按首页配色：左侧体力和每日进度，右侧最多六项「今日一览」；仅体力使用真实游戏图标。星铁和绝区零的每日三位数进度单独占一行，避免挤压标签。一屏放下，不纵向滚动，下拉刷新当前游戏。
- 首页下拉范围为 `all`，详情为当前游戏。提示为「下拉刷新全部」「下拉刷新原神」「下拉刷新星穹铁道」「下拉刷新绝区零」；超过 70 为「松开刷新」。
- 数值 `null` 画成「—」，`0` 仍画成 0。清单行只画快照里给出的项。失败时保留快照里的上次数值，并显示 `error`。
- `widgetDefaultRole === true` 或 `source === 'widget'` 时不画昵称、不画 UID，只画游戏名，不显示默认角色提示。
- 回满时间按 `recoveryAt`（毫秒或 ISO）和 `now()` 计算。过去为「已回满」，将来为当地时刻。不按秒重绘。

## 手势

指针交互只监听 pointer 事件，不注册 click / mouse / touch。单指，能捕获就捕获。移动 12 锁定方向，横滑 60 翻页，下拉 70 刷新。`pointercancel` 和 `lostpointercapture` 不翻页、不刷新，并撤回这一次滚动。页码点的点击区大于圆点本身。

桌面预览额外响应滚轮和方向键；背屏宿主没有这些事件时不依赖它们。
