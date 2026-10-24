# Rear Card Bridge API 2 模块

## 运行结构

模块由卡片绘制、设置页和后台刷新入口组成。设置页及后台通过宿主的 `bridge.net.request` 访问米游社官方接口，使用 `bridge.storage` 保存账号与便笺，使用 `bridge.card` 发布展示快照。

`lib/hoyo.mjs` 和 `lib/service.mjs` 为协议与状态核心；`bridge/runtime.mjs` 提供宿主网络和存储适配。安装模块不运行 Node、本地 HTTP 服务或账号中转服务。

## 模块描述

模块描述由 `scripts/build-module.mjs` 生成：

```json
{
  "id": "dev.finall.hoyolab",
  "name": "米游社",
  "version": "0.1.8",
  "versionCode": 9,
  "apiVersion": 2,
  "author": "finall1008",
  "capabilities": ["network", "storage"],
  "background": {"intervalMinutes": 15}
}
```

## 构建与包结构

```sh
npm ci
npm --prefix tools/card-build ci
node scripts/build-home-assets.mjs
npm run build:bridge
node scripts/build-module.mjs
node tools/card-build/bin/card-build.js dist/module dist/rear-card-hoyolab-0.1.8.zip
```

构建过程：

1. `build-home-assets.mjs` 将三个体力 PNG 编成离线素材脚本。
2. `build:bridge` 在 `dist/bridge/` 输出设置页和后台脚本，设置页使用 `hoyoRuntime.request`。
3. `build-module.mjs` 在 `dist/module/` 组装清单、卡片、设置页和后台入口。
4. `tools/card-build` 编译 `card/**/*.js` 的 async/await 并生成安装 ZIP；设置页和后台脚本保持 WebView 可执行格式。

```text
module.json
card/
  index.html
  main.js
webroot/
  index.html
  runtime.js
  app.js
  style.css
  source.tar.gz
  LICENSE
  NOTICE
  THIRD_PARTY_LICENSES.txt
background/
  main.js
```

`card/main.js` 包含绘制代码、三个体力图片和桥端卡片入口。图片解码需宿主提供 `Image` 和 Canvas `drawImage`，缺少图片能力时卡片仍绘制数值与布局。`webroot/index.html` 的首个脚本是 `bridge-shim.js`，由宿主提供。直接双击设置页 HTML 不能替代宿主环境。

源码包包含运行、构建和文档所需文件，排除 `.local/`、`.git/`、`node_modules/` 和 `dist/`。依赖通过各目录的锁文件恢复。

## 网络

桥网络适配转交方法、URL、JSON body、Cookie、DS、UA 和 x-rpc 请求头，设置 `cookies:false`、`redirect:'manual'`、`responseType:'text'`。

请求使用 `Accept-Encoding: identity`，避免将宿主未解码的 gzip/br 字节作为 JSON 解析。认证头保持协议定义；3xx 返回错误，不切换登录协议。

国服认证、签名、设备指纹和 full → widget 的请求规则见 [UPSTREAM.md](UPSTREAM.md)。

## 存储

| 键 | 内容 |
| --- | --- |
| `hoyolab.identity` | 稳定设备 UUID 和指纹刷新基准 |
| `hoyolab.auth` | Token、Cookie、待完成认证状态、角色和每角色指纹 |
| `hoyolab.settings` | 角色选择、每页背景模式（default/custom） |
| `hoyolab.background.<page>` | 该页自定义背景的 base64 + 模糊背板；无自定义时不写 |
| `hoyolab.note.<game>` | 各游戏便笺、所属账号实例与角色 |

认证步骤等待持久化后返回，设置页重新打开可从存储恢复。后台独立上下文读取同一份数据，只更新便笺和快照；退出或换角期间到达的响应不能恢复已失效账号。

存储依赖宿主模块目录隔离，不提供额外加密。账号凭据不进入日志或展示快照；卸载模块会删除模块数据。

## 后台与刷新

- 宿主调度后台 `refresh()`，默认间隔 15 分钟；启用状态和间隔在卡片桥设置，设置网页只保存角色选择。
- 后台只查询已有认证和选定角色，不进行扫码、角色发现或设备指纹重新生成。
- 后台网络请求超时为 3 秒，三款游戏按顺序查询；完整接口失败时可能再请求 widget 接口。实际执行受系统调度、省电策略和宿主任务时限影响。
- 手动刷新等待 `bridge.card.saveSnapshot()` 完成后返回展示快照。
- 卡片入口同步读取已有快照，并在宿主 `bridge.card.onRefresh` 通知时重新读取；静止时无常驻帧循环。
- 单游戏失败保留对应成功缓存；后台全部失败保留已有快照；清除账号会清空展示数据。

## 验证范围

测试提供契约内的 net/storage/card 方法，覆盖认证恢复、前台与后台共享存储、退出期间的在途响应、快照内容和失败缓存。

构建检查覆盖浏览器依赖封装、模块结构、脚本编译及源码归档。布局与手势可在浏览器验证；手机安装、真实米游社认证、图片支持及背屏重绘属于真机验收范围。
