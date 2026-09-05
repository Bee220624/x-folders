# 架构

## 一句话

在 X 网页内部注入一套本地文件夹收藏系统。**所有数据写入都发生在扩展的 Background Service Worker 里的 IndexedDB**，Content Script 只通过 typed RPC 访问，不碰数据库。

---

## 1. 三个执行上下文

```
┌─────────────────────────────────────────────────────────────┐
│ Background Service Worker (MV3)                             │
│                                                             │
│   RpcServer ──> handlers ──> FolderService / TweetSaveService│
│                                   │                         │
│                                   ├─> Repositories          │
│                                   │     (Folder/Tweet/       │
│                                   │      Membership/Meta)   │
│                                   │        │                │
│                                   │        v                │
│                                   │   Dexie / IndexedDB     │
│                                   │   (唯一事实来源)          │
│                                   v                         │
│                            ChangeBroadcaster                │
│                                   │                         │
└───────────────────────────────────┼─────────────────────────┘
              ▲ chrome.runtime      │ chrome.storage.local
              │ .sendMessage        │ (+ storage.onChanged)
              │                     v
┌─────────────┴───────────────────────────────────────────────┐
│ Content Script (x.com，隔离世界)                              │
│                                                             │
│   XRuntime ── 拥有所有长生命周期对象                            │
│     ├─ 三层 Observer（root / tweet stream / theme）            │
│     ├─ RouteObserver + HealthMonitor + singleFlight          │
│     ├─ FolderStore / VisibleTweetStore                       │
│     └─ 四个挂载点：                                            │
│          SidebarMount ─────> Preact，Shadow DOM               │
│          SavePopoverController ─> Preact，body 级 Shadow DOM   │
│          FolderViewMount ─────> Preact，body 级 Shadow DOM     │
│          TweetActionInjector ──> 原生 DOM + 极小 Shadow Root   │
└─────────────────────────────────────────────────────────────┘
```

### 为什么数据库在 Background 而不是 Content Script

Content Script 的 IndexedDB 归**页面所属源**（x.com）所有。放在那里意味着：数据混进 X 的站点存储、用户"清除 x.com 站点数据"时被一起抹掉、跨标签一致性也更难。放在 Service Worker 里，数据库属于扩展自己的源。

---

## 2. RPC

统一返回结构：

```ts
type RpcResult<T> = { ok: true; data: T } | { ok: false; error: { code, message } };
```

### 三条不能违反的规则

**1. 监听器必须在模块顶层同步注册。**
写在 `await` 之后的监听器，在 Worker 被消息**唤醒**时并不存在，那条消息就丢了。

**2. 监听器本身不能是 `async`。**
`chrome.runtime.onMessage` 不支持返回 Promise 的监听器——必须**同步返回字面量 `true`**，之后再异步调用 `sendResponse`。写成 `addListener(async (msg, sender, sendResponse) => {...})` 会返回 Promise，Chrome 立刻关闭响应通道，**每一个** RPC 都 resolve 成 `undefined`。见 `RpcServer.ts`。

> 注意：WXT 0.21 的 `browser` 是裸 `chrome` 命名空间，不是 webextension-polyfill，所以 Firefox 风格的 promise 契约在这里**不适用**。

**3. 不信任 content script 的 payload。**
每个方法在 `src/messaging/validate.ts` 里有运行时校验；`tweetId` 必须是数字字符串，URL 必须能解析成 x.com/twitter.com 的 status 永久链接，且**用户名一律取自 URL**，不采信可见文本。

### Service Worker 会被杀

Chrome 在约 30 秒空闲后终止 Worker，而 **IndexedDB 的工作不会重置这个计时器**。因此：

- 数据库按需打开，句柄丢了就重开；内存里不存任何业务状态。
- 每个 RPC 调用有 10 秒超时 + 对**白名单方法**的一次自动重试（重试会重新唤醒 Worker）。

  ⚠️ **不是所有写操作都能重试。** `RPC_TIMEOUT` / `RPC_UNAVAILABLE` 表示**响应丢了**，不是请求没到——
  Worker 在提交完事务后被回收，产生的正是这个错误。所以重试会把**已经成功的写**再执行一遍。
  实测后果：一次「上移」点击会把文件夹移动两格；`create` 的重试撞上重名校验，用户为自己刚刚成功的
  创建收到「同级下已存在同名文件夹」；`delete` / `removeTweet` 的重试则报 NOT_FOUND。

  因此 `RpcClient` 维护一份显式白名单，只重试：全部读操作、`saveTweet`（复合主键 + `savedAt` 不重写）、
  `rename` 与 `setCollapsed`（值相同即 no-op）。`create` / `delete` / `moveUp` / `moveDown` /
  `removeTweet` **永不重试**——调用方改为在失败后 `store.refresh()`，让界面收敛到实际落库的状态。
- 级联删除和孤立 Tweet GC 分块进行，避免一次超长事务。

