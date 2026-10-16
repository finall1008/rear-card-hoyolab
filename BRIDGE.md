# 卡片桥 API 2 接入

## 不需要本地服务

电脑原型保持原样：浏览器 → 本机 Node 调试宿主 → 米游社。

桥端是另一份构建产物：设置页/桥后台 WebView → **bridge.net.request → 米游社官方接口**。没有 HTTP daemon、localhost、Node、电脑或额外常驻进程，也不让普通浏览器 fetch 去发送受限 Cookie/UA 请求头。

两边共享同一份 [认证协议](lib/hoyo.mjs) 与 [状态机](lib/service.mjs)。[桥适配器](bridge/runtime.mjs) 只替换宿主能力，不改 App QR、SToken、Cookie、DS、设备 FP 和 full→widget 调用顺序。

## 构建

```bash
npm ci
npm run build:bridge
```

输出：

```text
dist/bridge/
├── webroot/
│   ├── index.html          # 第一个脚本是宿主提供的 bridge-shim.js
│   ├── runtime.js          # 浏览器自包含包：认证核心 + QR + MD5 + 桥适配
│   ├── app.js
│   ├── style.css
│   └── source.tar.gz       # 对应源码，不含账号数据
└── background/
    └── main.js             # 自包含入口，导出全局 refresh()
```

- 只转换**构建副本**中的宿主调用与说明；[电脑页面](public/index.html) 及其脚本、样式不修改。
- `bridge-shim.js` 由卡片桥注入，不打包假桥或浏览器模拟实现；直接双击输出 HTML 不等于桥运行环境。
- QR、MD5 等依赖已打进包，不运行 npm，不访问 CDN，不依赖 Node crypto/fs/http。
- 此构建仅输出认证/设置/后台适配，**不包含可安装 ZIP**；另有 [四页 Canvas 原型](CARD.md)，不能把这两个目录直接宣称成完整模块。

后续组装模块时，描述至少包含：

```json
{
  "id": "dev.finall.hoyolab",
  "name": "米游社",
  "version": "0.1.0",
  "versionCode": 1,
  "apiVersion": 2,
  "capabilities": ["network", "storage"],
  "background": {"intervalMinutes": 15}
}
```

还需提供 `card/index.html`、Canvas 脚本，使用桥的卡片构建工具编译 async/await 后再打 ZIP。不修改桥的 Android API，不硬编码载体 productId，不安装或操作手机。

## 网络

桥适配器将方法、URL、原始 JSON body、Cookie、DS、UA 与 x-rpc 头交给 `bridge.net.request`，显式 `cookies:false`，不混用 WebView Profile Cookie。

唯一的内容协商适配是 `Accept-Encoding: identity`：当前桥原生文本响应不会解码调用方主动请求的 gzip/br 字节；不能把压缩字节直接当 JSON。该项不是身份认证降级，所有认证字段保持原值。请求保持系统 TLS 校验，3xx 不暗中跳到另一个登录方案。

## 持久化

使用模块私有 `bridge.storage`，而不是电脑文件或网页内存：

- `hoyolab.identity`：稳定设备 UUID 与指纹刷新基准。
- `hoyolab.auth`：Token/Cookie、确认后的待完成步骤、角色与每角色 FP。
- `hoyolab.settings`：角色选择；**不负责修改桥原生调度间隔**。
- `hoyolab.note.<game>`：每游戏独立缓存，带所属登录实例与角色，防止旧后台覆盖新账号结果。

每个关键认证步骤等待持久化；关掉页面后重新打开仍可恢复。桥后台的新 WebView 从同一模块存储重建认证上下文，不重新扫码。后台只写有变化的便笺，不回写旧身份和设置；退出账号或换角期间到达的旧响应不重新建立登录态。

这些值依赖模块数据目录隔离，**不声称 Keychain/额外加密**。账号凭据不进入模块包、日志或卡片快照。卸载模块会删除该模块数据。

## 后台与快照

- 桥通过 JobScheduler 调用 `refresh()`，任务结束即销毁 WebView；没有 setInterval 常驻循环。
- 在桥的「设置与关于」开启后台刷新，并在该模块详情设置间隔；模块描述的 15 分钟只是默认值。设置网页不假装能控制不存在的调度 API。
- 后台只查询已认证/已选角色，不进行 QR/角色发现/指纹重生成；full→widget 分支仍与上游一致。
- 桥任务上限 60 秒。本适配将后台连接/读取超时缩短为 3 秒，顺序执行最多 6 次便笺请求；DNS、系统调度与省电仍可能影响执行，由桥最终限制任务寿命。失败等待下一调度周期，不建立立即重试循环。
- 保存 `bridge.card.saveSnapshot()` 时只放卡片 DTO：四页卡片所需的游戏、角色标签、来源、体力/每日指标、详情分组、状态和更新时间。widget 的 UID 为空，并标记 `widgetDefaultRole:true`，不把默认组件数据冒充为已指定 UID。
- 单个游戏失败保留其上次成功画面；全部失败不改快照。手动刷新也发布相同格式。清除账号清空快照。
- 快照写入不等于背屏已经重绘；卡片后续应同步读取快照画首帧，宿主重新加载时才会展示更新。

## 验证边界

自动化测试使用假的 API 2 bridge，但只提供真实契约中的 net/storage/card 方法，禁用全局 fetch。覆盖登录/恢复、前台与独立后台共享、退出期间旧响应、快照无凭据与失败保留缓存。

浏览器平台打包成功验证没有 Node 构建依赖泄漏。**没有运行手机安装、UI 自动化或真机桥端认证验收**；电脑原型已获用户反馈跑通，不将该结果冒充真机验证。
