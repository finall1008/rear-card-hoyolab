# 协议与来源说明

来源：[The Latte Helper / PizzaHelperUnited](https://github.com/pizza-studio/PizzaHelperUnited)，固定版本 `29a063c4d906d9f02954ddf1f422e9a4d087aa59`，AGPL-3.0-or-later。

国服扫码认证、设备指纹和便笺查询采用该固定版本的协议定义，JavaScript 实现位于 `lib/hoyo.mjs` 和 `lib/service.mjs`。

## 1. 扫码与 Cookie

| 步骤 | 上游源码（固定版本） | 本地实现 |
| --- | --- | --- |
| App 创建二维码 | [GenerateQRCodeURLAPI.swift](https://github.com/pizza-studio/PizzaHelperUnited/blob/29a063c4d906d9f02954ddf1f422e9a4d087aa59/Packages/PZKit/Sources/PZAccountKit/HoYoAPIs/LoginRelated/QRCodeLoginAPI/GenerateQRCode/GenerateQRCodeURLAPI.swift#L10-L45) | [hoyo.mjs](lib/hoyo.mjs)：`createQR` / `qrHeaders` |
| 查询二维码 | [QueryQRCodeAPI.swift](https://github.com/pizza-studio/PizzaHelperUnited/blob/29a063c4d906d9f02954ddf1f422e9a4d087aa59/Packages/PZKit/Sources/PZAccountKit/HoYoAPIs/LoginRelated/QRCodeLoginAPI/QueryQRCodeStatus/QueryQRCodeAPI.swift#L82-L110) | `queryQR` |
| 解析确认 | [QueryQRCodeStatus.swift](https://github.com/pizza-studio/PizzaHelperUnited/blob/29a063c4d906d9f02954ddf1f422e9a4d087aa59/Packages/PZKit/Sources/PZAccountKit/HoYoAPIs/LoginRelated/QRCodeLoginAPI/QueryQRCodeStatus/QueryQRCodeStatus.swift#L16-L54) | `parseConfirmation`：第一个 token；aid → uid → account_id；ltoken = stoken |
| 兑换 Cookie | [GetCookieTokenAPI.swift](https://github.com/pizza-studio/PizzaHelperUnited/blob/29a063c4d906d9f02954ddf1f422e9a4d087aa59/Packages/PZKit/Sources/PZAccountKit/HoYoAPIs/LoginRelated/GetCookieTokenAPI/GetCookieTokenAPI.swift#L9-L27) | `cookieToken` |
| 拼装 Cookie + 指纹 | [GetCookieQRCodeView.swift](https://github.com/pizza-studio/PizzaHelperUnited/blob/29a063c4d906d9f02954ddf1f422e9a4d087aa59/Packages/PZHelper/Sources/PZHelper/PZH_Frontends/PZH_Features/ProfileManager/Peripherals/GetCookieQRCodeView.swift#L178-L202) / [Extra.swift](https://github.com/pizza-studio/PizzaHelperUnited/blob/29a063c4d906d9f02954ddf1f422e9a4d087aa59/Packages/PZHelper/Sources/PZHelper/PZH_Frontends/PZH_Features/ProfileManager/Peripherals/GetCookieQRCodeView_Extra.swift#L8-L15) | `completeCookie`；[service.mjs](lib/service.mjs) 的 `complete` |

- POST `https://passport-api.mihoyo.com/account/ma-cn-passport/app/createQRLogin`，JSON `{}`。
- POST 同路径 `queryQRLoginStatus`，JSON `{ticket}`。
- 两者使用 `x-rpc-app_id=ddxf5dufpuyo`、`x-rpc-client_type=3`、`User-Agent=HYPContainer/1.3.3.182`，同一二维码任务 UUID。
- GET `https://api-takumi.mihoyo.com/auth/api/getCookieAccountInfoBySToken`，带 SToken Cookie、上游 DS/default headers。
- Cookie 字段按上游顺序：stuid / stoken / ltuid / ltoken / mid / cookie_token / account_id。
- 不回退 web QR、login_ticket、gameToken 兑换、手贴 Cookie 或匿名数据。

## 2. 设备与签名

- [GetDeviceFingerPrint.swift](https://github.com/pizza-studio/PizzaHelperUnited/blob/29a063c4d906d9f02954ddf1f422e9a4d087aa59/Packages/PZKit/Sources/PZAccountKit/HoYoAPIs/LoginRelated/GenerateDeviceFingerPrintAPI/GetDeviceFingerPrint.swift)：`makeFPBody` / `fpExtFields` / `fingerprint`。
- POST `https://public-data-api.mihoyo.com/device-fp/api/getFp`；MD5(profile device ID + refreshDate)；16 位十六进制 seed；秒时间戳加 `000`；platform=1；app_name 为游戏国服 game_biz；完整保留上游 iPhone ext_fields，**没有改成浏览器指纹或空值**。本地初始随机 fp 同样从二次 MD5 字符打乱取 13 位；使用服务端返回的 device_fp 发起便笺请求。
- 二维码的任务 UUID 与账户/profile device ID 是两回事，上游也是如此。本地没有 Apple identifierForVendor，首次生成并持久保存一个大写 UUID 作为 profile device ID；不会读取真实硬件序列号。
- [CreateProfileSheetView.swift](https://github.com/pizza-studio/PizzaHelperUnited/blob/29a063c4d906d9f02954ddf1f422e9a4d087aa59/Packages/PZHelper/Sources/PZHelper/PZH_Frontends/PZH_Features/ProfileManager/ProfileMgr_SubViews/CreateProfileSheetView.swift#L177-L197)：每个首次发现的角色再申请对应游戏区域的 FP，与登录时 FP 分开保存。
- [URLRequestConfig.swift](https://github.com/pizza-studio/PizzaHelperUnited/blob/29a063c4d906d9f02954ddf1f422e9a4d087aa59/Packages/PZKit/Sources/PZAccountKit/HoYoAPIs/Common/HoYo_URLReq/URLRequestConfig.swift) / [URLRequestHelper.swift](https://github.com/pizza-studio/PizzaHelperUnited/blob/29a063c4d906d9f02954ddf1f422e9a4d087aa59/Packages/PZKit/Sources/PZAccountKit/HoYoAPIs/Common/HoYo_URLReq/URLRequestHelper.swift)：CN X4 salt、2.40.1 / client 5、原 headers；DS2 `salt&t&r&b&q`，query 顺序与实际 URL 相同，使用 DS2 签名。

## 3. 角色与便笺

角色发现：[UserGameRolesAPI.swift](https://github.com/pizza-studio/PizzaHelperUnited/blob/29a063c4d906d9f02954ddf1f422e9a4d087aa59/Packages/PZKit/Sources/PZAccountKit/HoYoAPIs/LoginRelated/UserGameRolesAPI/UserGameRolesAPI.swift)，`getUserGameRolesByCookie?game_biz=` 依次查询 hk4e_cn / hkrpg_cn / nap_cn。

下表 host 统一为 `api-takumi-record.mihoyo.com`。

| 游戏 | 第一次请求 full（role_id + server） | full 失败且含 stoken=v2_ 时使用 widget（无 query） | 上游 |
| --- | --- | --- | --- |
| 原神 | `/game_record/app/genshin/api/dailyNote` | `/game_record/app/genshin/aapi/widget/v2` | [NoteAPI4GI.swift](https://github.com/pizza-studio/PizzaHelperUnited/blob/29a063c4d906d9f02954ddf1f422e9a4d087aa59/Packages/PZKit/Sources/PZAccountKit/HoYoAPIs/DailyNoteRelated/NoteAPI4GI.swift) |
| 星穹铁道 | `/game_record/app/hkrpg/api/note` | `/game_record/app/hkrpg/aapi/widget` | [NoteAPI4HSR.swift](https://github.com/pizza-studio/PizzaHelperUnited/blob/29a063c4d906d9f02954ddf1f422e9a4d087aa59/Packages/PZKit/Sources/PZAccountKit/HoYoAPIs/DailyNoteRelated/NoteAPI4HSR.swift) |
| 绝区零 | `/event/game_record_zzz/api/zzz/note` | `/event/game_record_zzz/api/zzz/widget` | [NoteAPI4ZZZ.swift](https://github.com/pizza-studio/PizzaHelperUnited/blob/29a063c4d906d9f02954ddf1f422e9a4d087aa59/Packages/PZKit/Sources/PZAccountKit/HoYoAPIs/DailyNoteRelated/NoteAPI4ZZZ.swift) |

- full → widget 是**上游原有分支**，没有增加第三条回退路线。保留两个请求的真实错误及实际数据来源。
- HSR widget、ZZZ full/widget 的 UA 按上游覆盖为 `WidgetExtension/434 CFNetwork/1492.0.1 Darwin/23.3.0`。
- 每次带保存的 profile device_id 和 device_fp；不遇错便重新生成设备身份。
- **widget 不发送 UID/server**，其结果跟随官方组件默认角色；多角色账户不可把该结果当作已强制查询所选 UID。设置页显示实际来源；卡片隐藏 widget 来源的昵称和 UID，不显示默认角色提示。
- 活跃度与是否领取奖励分开；缺少领取字段不推断“已领取”。

## 4. 运行平台

- 设置页使用普通 HTML/CSS/JavaScript；卡片使用 Canvas 2D 和 pointer 事件。
- 本地开发通过 Node fetch 请求官方接口，将明文账号、角色和便笺保存到 `.local/state.json`。该目录被 Git 忽略，POSIX 权限参数不替代 Windows ACL 或额外加密。
- 安装模块通过 `bridge.net`、`bridge.storage` 和 `bridge.card` 运行；MD5 使用 `@noble/hashes`，二维码使用内置 `qrcode`。模块无需 Node 或本地服务，具体契约见 [BRIDGE.md](BRIDGE.md)。
- 扫码确认后的中间结果持久化保存，可手动继续认证。角色查询结果和每游戏错误分别处理。
- 二维码正常轮询间隔为 3 秒、最小间隔为 1 秒；网络错误按实际结果显示，可手动检查原二维码或继续认证。
- 支持单账号国服扫码与三游戏便笺，不包含国际服、短信/密码登录、自动签到、验证码求解或完整战斗面板。

## 5. 游戏图片

三个体力 PNG 来自同一固定上游版本的 `PZAccountKit/Resources/Assets.xcassets/DailyNoteIcons`。原图与来源记录位于 [card/assets](card/assets/sources.json)，离线素材脚本由 `scripts/build-home-assets.mjs` 生成。

游戏图片版权归 miHoYo / HoYoverse，不属于本项目 AGPL 源码授权范围。模块作者为 finall1008，上游版权与第三方依赖许可见 [NOTICE](NOTICE)。
