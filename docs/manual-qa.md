# 手工验收记录（v0.1.0）

> 这份文档的用途是**如实区分**「已在真实 X 上验证」「只在夹具/单元测试中验证」「完全未验证」。
> 任何一项都不做美化。未验证的就写未验证。

---

## 0. 一句话结论

**扩展从未被装进浏览器里在真实 X 上跑过。** 自动化测试（144 个）全部通过，构建产物可生成，
X 的 DOM 结构经过真实登录态实测并作为夹具固化——但**端到端的人工走查（装扩展 → 在 x.com 上点按钮 →
存 → 浏览）没有执行过**。原因是加载已解压扩展需要在 `chrome://extensions` 开启开发者模式并选择目录，
这属于修改浏览器设置、必须由你本人操作。

第 4 节给出你自己走一遍需要做的事。

---

## 1. 已在真实 X 上验证 ✅

时间：**2026-09-03**，真实登录态的 x.com，Chrome / macOS，界面语言中文，主题 Light。

验证方式：在真实页面上执行只读的 DOM 查询，把结构事实取回来，再据此写实现。抓取的 DOM 经脱敏后
固化为 `tests/fixtures/x-{home,status,profile,search}.html`（共 27 个 `cellInnerDiv`）。

| # | 结论 | 页面 | 置信度 |
|---|---|---|---|
| 1 | 推文根是 `article[data-testid="tweet"]`，时间线行是 `[data-testid="cellInnerDiv"]` | Home / Profile / Search / Status | 高 |
| 2 | **引用推文不是嵌套的 tweet root**，是同 `<article>` 内的 `div[role="link"][tabindex="0"]`，自带 User-Name / time / tweetText / status 锚点 | Home（2 条）、Status（1 条） | 高 |
| 3 | 因此 `closest('[data-testid="tweet"]') === root` 对引用块内节点恒为真，**护栏无效** | 同上 | 高（实测 `nestedTweetTestid: 0`） |
| 4 | **详情页焦点推文的 header 里没有 `<time>`**（`timeInsideUserName: false`），时间戳在正文下方独立的永久链接行 | Status | 高 |
| 5 | 详情页焦点推文有 3 个 status 锚点：真链接、`/analytics`、`/quotes`；只有真链接内含 `<time>` | Status | 高 |
| 6 | `href` 是**相对路径**，必须读 `.href` 属性而非 `getAttribute('href')` | 全部 | 高 |
| 7 | **时间线操作栏没有 `[data-testid="bookmark"]`**（实测 0 个），组成为 回复/转推/喜欢/查看(`<a>`)/分享(button，无 testid) | Home | 高 |
| 8 | 详情页操作栏**有** bookmark，组成为 回复/转推/喜欢/bookmark/分享 | Status | 高 |
| 9 | 操作组是 `div[role="group"]`，`display:flex; justify-content:space-between`，前若干槽 `flex-grow:1` | Home / Status | 高 |
| 10 | **`[data-testid="AppTabBar"]` 容器不存在**，只有 6 个 `AppTabBar_*_Link` | 全部 | 高 |
| 11 | 侧栏列 = `<nav>` 与 `SideNav_AccountSwitcher_Button` 的最近公共祖先，`flex column` + `overflow-y:auto`，仅 2 个直接子元素（内容块 705px / 账号切换块 64px） | Home | 高 |
| 12 | `#layers` 存在且 `z-index: 1`；X 的弹窗/菜单/图片查看器都渲染在其中 | Home | 高 |
| 13 | `<body>` 的内联 `background-color` 是主题信号（实测 Light = `rgb(255,255,255)`） | Home | 中高 |
| 14 | 广告推文带 `[data-testid="placementTracking"]`（Home 抓到 3 条），且常无永久链接 | Home | 高 |

> ⚠️ 第 13 条只实测到 **Light** 一种主题。Dim（`rgb(21,32,43)`）和 Lights Out（`rgb(0,0,0)`）的取值
> 来自公开资料，**未在本次会话中实测**。主题切换的实际表现属于第 3 节。

---

## 2. 只在夹具 / 单元测试中验证 ⚠️

这些跑通了 130 个自动化测试，但**跑的是静态夹具，不是活的 X 页面**。夹具忠实来自真实 DOM，
所以结构性结论可信；但「X 运行时真的会这样重建 DOM 吗」这类动态行为，夹具答不了。

