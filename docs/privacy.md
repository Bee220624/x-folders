# X Folders 隐私说明

本文件描述扩展 **X Folders** 实际处理数据的方式，所有陈述均以仓库源码为准。
如果某项行为源码不支持，本文件不会写。

## 存了什么

数据保存在一个 IndexedDB 数据库里，库名 `x-folders-db`（见 `src/core/constants.ts`），
共四个对象存储（见 `src/background/db/schema.ts`）。字段就是领域类型本身，没有影子字段。

### `folders`（文件夹，主键 `id`）

| 字段 | 含义 |
| --- | --- |
| `id` | 文件夹标识 |
| `name` | 你输入的文件夹名（1–64 字符） |
| `parentId` | 父文件夹 id；根文件夹为 `null`（最多两层） |
| `position` | 同级排序值 |
| `collapsed` | 是否折叠 |
| `createdAt` / `updatedAt` | 本机时间戳（毫秒） |

### `tweets`（帖子元数据，主键 `tweetId`）

| 字段 | 含义 |
| --- | --- |
| `tweetId` | X 的帖子数字 id |
| `canonicalUrl` | 由 id 与用户名拼出的 `https://x.com/{username}/status/{tweetId}` |
| `authorName` | 显示名；取不到时为 `null` |
| `username` | @ 后面的用户名 |
| `text` | 帖子正文的**纯文本**，上限 50000 字符；纯图帖可能为空字符串 |
| `capturedAt` / `updatedAt` | 本机时间戳（毫秒） |

`username` 和 `updatedAt` 上建有索引，那是查询用的索引，不是额外存储的内容。

**这条记录不包含**：图片、视频、GIF 及其缩略图；任何 HTML 片段；点赞 / 转推 / 回复 / 浏览量等互动数
据；作者头像、简介、粉丝数、账号数字 id；帖子自身的发布时间（`capturedAt` 是你保存它的本机时刻，不
是原帖时间）；引用帖、回复链、话题标签的结构化信息。正文是从页面读出的可见文本，不是 X 接口返回的
对象。

### `folderTweets`（归属关系，复合主键 `[folderId+tweetId]`）

| 字段 | 含义 |
| --- | --- |
| `folderId` | 文件夹 id |
| `tweetId` | 帖子 id |
| `savedAt` | 首次保存时的本机时间戳，之后不再改写 |

### `meta`（主键 `key`）

目前只有一行：`key: 'recentFolders'` 加一个 `folderIds` 数组，用来把最近用过的几个文件夹放在保存
面板顶部。

## 不存什么

扩展不读取、不保存也不派生以下内容：

- 媒体文件本身（图片 / 视频 / GIF），以及任何形式的缩略图或副本
- 页面 HTML 快照、DOM 序列化结果
- 点赞数、转推数、回复数、书签数、浏览量等互动计数
- Cookie、`document.cookie`、localStorage 中的 X 数据
- 认证 token、CSRF token、`Authorization` 头、OAuth 凭据
- 你的登录状态、账号身份、你自己的用户名
- X 的内部接口（REST / GraphQL）返回内容——扩展不调用这些接口
- 浏览历史、其他标签页、其他站点的任何数据

## 数据存在哪

数据库由后台 service worker 打开（`src/background/db/XFoldersDatabase.ts`），因此它位于**扩展
自己的源（chrome-extension://…）**下，而不是 `x.com` 的源下。

由此产生两个具体后果：

- 在 X 页面上执行"清除 x.com 的站点数据"、删除 x.com 的 Cookie 和存储，**不会**清掉这个数据库；
  它不属于 x.com 的站点数据。
- 数据库归属于当前浏览器配置文件（profile）。换一个 profile、换一台电脑、换一个浏览器，看到的就是
  另一份（或空的）数据。

数据不上传、不同步，也不随 Chrome 账号漫游。

## 网络行为