---

## 3. 事务纪律

> **事务回调内禁止 `await` 任何非 Dexie 的 Promise。**

IndexedDB 在事务"一个 tick 内没被使用"时会自动提交。在 `db.transaction(...)` 里 `await browser.tabs.*` / `chrome.storage.*` / `fetch` 会跳出 Dexie 的 zone，结果要么抛 `PrematureCommitError` / `TransactionInactiveError`，要么**更糟——提前提交，剩下的步骤在无事务保护下裸奔**。

而且 `fake-indexeddb` 的自动提交时序和真实实现不同，这类 bug **单元测试抓不到**。

所以每个写操作都是同一个形状：

```
一个事务  ──返回──>  纯数据的 change 描述符
                        │
                        v
              事务 resolve 之后才广播
```

事务范围也写死在服务层（`saveTweet` 需要 folders/tweets/folderTweets/meta 四张表；漏一张 Dexie 会直接报 "Table X not included in parent transaction"）。

---

## 4. 跨标签变更广播

**用 `chrome.storage.local` + `storage.onChanged`，不用 `tabs.sendMessage`。**

原因：要向所有 X 标签广播，先得找到它们，也就是 `chrome.tabs.query({url: 'https://x.com/*'})`。但 Chrome 文档明确写着，`url` 过滤条件在扩展**没有 `tabs` 权限或对应 host permission** 时会被**静默忽略**——而 `content_scripts.matches` 在 MV3 里**不授予 host permission**。结果就是广播悄无声息地失效，`typecheck` / `lint` / `test` / `build` 全绿，只有人工多标签场景才暴露。

`storage.onChanged` 的好处：

- 只需要已有的 `storage` 权限，不需要枚举标签；
- 在每个 content script 里都会触发；
- 不会产生 "Receiving end does not exist" 的未捕获 rejection；
- 记录是持久化的，Worker 被杀也不影响；
- 天然是 debounce 的合并点。

也没有选长连 Port：Port 会在 Worker 被销毁时断开，content script 重连又会把 Worker 唤醒，形成一个让 MV3 生命周期形同虚设的循环。

收到事件后：Sidebar 重取快照（80ms debounce），Folder View 只刷新当前文件夹，可见推文的按钮只重查受影响的 ID。

---

## 5. 数据模型

```
folders        id, position, createdAt, updatedAt
tweets         tweetId, username, updatedAt
folderTweets   [folderId+tweetId](主键), folderId, tweetId, [folderId+savedAt+tweetId]
meta           key
```

### 几个刻意的选择

**`parentId` 没有索引。** IndexedDB 不接受 `null` 作为 key，建了索引会**静默漏掉所有根文件夹**，任何基于它的查询都会返回残缺的树。文件夹总数是几十量级，全量读入内存分组即可。

**membership 用复合主键 `[folderId+tweetId]`。** 重复保存的幂等性由**存储层**保证，而不是靠约定。

**`savedAt` 属于 membership，且一旦写入永不修改。** 这不只是幂等性的细节——分页游标就建立在 `savedAt` 上，重写它会让正在滚动的读者的游标失效、页面顺序错乱。

**Tweet 上不存 `folderIds`。** 避免双向数据不一致。

### 分页契约（最容易写错的地方）

顺序 = `[folderId+savedAt+tweetId]` 索引顺序的**逆序**：`savedAt` 降序，然后 `tweetId` 按**码位**降序。

> ⚠️ IndexedDB 把 `tweetId` 当字符串比较，所以 `"99" > "100"`。这是**故意的**，不要在 JS 里按数字重排"修正"它——一个和索引顺序不一致的 JS 顺序，会让游标指进平局组的中间，从此永久跳过整段记录。

有游标时上界**排他**，这正是平局不漏不重的原因。取 `limit + 1` 条来判断 `hasMore`，不用第二次查询。`nextCursor` 取自**原始 membership**，而不是 UI 实际渲染出的卡片——否则一条 tweet 行缺失就会缩短页面并提前终止分页。

边界不用 `Dexie.minKey` / `Dexie.maxKey`（它们是 `-Infinity` 和 `[[]]`，部分 IndexedDB 实现，包括测试用的 `fake-indexeddb`，直接拒绝）。改用 IDB 自身的类型序：同前缀下短数组小于长数组，所以 `[folderId]` 小于一切；数组大于任何字符串和数字，所以 `[folderId, []]` 大于一切。

---

## 6. X DOM 适配层

所有 selector 集中在 `src/hosts/x/selectors.ts`。实测发现的反直觉之处见 **[selector-playbook.md](./selector-playbook.md)**，那份文档是本项目 X 适配部分最重要的参考。

三条最关键的：

