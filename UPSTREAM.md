# 上游移植对照

来源：[The Latte Helper / PizzaHelperUnited](https://github.com/pizza-studio/PizzaHelperUnited)，固定版本 `29a063c4d906d9f02954ddf1f422e9a4d087aa59`，AGPL-3.0-or-later。

这是 **Swift → JavaScript 协议移植**，不是调用已安装的拿铁 App，也不是把旧网页 Cookie Demo 换皮。国服米游社扫码调用链如下；不声称移植了拿铁的全部功能或其他登录方式。

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
- [URLRequestConfig.swift](https://github.com/pizza-studio/PizzaHelperUnited/blob/29a063c4d906d9f02954ddf1f422e9a4d087aa59/Packages/PZKit/Sources/PZAccountKit/HoYoAPIs/Common/HoYo_URLReq/URLRequestConfig.swift) / [URLRequestHelper.swift](https://github.com/pizza-studio/PizzaHelperUnited/blob/29a063c4d906d9f02954ddf1f422e9a4d087aa59/Packages/PZKit/Sources/PZAccountKit/HoYoAPIs/Common/HoYo_URLReq/URLRequestHelper.swift)：CN X4 salt、2.40.1 / client 5、原 headers；DS2 `salt&t&r&b&q`，query 顺序与实际 URL 相同，不沿用旧 Demo 的 H5 DS1。

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
- **widget 不发送 UID/server**，其结果跟随官方组件默认角色；多角色账户不可把该结果当作已强制查询所选 UID。原型直接标出这一限制，不擅自补一个上游不存在的选角接口。
- 活跃度与是否领取奖励分开；缺少领取字段不推断“已领取”。

## 4. 明确的平台适配，不冒充逐字复制

- SwiftUI → 普通网页；Alamofire/URLSession → Node fetch；CoreImage QR → 本地 qrcode；CryptoKit MD5 → Node crypto。
- SwiftData/UserDefaults → 仓库私有 `.local/state.json`（目录 0700 / 文件 0600，**明文**；不上传、Git 忽略）。保留 Token、设备身份、FP、角色、配置和查询结果，进程重启不强迫重新扫码。
- 单个本地账户，暂不做拿铁完整多账号资料管理、国际服登录、短信/密码登录、签到、Geetest UI 或战斗详情。
- 完成确认后的中间结果可落盘并手动继续，某游戏角色失败不会伪装成无角色，也不妨碍另两款展示真实状态。这是原型状态管理适配，不是降低认证级别。
- 上游正常轮询间隔 3 秒、最小间隔 1 秒；本地也按此调度。没有移植 iOS 后台 session 唤醒及 Alamofire 专属网络重试；本地明确显示网络错误，支持原二维码手动检查/继续，不切换登录协议。
- 便笺响应保留原始 JSON 与前端需要的轻量摘要，不移植拿铁全部 Swift Codable 业务模型或 UI。
- 桥 API 2 适配已独立实现：相同核心用 bridge.net / storage，MD5 使用可在 WebView 打包的 @noble/hashes，随机源用 Web Crypto；不需要在 Android 里运行 Node。桥原生文本网络的内容协商使用 identity，认证头不变。细节见 [BRIDGE.md](BRIDGE.md)。当前还不是包含卡片绘制的可安装模块；现有 Android 仓库未改动。