扩展自身不发起任何网络请求。源码中没有 `fetch(`、`XMLHttpRequest`、`WebSocket`、`sendBeacon`、
`EventSource` 或 `importScripts` 的调用；没有使用 X 的任何 API 或 GraphQL 端点；没有 OAuth、没有
后端服务、没有遥测、没有埋点分析、没有远程代码加载、没有远程字体或远程样式表。
`src/` 中出现的 `https://` 字面量只有三处：拼接帖子永久链接用的 `https://x.com/...` 模板，以及
构造 SVG 元素用的命名空间 `http://www.w3.org/2000/svg`。

### 你可以自己验证

在仓库根目录执行：

```
grep -rnE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts" \
  --include='*.ts' --include='*.tsx' --include='*.html' \
  src/ entrypoints/

grep -rnE "https?://" --include='*.ts' --include='*.tsx' --include='*.css' src/ entrypoints/
```

第一条应无输出。第二条只应出现上面提到的那几处。

再看 `wxt.config.ts` 与打包产物 `.output/*/manifest.json`：其中没有 `host_permissions`，没有
`content_security_policy` 放行远程脚本，没有指向外部域名的 `<script src>`。内容脚本的匹配范围写在
`entrypoints/x.content/index.ts` 里，只有 `https://x.com/*` 和 `https://twitter.com/*`，扩展在
其他任何站点上都不会运行。

## 权限说明

manifest 里的权限恰好是两项（`wxt.config.ts`）：

- **`storage`** — 用于跨标签页的变更通知。后台每次写库后，往 `chrome.storage.local` 的
  `xf:change` 这一个键写入一条很小的记录：一个递增的 `revision` 号、一个布尔 `foldersChanged`，以及
  受影响的文件夹 id 和帖子 id 列表，其他标签页据此刷新界面。这条记录**不含收藏内容本身**——没有正文、
  没有作者、没有链接、没有文件夹名，只有标识符；它每次写入都被整体覆盖，不是存储位置。选它而不是
  `tabs.sendMessage`，是因为后者需要 `tabs` 或宿主权限才能按 URL 枚举标签页（见
  `src/background/services/ChangeBroadcaster.ts` 的说明）。
- **`unlimitedStorage`** — 让上面那个 IndexedDB 数据库不受默认配额限制、也不被浏览器在存储紧张时
  自动清理（eviction），否则已保存的帖子可能在你不知情的情况下消失。

扩展没有申请 `tabs`、`host_permissions`、`webRequest`、`cookies`、`history`、`downloads`、
`scripting` 等任何其他权限。

## 受保护账号与私密内容

如果你保存一条来自受保护（上锁）账号的帖子，它的**正文纯文本、作者名、用户名和链接会以明文写入本机
的 IndexedDB**，和公开帖子走的是同一条路径，扩展不会区分对待，也无法判断一条帖子是否受保护。

需要明确的限制：

- 这份数据只在这台机器、这个浏览器配置文件里，不上传、不同步、当前版本也**没有导出功能**。
- 数据库未加密。任何能访问该浏览器配置文件的人或程序（本机其他用户、备份工具、磁盘取证）都可能读到
  它。设备本身的安全由你负责。
- 转发或分享这些内容是否恰当，扩展不做任何判断，也不做任何限制。

## 如何删除数据

- **卸载扩展**：浏览器会连同扩展的存储一起移除它的 IndexedDB 和 `chrome.storage.local` 记录。这是
  最彻底的方式。
- **在扩展内删除**：删除一个文件夹会连带删除它的子文件夹、其中的全部归属关系；随后做一次孤儿回收——
  不再属于任何文件夹的帖子记录会从 `tweets` 中删除（`src/background/services/FolderService.ts`）。
  把某条帖子移出它所在的最后一个文件夹时，同样会删掉这条帖子的元数据
  （`src/background/services/TweetSaveService.ts`）。
- 清除 x.com 的 Cookie 或站点数据对本扩展的数据**没有影响**，原因见上文「数据存在哪」。

## 变更

本文件描述的是 **v0.1.0**。内容脚本入口 `src/entrypoints/x.content/index.ts` 已接入完整运行时
（`XRuntime`），页面内的保存入口可用；上文描述的是后台存储层、权限与内容脚本的实际行为。行为变化时
本文件会随之更新。

关于验证范围（哪些行为经过何种验证、哪些尚未在真实登录态下人工走通）见
[manual-qa.md](./manual-qa.md)。
