# 米游社 · 卡片设置原型

独立仓库，用于先验证 **拿铁小助手的国服 App 扫码认证调用链**，随后接入 Rear Card Bridge API 2 卡片模块。当前提供本机可运行的设置网页，不修改 Android 项目，不是可安装的卡片 ZIP。

## 启动

需要 Node.js 22 或以上：

```bash
npm ci
npm start
# http://127.0.0.1:18766
```

仅监听 `127.0.0.1`，没有外部服务、云端账号中转或远程二维码生成器。修改端口：`PORT=18767 npm start`。

1. 打开上述网址，点击「扫码登录」，用 **米游社 App** 扫描并确认。
2. 原型按拿铁逻辑依次获得 SToken、兑换 cookie_token、申请设备指纹、发现三款游戏角色。页面显示各阶段真实进度/错误；**扫码确认不等于整条认证已完成**。
3. 选择绑定的原神 / 星穹铁道 / 绝区零角色，保存配置并查询便笺。
4. 页面标出实际使用 full 还是 widget；完整接口失败后使用 widget 是拿铁原有策略，既不取消也不改成网页 Cookie。widget 无 UID 参数，跟随官方组件默认角色。
5. 重启本地服务后仍保留账号和设备身份。已确认扫码但换 Token / 指纹失败，可继续未完成步骤，不要求再次扫码。可以移除本地账号。

## 四页卡片预览

保持设置原型运行，另开终端执行 `npm run preview:card`，打开 http://127.0.0.1:18767 。首页三列看体力与每日进度，左右滑动进入三游戏详情，首页下拉刷新全部、详情下拉只刷新当前游戏。沿用已登录的真实数据，先保存状态再展示；原设置页保持不动。详情与持久化设计见 [卡片原型](CARD.md)。

## 移植范围

- 固定上游：[The Latte Helper](https://github.com/pizza-studio/PizzaHelperUnited) @ `29a063c4d906d9f02954ddf1f422e9a4d087aa59`。
- App QR：`ma-cn-passport/app/createQRLogin` → `queryQRLoginStatus`；直接解析 SToken / MID / AID，ltoken = stoken。
- SToken Cookie → `getCookieAccountInfoBySToken` → 七字段 Cookie。
- 完整保留上游 CN getFp 请求结构、ext_fields、初始 FP 算法、返回 FP 及每角色设备资料。
- 上游 DS2 签名与 App 请求头；三游戏 full → widget 分支；错误不伪装成成功。
- 原神委托、星铁实训、绝区零活跃度仅展示响应事实，不把“积分满”当“奖励已领取”。

逐文件、逐接口的来源和平台适配差异见 [移植对照](UPSTREAM.md)。**不保证官方不再触发风控**，也没有增加自动验证码求解或协议降级。若上游返回错误，显示具体阶段与 retcode。

当前为单账号、国服扫码路径；不包含拿铁的全部登录 UI、国际服、短信/密码登录、角色面板、签到或验证码窗口。SwiftUI、SwiftData 和 iOS 后台唤醒并未原样搬进网页；这些平台差异不冒充“完全相同”。

## 持久化与账号数据

- 本地状态位于 `.local/state.json`：Token、Cookie、设备 UUID/FP、每角色设备资料、设置及最近便笺。
- 目录 0700 / 文件 0600，**文件为明文，仅靠本机用户权限保护，不是 Keychain 加密**；`.local/` 已被 Git 忽略，不要分享此目录或备份到公开位置。
- 浏览器不接收 Token、Cookie、MID、设备 FP 或 QR ticket；它只收到二维码 SVG、账号标识、角色、进度和便笺。
- 日志不打印 Cookie / Token / 请求正文，页面不提供凭据导出。移除账号会清掉本地认证和便笺，但不代表撤销官方登录授权。
- 默认每 15 分钟后台刷新选择的游戏（可设置，最小 5 分钟），仅在本地服务运行时有效；不把进程退出说成仍可后台工作。手动刷新也通过同一个请求队列执行。

## 代码与验证

```bash
npm test
node --check server.mjs
node --check public/app.js
```

- [协议核心](lib/hoyo.mjs)：上游协议、DS、设备指纹、角色/便笺请求，transport 可注入。
- [认证与设置服务](lib/service.mjs)：扫码状态机、中间步骤继续、角色资料、摘要。
- [本机存储适配](lib/store.mjs)：电脑调试时使用的文件持久化。
- [桥端适配](bridge/runtime.mjs)：模块内直连官方接口，使用 bridge.storage 保存状态与 bridge.card 发布快照。
- [本机 HTTP 宿主](server.mjs)：当前用于调试，不会放进 Android 卡片执行环境。
- [设置页](public/index.html)：普通 HTML/CSS/JS，不依赖前端框架/CDN。
- [自动化测试](test/)：模拟上游的协议/状态机测试 + 真实本地 HTTP 测试，**不替代真人扫码和官方三游戏接口验收**。

桥端无需本地服务：`npm run build:bridge` 构建独立的设置页与后台入口，共用认证核心，改走 `bridge.net.request` / `bridge.storage` / 桥原生后台调度。电脑原型页面与现有登录态保持不变。组装说明见 [API 2 接入](BRIDGE.md)。现有四页 Canvas 绘制原型，但尚未制作可安装 ZIP，未修改桥端接口、没有硬编码 carrier productId，也未操作或安装手机。

## 许可与源码

本原型衍生自 Pizza Studio 的 AGPL-3.0-or-later 代码，保留版权与许可，不冒充官方或拿铁团队产品。见 [NOTICE](NOTICE)、[LICENSE](LICENSE)。网页页脚「源码」可下载当前完整源码包（固定白名单，不包含本地凭据、Git 或 node_modules）；`npm ci` 恢复依赖。未创建远程仓库、未推送。
