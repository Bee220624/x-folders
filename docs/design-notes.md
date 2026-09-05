# 设计参考与来源

## 本项目的实现立场

**独立实现。本项目在开发过程中未查阅任何 GPL 项目的源代码、样式、图标、文案或测试代码。**

工单最初要求「精读某 GPL-3.0 项目的 7 个实现文件（含 3 个测试文件）」，同时又声称结果是 clean-room reimplementation 并默认发 MIT。这两件事互斥：clean-room 的定义就是**写代码的人从未接触过被参考的源码**——由读过对方 `manager.ts` 的实现者写出等价的 manager，是 derivative rewrite，不是 clean room。而且把「参考过哪些文件」写进仓库文档，等于自己签署一份接触证明。

因此实际执行时改为：**完全不打开该仓库**，实现只依据本项目自己的需求规格，以及下面列出的一手公开资料。这么做没有损失任何工程价值——需要的那些"通用思想"全部是行业通用技术，而且规格本身写得比任何第三方实现都更具体。

本文档只记录**技术来源**，不记录任何第三方项目的文件路径或内部结构。

---

## 通用技术及其一手来源

下列技术都是公开、通用、不受版权保护的方法（版权保护表达，不保护方法），每一项都有独立于任何具体实现的权威来源：

| 技术 | 一手来源 | 用在哪 |
|---|---|---|
| `parentId` 邻接表建树 | 标准层级数据建模；任何文件系统与 SQL 树教程 | `src/core/domain/folder.ts` |
| MutationObserver 记录入队 + 合批 | [MDN: MutationObserver](https://developer.mozilla.org/docs/Web/API/MutationObserver)，含 `takeRecords()` 用法 | `src/hosts/x/MutationBatcher.ts` |
| `requestAnimationFrame` 按帧合并 | [MDN: requestAnimationFrame](https://developer.mozilla.org/docs/Web/API/Window/requestAnimationFrame) | 同上 |
| `requestIdleCallback` + 时间预算分摊 | [MDN: requestIdleCallback](https://developer.mozilla.org/docs/Web/API/Window/requestIdleCallback)；web.dev 的长任务拆分指南 | `src/hosts/x/TweetEnhancer.ts` |
| SPA 路由监听（popstate / hashchange / href 轮询） | [MDN: History API](https://developer.mozilla.org/docs/Web/API/History_API)、[popstate 事件](https://developer.mozilla.org/docs/Web/API/Window/popstate_event) | `src/hosts/x/RouteObserver.ts` |
| 幂等挂载 / data marker / 重复收敛 | 标准做法；由本项目 §10.4 的 Mount Contract 直接规定 | `SidebarMount`、`TweetActionInjector` |
| Observer / timer / listener 统一清理 | [MDN: AbortController](https://developer.mozilla.org/docs/Web/API/AbortController) 的所有权模型 | `src/utils/cleanup.ts` |
| Shadow DOM 样式隔离 | [MDN: Using shadow DOM](https://developer.mozilla.org/docs/Web/API/Web_components/Using_shadow_DOM) | `src/ui/shared/ShadowHost.ts` |

## 平台与库的官方文档

这些是实现中真正起决定作用的资料——本项目里若干个"反直觉"的设计选择直接来自它们：

| 来源 | 决定了什么 |
|---|---|
| [Chrome: chrome.tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs) | `tabs.query` 的 `url` 过滤在没有 `tabs` 权限或 host permission 时被**静默忽略** → 放弃 `tabs.sendMessage` 广播 |
| [Chrome: Match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns) | `content_scripts.matches` **不**授予 host permission → 同上 |
| [Chrome: Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) | 约 30 秒空闲即终止，且 IndexedDB 工作不重置计时器 → RPC 超时 + 重试、分块事务、不依赖内存状态 |
| [Chrome: runtime.onMessage](https://developer.chrome.com/docs/extensions/reference/api/runtime) | 监听器必须**同步**返回 `true` 才能异步 `sendResponse` → `RpcServer` 的监听器不是 async |
| [Dexie: Transaction](https://dexie.org/docs/Dexie/Dexie.transaction()) 与 [PrematureCommitError](https://dexie.org/docs/DexieErrors/Dexie.PrematureCommitError) | 事务内不得 await 非 Dexie Promise → 广播移到事务之后 |
| [Dexie: Compound Index](https://dexie.org/docs/Compound-Index) | 复合主键与复合索引 → membership 幂等性与倒序分页 |
| [MDN: IndexedDB key characteristics](https://developer.mozilla.org/docs/Web/API/IndexedDB_API/Basic_Terminology#key) | `null` 不是合法 key（→ 不给 `parentId` 建索引）；类型排序与数组比较规则（→ 分页边界的构造方式） |
| [WXT: Content scripts](https://wxt.dev/guide/essentials/content-scripts.html) | `cssInjectionMode` 默认 `'manifest'` 会把 CSS 注入页面文档 → 显式设为 `'ui'` |
| [Floating UI](https://floating-ui.com/docs/computePosition) | 弹层的 flip / shift / offset 定位 |

## X 的 DOM

X 的 DOM 事实**不来自任何第三方项目**，而是 2026-09-03 从真实登录态的 x.com 上实测得到的，脱敏后作为夹具存在 `tests/fixtures/`。

实测过程、结论，以及若干条与"想当然写法"相反的发现，见 **[selector-playbook.md](./selector-playbook.md)**。这份文档是本项目 X 适配部分唯一的权威参考。

---

## 许可证结论

本项目采用 [MIT](../LICENSE)。由于未接触任何 GPL 代码，不存在派生关系，也不存在 GPL 传染问题。

> 本文档是工程过程记录与风险判断，不构成法律意见。