1. **引用推文不是嵌套的 tweet root**，是同 `<article>` 内的 `div[role="link"][tabindex="0"]`。因此按 `closest()` 区分内外层是空操作，必须按祖先包含关系排除引用子树。
2. **详情页焦点推文的 header 里没有 `<time>`**。统一规则：身份锚点 = 不在引用子树内、且内部含 `<time>` 的 `a[href*="/status/"]`——它同时适配时间线和详情页，并自动排除 `/analytics`、`/quotes` 诱饵。
3. **提取结果是三态 `ok | retry | skip`**，不是 `T | null`。把广告和"帖子无法显示"当作可重试，会让 watchdog 每 2 秒重扫它们直到永远。

---

## 7. SPA 自愈

### Observer 分三层

| 层 | 目标 | 频率 | 成本 |
|---|---|---|---|
| Root lifecycle | `#react-root` | 120ms debounce | 只调度，不做实际工作 |
| Tweet stream | `[data-testid="primaryColumn"]` | 每帧合批 | 只从 `addedNodes` 局部收集 |
| Theme | `<html>`/`<body>` 的有限属性 | 属性变化 | 极低 |

合成一个通用 observer 会让最便宜的问题在每次时间线更新时付出最贵的代价。

### 路由

MV3 content script 在隔离世界里，patch `history.pushState` 需要往页面注入脚本——权限更大、更易碎。改用 `popstate` + `hashchange` + 500ms 兜底轮询，并在**每批 mutation 结束时顺便比对 URL**（所以轮询几乎从不是第一个发现导航的）。

路由变化后在 **0 / 250 / 1000ms** 各执行一次 ensure（X 分阶段渲染，只做一次必然错过时间线），并**取消上一路由尚未执行的延迟任务**。

### 幂等与单飞

`ensure*()` 可以被任意频繁地调用：位置正确时 no-op，节点被替换时重挂载，出现重复时收敛为一个。整个 reinitialize 走 `singleFlight`——路由变化、root mutation、health tick 可能在同一帧内都要求同一次修复，而并发跑三次重挂载**正是重复节点的来源**。

### Watchdog

每 2 秒一次，只扫描**当前已挂载**的节点（X 做了虚拟化，是几十个而不是整个滚动历史），`document.hidden` 时**完全停止**，重新可见时立刻补一次。

### 性能

一批 200 条新推文不会同步处理——那正是滚动卡顿的来源。`TweetEnhancer` 把它们排队，用 `requestIdleCallback`（无则退化为 `setTimeout`）分片处理，每片有 8ms 时间预算，超了就让出。

---

## 8. UI 挂载

| 表面 | 技术 | 原因 |
|---|---|---|
| Sidebar / Popover / Folder View | Preact + Shadow DOM | 单例，需要真正的组件状态 |
| Tweet 操作栏按钮 | 原生 DOM + 极小 Shadow Root | 每条推文一个 Preact root，长列表下就是几百个框架实例 |

四个宿主的 Shadow Root 一律是 **`mode: 'closed'`**。宿主挂在 x.com 自己的文档里，用 `open` 意味着任何页面脚本一行 `document.querySelector('[data-xf-sidebar-host]').shadowRoot.textContent` 就能读走整棵文件夹树。代价是 `host.shadowRoot` 对**我们自己也是 `null`**，所以从宿主元素反查内部要走第一方查找表：`shadowRootOf()`（`ShadowHost.ts`）和 `TweetActionInjector.buttonFor()`，两张 WeakMap 都在隔离世界里，页面碰不到。

> 这不是硬边界，也不该被这么描述：抢在 `document_idle` 之前 patch `Element.prototype.attachShadow` 的页面脚本照样能拿到 root。它买到的是成本和可见度——从任何脚本顺手就能做的一行 `querySelector`，变成一次刻意的、可被发现的原型挂钩。
>
> 一个直接后果写在 `TweetActionInjector.ensure()` 里：DOM 里找到但不在 WeakMap 里的宿主（上一个 content script 上下文的残留）**无法再就地更新**，只能删掉重建。

CSS 全部以字符串形式注入各自的 Shadow Root，**从不进入 x.com 的文档**。WXT 默认的 `cssInjectionMode: 'manifest'` 会把 CSS 写进 `manifest.content_scripts[].css`——注入到 X 自己的文档里，既污染 X 的 DOM，又**跨不过 shadow 边界**到达它本来要装饰的 UI。所以内容脚本显式声明 `cssInjectionMode: 'ui'`。

主题：`<body>` 的内联背景色是唯一可靠的信号（文字色和边框色都在被禁用的混淆类里），据此判定 Light / Dim / Lights Out，再映射到内置的三套调色板写进宿主元素的 CSS 变量。**从不修改 X 的全局变量。**

---

## 9. 清理

`CleanupRegistry` 统一登记 observer、interval、timeout、rAF/idle 回调、事件监听器、body 级 Shadow Host 和 Preact root。WXT 的 `ctx.onInvalidated()` 触发时全部拆除。`dispose()` 逆序执行且互相隔离——一个抛异常的 disposer 不会拖死其余的。