| 领域 | 测试文件 | 用例数 | 覆盖了什么 |
|---|---|---|---|
| 文件夹 CRUD | `folder-crud.test.ts` | 16 | 建根/建子/拒第三层/同级重名（含 Unicode 正规化）/跨父同名/trim/控制字符/折叠持久化/上移下移/position 归一化/边界 no-op/不跨父移动/FOLDER_NOT_FOUND/悬空 parentId 不成环 |
| 归属与 GC | `membership.test.ts` | 13 | 保存/重复保存幂等且 savedAt 不变/同推文多文件夹/移除其一保留/移除最后一个后 GC/MEMBERSHIP_NOT_FOUND/删文件夹只删自己的归属/级联删子树/删除预览计数/最近使用去重与上限 3/删除后清出最近使用/计数返回每个请求 ID/元数据 merge 不覆盖 |
| 分页 | `pagination.test.ts` | 8 | 倒序、50/页、120 条三页不漏不重/**25 条同毫秒 savedAt 不漏不重**/平局与非平局混合/nextCursor 恰好在耗尽时为 null/空文件夹/tweet 行缺失时跳过但不卡住分页/按文件夹隔离/重复保存不改变游标顺序 |
| 推文提取 | `tweet-extractor.test.ts` | 11 | Home 全量提取/广告一律 skip 不 retry/绝不返回 `/analytics` `/quotes`/引用子树识别/引用归属外层/**详情页焦点推文可提取**/读 `.href` 而非属性/twitter.com→x.com 且用户名取自 URL/换行与 Unicode 与 emoji alt/媒体推文空正文/半渲染 retry 与不可用 skip/非法 URL 拒绝 |
| 按钮注入 | `action-injection.test.ts` | 12 | 每条推文恰好一个/无 bookmark 时追加末尾/有 bookmark 时插其后/重复 ensure 幂等/重复宿主收敛/操作栏整体替换后恢复/**节点复用为另一推文时重建且状态不残留**/图标与 label 就地更新/点击不冒泡到卡片且不触发原生 bookmark/**上个上下文残留的宿主（closed root 已无法触达）被重建**/**页面脚本读不到宿主内部**/teardown 清空 |
| SPA 韧性 | `spa-resilience.test.ts` | 24 | cleanup 逆序/异常隔离/句柄语义/监听器真移除/single-flight 合并/200 次 mutation 合成一次 flush/detector 三种命中与去重与断连过滤/路由 0-250-1000ms 三段 ensure/切路由取消上一路由的待执行任务/**50 次连续导航不泄漏 timer**/URL 未变不触发/watchdog 各项/隐藏时暂停与恢复即补一次/异常不中断/dispose 后停止 |
| RPC 契约 | `rpc-contract.test.ts` | 9 | **非幂等方法不重试**（move/create/delete/removeTweet）/幂等方法恰好重试一次/重试上限为一次不成环/监听器同步注册且同步返回 true/**响应通道已关闭时不二次发送、不产生未处理 rejection**/非本插件消息不处理 |
| 增强器 | `tweet-enhancer.test.ts` | 8 | **200 条突发入队不同步处理**/超时间预算即让出/多轮 drain 后每条恰好一个按钮/广告打 skip 标记且不再入队/watchdog 扫描排除 skip/记录留存供弹层保存/dispose 清空队列 |
| 主题与状态 | `theme-and-stores.test.ts` | 14 | 三主题判定/每套调色板文字色与背景色不相等/token 只写宿主不写页面/切换后重新应用/仅真实变化才通知/树构建/活动文件夹消失即清空/**丢弃过期的并发快照**/storage 变更触发刷新/无关写入不触发/50ms 合并成一次 RPC/超 100 拆批/已知 ID 不重复请求而 invalidate 会/滚出视野后清理 |
| 保存弹层 | `save-popover.test.tsx` | 16 | 反复 open 保持单例/游离宿主收敛/勾选反映现有归属/保存/移除/重复保存幂等/弹层内建文件夹并立即保存/最近使用上限与完整路径/折叠树/Escape 关闭且焦点归还/外部点击关闭而内部不关/锚点断开时 ensure 关闭/**关闭后迟到的响应不改状态**/失败弹 danger toast/不可提取推文/dispose |
| Folder View | `folder-view.test.tsx` | 13 | 对齐主内容列/**插入到 `#layers` 之前**/逐页请求且 null 游标即停/1000 条不一次性渲染/移除后列表与计数更新且不重取/不安全 href 不渲染为链接/文件夹消失时 ensure 关闭/等 |

**合计：130 个用例，全部通过。**

---

## 3. 完全未验证 ❌

以下项目**没有任何验证**，写在这里是为了不让它们混进「已完成」：

