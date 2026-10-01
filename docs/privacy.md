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

### `tweets`（帖子快照，主键 `tweetId`）

| 字段 | 含义 |
| --- | --- |
| `tweetId` | X 的帖子数字 id |
| `canonicalUrl` | 由 id 与用户名拼出的 `https://x.com/{username}/status/{tweetId}` |
| `username` | @ 后面的用户名（取自链接） |
| `authorName` | 显示名；取不到时为 `null` |
| `avatarUrl` | 作者头像的**地址**（只接受 `https://pbs.twimg.com/`）；图片本身不下载 |
| `verified` | 页面上是否显示认证标记 |
| `postedAt` | 帖子自己的发布时间（取自页面上的时间标签）；取不到时为 `null` |
| `text` | 正文纯文本（由下一项拼成，用于搜索），上限 50000 字符 |
| `segments` | 正文的结构化片段：文字 / 链接 / @提及 / #话题 / 表情；**不存 HTML** |
| `media` | 最多 4 项：图片或视频 / GIF 封面的**地址**、类型与替代文字；文件本身不下载 |
| `quote` | 引用帖：作者名、@用户名、认证、头像地址、时间、正文、第一张图的地址；页面给出时还有链接 |
| `card` | 链接预览卡片：链接（只接受 http/https）、标题、域名、图片地址 |
| `truncated` | 保存时正文是否被「显示更多」截断 |
| `capturedAt` / `updatedAt` | 本机时间戳（毫秒） |

`username` 和 `updatedAt` 上建有索引，那是查询用的索引，不是额外存储的内容。

**这条记录不包含**：图片、视频、GIF 文件本身（只有地址；原帖删除后可能显示为灰色占位）；任何 HTML 片段；
点赞 / 转帖 / 回复 / 浏览量等互动数据；作者简介、粉丝数、账号数字 id；回复链。所有内容都是从页面读出的可见
信息，不是 X 接口返回的对象。如果 Chrome 开着页面翻译，读到的就是页面上显示的译文。

**补全**：已保存的帖子再次出现在你浏览的页面上时，扩展用页面上看到的内容补全这条记录（例如长帖的全文、换过
的头像地址）。没有保存过的帖子不会被记录。

所有字段在写入前由后台逐项检查（`src/messaging/sanitizeSnapshot.ts`）：图片地址只接受
`https://pbs.twimg.com/`，链接只接受 http / https，不合格的一律丢弃。

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

- 媒体文件本身（图片 / 视频 / GIF），以及任何形式的缩略图或副本——只保存它们在 X 图片服务器上的**地址**
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

扩展的代码不发起任何网络请求。源码中没有 `fetch(`、`XMLHttpRequest`、`WebSocket`、`sendBeacon`、
`EventSource` 或 `importScripts` 的调用；没有使用 X 的任何 API 或 GraphQL 端点；没有 OAuth、没有
后端服务、没有遥测、没有埋点分析、没有远程代码加载、没有远程字体或远程样式表。

**唯一由扩展界面引起的网络访问是显示图片**：收藏列表里的头像、图片和视频封面是普通的 `<img>`，由浏览器
直接从 X 的图片服务器 `https://pbs.twimg.com/` 加载——和你浏览 X 时加载这些图片的是同一台服务器。这些
请求不附带来源页信息（`referrerpolicy="no-referrer"`）；地址在保存时和显示时都要通过白名单检查
（`src/utils/url.ts` 的 `isAllowedImageUrl`），其他任何主机的图片都不会被加载。页面内模式下这和 X 自己的
行为没有区别；侧边栏模式下这些请求从扩展自己的页面发出。

`src/` 中非注释的 `https://` 字面量只有：拼接帖子永久链接、@提及链接与 #话题链接用的
`https://x.com/...` 模板，内容脚本的匹配范围，以及构造 SVG 元素用的命名空间
`http://www.w3.org/2000/svg`。

### 你可以自己验证

在仓库根目录执行：

```
grep -rnE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts" \
  --include='*.ts' --include='*.tsx' --include='*.html' src/

grep -rnE "https?://" --include='*.ts' --include='*.tsx' --include='*.css' src/
```

第一条应无输出。第二条除注释外只应出现上面提到的那几处。

再看 `wxt.config.ts` 与打包产物 `dist/*/manifest.json`：其中没有 `host_permissions`，没有
`content_security_policy` 放行远程脚本，没有指向外部域名的 `<script src>`。内容脚本的匹配范围写在
`src/entrypoints/x.content/index.ts` 里，只有 `https://x.com/*` 和 `https://twitter.com/*`，扩展在
其他任何站点上都不会运行。

## 权限说明

manifest 里的权限恰好是三项（`wxt.config.ts`；第三项由 WXT 在存在侧边栏页面时自动写入）：

- **`storage`** — 用于跨标签页的变更通知。后台每次写库后，往 `chrome.storage.local` 的
  `xf:change` 这一个键写入一条很小的记录：一个递增的 `revision` 号、一个布尔 `foldersChanged`，以及
  受影响的文件夹 id 和帖子 id 列表，其他标签页据此刷新界面。这条记录**不含收藏内容本身**——没有正文、
  没有作者、没有链接、没有文件夹名，只有标识符；它每次写入都被整体覆盖，不是存储位置。选它而不是
  `tabs.sendMessage`，是因为后者需要 `tabs` 或宿主权限才能按 URL 枚举标签页（见
  `src/background/services/ChangeBroadcaster.ts` 的说明）。
- **`unlimitedStorage`** — 让上面那个 IndexedDB 数据库不受默认配额限制、也不被浏览器在存储紧张时
  自动清理（eviction），否则已保存的帖子可能在你不知情的情况下消失。
- **`sidePanel`** — 使用 Chrome 自带的侧边栏显示文件夹树和收藏列表（侧边栏阅读模式）。侧边栏里点一条
  帖子时，扩展请当前标签页里自己的内容脚本去打开它；这不需要 `tabs` 权限，也读不到其他标签页的地址。

扩展没有申请 `tabs`、`host_permissions`、`webRequest`、`cookies`、`history`、`downloads`、
`scripting` 等任何其他权限。

## 受保护账号与私密内容

如果你保存一条来自受保护（上锁）账号的帖子，它的**正文、作者名、用户名、链接，以及头像和图片的地址会
以明文写入本机的 IndexedDB**，和公开帖子走的是同一条路径，扩展不会区分对待，也无法判断一条帖子是否受保护。

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

本文件描述的是 **v0.2 开发中的版本（M2：帖子快照与富卡片，2026-10-01）**。与 v0.1.0 相比：帖子记录从
「只有正文」变为上面的快照（多了头像、认证、发帖时间、正文片段、媒体地址、引用帖、链接卡片、截断标记）；
收藏列表会显示来自 X 图片服务器的图片；新增 `sidePanel` 权限与侧边栏页面。行为变化时本文件会随之更新。

关于验证范围（哪些行为经过何种验证、哪些尚未在真实登录态下人工走通）见
[manual-qa.md](./manual-qa.md)。