| # | 未验证项 | 原因 |
|---|---|---|
| 1 | **端到端**：装扩展 → x.com 上出现侧栏 → 点按钮 → 存 → Folder View 浏览 → 跳回原推文 | 加载已解压扩展需修改浏览器设置，必须由用户操作 |
| 2 | Background Service Worker 在**真实 Chrome** 中的行为（被终止后重新唤醒、IndexedDB 真实持久化） | 同上。fake-indexeddb 与真实实现的自动提交时序不同 |
| 3 | `chrome.storage.onChanged` 的**真实跨标签**广播 | 同上。测试里用的是 stub |
| 4 | 侧栏在真实 X 中的**视觉效果与高度占用**（账号切换按钮是否真的没被挤出） | 需要真实渲染与布局 |
| 5 | **窄侧栏模式**的触发与浮层表现 | 需要真实窗口宽度变化 |
| 6 | **Dim / Lights Out 两种主题**的实际配色效果 | 本次只实测到 Light |
| 7 | Floating UI 弹层在真实滚动容器中的翻转/避让 | 需要真实布局 |
| 8 | Folder View overlay 与 X 弹窗的**真实层叠关系**（`#layers` 方案是否奏效） | 逻辑已按实测 z-index 设计并有测试，但视觉未验证 |
| 9 | 「X Sidebar 被整体替换后 2 秒内自愈」等**秒级指标** | 夹具中可验证逻辑正确性，真实时序未测 |
| 10 | 滚动性能（批量新增 200 条时是否真的不卡） | 已验证「不同步处理」，但真实帧率未测 |
| 11 | 扩展禁用/重载后页面**无残留** | 需要真实扩展生命周期 |
| 12 | 原生 Bookmark 在真实交互下**确未受影响** | 单元测试验证了不触发其 listener，真实点击未测 |
| 13 | Firefox / Edge 构建 | 非 v0.1.0 验收项 |
| 14 | Playwright E2E | Playwright 浏览器未安装；MV3 扩展 E2E 需要持久化 Chromium context。**未执行** |

---

## 4. 请你走一遍（端到端验收清单）

```bash
cd /Users/bee/Dev/Extension/folder-for-x
pnpm build
```

然后 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选 `.output/chrome-mv3`。

### 4.1 页面矩阵

| 页面 | 检查 |
|---|---|
| Home Timeline | 侧栏出现「我的收藏」且**只有一个**；每条可识别推文**恰好一个**文件夹按钮；广告推文没有按钮（预期行为） |
| 单条推文详情页 | **顶部主推文也要有按钮**（这是最容易坏的一条） |
| Thread（含多条回复） | 每条回复都有按钮 |
| 用户 Profile | 同 Home |
| 搜索结果 | 同 Home |
| X 原生 Bookmarks 页 | 插件按钮正常，且**原生书签功能不受影响** |

### 4.2 场景

- [ ] 页面首次加载 2 秒内侧栏出现
- [ ] 连续滚动，新推文 1 秒内拿到按钮，滚动不卡顿
- [ ] Home / Profile / Search 之间无刷新切换，侧栏不重复、不消失
- [ ] 收起/展开 X 侧栏，调窄窗口触发窄侧栏模式，图标按钮与浮层可用
- [ ] Light / Dim / Lights Out 三种主题下文字与背景对比正常
- [ ] 建根文件夹、建子文件夹、拒绝第三层、重命名（双击 / F2）、上移下移、删除（确认文案含子文件夹数与收藏数）
- [ ] 同一条推文保存到两个文件夹，图标变填充且 tooltip 显示数量
- [ ] 从一个文件夹移除，另一个仍在
- [ ] 点文件夹打开 Folder View，倒序正确，滚动加载下一页，点记录跳回原推文
- [ ] **Folder View 打开时，点 X 的推文「⋯」菜单或打开图片查看器——它们必须显示在 overlay 之上**
- [ ] 刷新页面，文件夹与折叠状态、收藏记录都还在
- [ ] 开第二个 X 标签页改文件夹，第一个标签页自动同步
- [ ] 原生 Bookmark 点击后行为完全正常
- [ ] `chrome://extensions` 重载扩展，页面无残留按钮/侧栏；刷新后恢复

### 4.3 出问题时

打开调试日志。在扩展的 service worker 控制台里（`chrome://extensions` → 检查视图 service worker）：

```js
chrome.storage.local.set({ 'xf:debug': true })
```

刷新后看控制台的 `[xf:*]` 输出。若看到 `sidebar fallback:` 或 `no action group`，说明 X 改版了——
修复流程见 [selector-playbook.md](./selector-playbook.md) 第 3 节。

---

## 5. 严禁提交的东西

真实账号的 Cookie、LocalStorage、浏览器 Profile，以及任何含私密内容的截图。

`tests/fixtures/` 里的夹具已脱敏并复检过（无真实用户名、无真实推文 ID、无 @handle、无 token/cookie
特征）。重新抓取夹具时**必须重做脱敏与复检**，流程见 selector-playbook 第 2 节。
