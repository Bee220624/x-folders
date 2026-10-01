# Selector Playbook

X 会改版。这份文档说明本项目**怎么定位 X 的 DOM**、**为什么这么定位**，以及**改版后如何最快修好**。

所有 selector 集中在 [`src/hosts/x/selectors.ts`](../src/hosts/x/selectors.ts)。代码里任何其他位置都不允许用字符串直接查询 x.com 的 DOM。

---

## 1. 定位优先级

1. **`data-testid` 优先。** X 从 React 组件名生成这些属性，改动频率远低于其他一切。
2. **结构/语义兜底。** `role`、标签名、相对位置关系。
3. **永远不用**：X 的混淆类名（`r-xxxxxxxx`）、深层 `nth-child` 路径、可本地化的 `aria-label` 文案。

第 3 条不是洁癖。X 的类名每次构建都会变；`aria-label` 在中文界面下是「分享帖子」，英文下是「Share post」，日文下又是另一个——任何依赖它的定位在换语言时就会静默失效。

---

## 2. 实测记录（2026-09-03，真实登录态）

这一节是本项目最有价值的部分：下面每一条都跟"想当然"的写法**相反**，而且每一条都对应一个真实的 bug。

### 2.1 引用推文不是嵌套的 tweet root

**想当然的写法**：引用推文是嵌套的 `[data-testid="tweet"]`，所以用 `node.closest('[data-testid="tweet"]') === root` 就能区分内外层。

**实际**：引用块是**同一个 `<article>` 内部**的 `div[role="link"][tabindex="0"]`，它自带 `User-Name`、`time`、`tweetText` 和 status 锚点，但**没有** `data-testid="tweet"`。

```
article[data-testid="tweet"]          <- 外层推文（唯一的 tweet root）
├─ div[data-testid="User-Name"]       <- 外层作者
├─ div[data-testid="tweetText"]       <- 外层正文
└─ div[role="link"][tabindex="0"]     <- 引用块，不是 tweet root
   ├─ div[data-testid="User-Name"]    <- 被引用者
   ├─ time
   └─ div[data-testid="tweetText"]    <- 被引用者的正文
```

**后果**：`closest()` 护栏对引用块内的每个节点都返回外层 `root`，护栏恒为真、**什么都没挡住**。一条"没有自己评论的引用推文"会把被引用者的正文和 URL 存成外层推文。

**正确做法**：先算出引用子树，再按**祖先包含关系**排除。见 `quoteSubtrees()`。

### 2.2 详情页焦点推文的 header 里没有 `<time>`

**想当然的写法**：`User-Name` → 找 `time` → `time.closest('a[href*="/status/"]')`。

**实际**：详情页（`/{user}/status/{id}`）的主推文（`article[tabindex="-1"]`）header 里**完全没有 `<time>`**。时间戳在正文下方一个独立的永久链接行里。同页的回复推文却是正常的。

**后果**：最重要的保存场景——详情页主推文——永远提取失败，按钮永远注入不上，watchdog 每 2 秒重试一次直到天荒地老。而且症状伪装成"只有顶部那条坏了"，很容易漏掉。

### 2.3 `/analytics` 和 `/quotes` 是诱饵锚点

详情页主推文里有 3 个 `a[href*="/status/"]`：真正的永久链接、`/status/{id}/analytics`、`/status/{id}/quotes`。后两个指向同一个 ID 但带后缀。

### 2.4 统一规则（同时解决 2.1 / 2.2 / 2.3）

> **外层推文的身份锚点 = 不在任何引用子树内、且内部包含 `<time>` 的那个 `a[href*="/status/"]`。**

- 时间线：这个锚点在 `User-Name` 里面。
- 详情页：这个锚点在正文下方的永久链接行里。
- `/analytics` 和 `/quotes` 里没有 `<time>`，自动被排除。

实现见 `findIdentityAnchor()`。

### 2.5 `href` 是相对路径

X 输出的是 `/{user}/status/{id}`，不是绝对 URL。**必须读 `anchor.href`（属性，已由浏览器解析为绝对地址），不能读 `anchor.getAttribute('href')`**，否则任何 `^https?://` 的正则都会失配。

### 2.6 Bookmark 按钮在时间线上不存在

| 页面 | 操作栏组成 |
|---|---|
| Home / Profile / Search | 回复 \| 转推 \| 喜欢 \| 查看(`<a>`) \| **分享**(button，无 testid) |
| 单条详情页 | 回复 \| 转推 \| 喜欢 \| **bookmark** \| 分享 |

时间线上 `[data-testid="bookmark"]` 的数量是 **0**——书签被折叠进了"分享"菜单。

**后果**："插到 Bookmark 之后"不是主路径，**追加到操作组末尾才是**。代码两条路都实现了，但不要把 fallback 当成罕见分支。

### 2.7 `[data-testid="AppTabBar"]` 容器不存在

只有逐项的 `AppTabBar_Home_Link` / `AppTabBar_Explore_Link` / `AppTabBar_Notifications_Link` / `AppTabBar_Direct...` 等。查询容器名会永远返回 null，导致侧栏定位从第一天起就走 fallback，而 selector 健康日志会一直误报。

**正确做法**：`navRoot: 'header[role="banner"] nav'` + `navItem: '[data-testid^="AppTabBar_"]'`，用后者的数量（≥2）来验证前者找对了。

### 2.8 侧栏结构

`<nav>` 与 `[data-testid="SideNav_AccountSwitcher_Button"]` 的**最近公共祖先**就是那一列：一个 `display:flex; flex-direction:column; overflow-y:auto` 的容器，只有 2 个直接子元素——上半部分（Logo + nav + 发帖按钮）和底部的账号切换块。

插入点：账号切换块**之前**。高度必须按 `column.clientHeight` 减去其他子元素实测高度动态算，**不能用固定 `40vh` 之类**——nav 的高度会随 X 增删导航项（Grok、Jobs、Communities）而变，写死就会把账号切换按钮挤出屏幕。

### 2.9 `#layers` 与 z-index

X 把**所有**弹窗、下拉菜单、图片查看器和自己的 toast 都渲染进 `#layers`，而 `#layers` 的 `z-index` 只有 **1**。

**后果**：body 级 overlay 如果用了大 z-index，会盖住 X 的一切弹层——Folder View 开着的时候，X 的菜单和图片查看器会看不见。

**正确做法**：overlay 的 z-index 保持小，并且把宿主插到 `#layers` **之前**，让 X 的层在文档顺序上永远胜出。

### 2.10 主题只有背景色可靠

`<body>` 上有内联的 `background-color`（Light `rgb(255,255,255)` / Dim `rgb(21,32,43)` / Lights Out `rgb(0,0,0)`）。**文字色、边框色、hover 色都在混淆类里**，`getComputedStyle(body)` 拿到的是浏览器默认值——在 Lights Out 下会得到"纯黑背景 + 黑字"。

**正确做法**：用背景色判定主题，再映射到 `ThemeAdapter` 里内置的三套调色板。

---

## 3. X 改版后的修复流程

### 第 1 步：跑夹具测试，看哪一层塌了

```bash
pnpm test
```

失败位置直接指向问题层：

| 失败的测试 | 说明坏掉的是 |
|---|---|
| `tweet-extractor.test.ts` | 身份提取 / 引用推文 / 正文 |
| `action-injection.test.ts` | 操作栏识别或插入位置 |
| `spa-resilience.test.ts` | 检测与批处理 |
| `tweet-enhancer.test.ts` | 提取与注入的串联 |

注意：夹具是**静态快照**。如果 X 改版了而夹具没更新，测试会**继续全绿**却和线上不符。所以第 2 步是必须的。

### 第 2 步：重新抓夹具

夹具不是手写的，是从真实登录态的 x.com 抓取后脱敏而来。重抓流程：

1. 在已登录的浏览器里打开 Home / 单条详情页 / Profile / Search。
2. 对每个页面，抓取 `header[role="banner"]` 的 `outerHTML` 和前若干个 `[data-testid="cellInnerDiv"]` 的 `outerHTML`。
3. **脱敏（必须做，不可跳过）**。

   > **默认拒绝，不要用允许清单。** 第一版脱敏脚本只合成了 `tweetText` 与 `User-Name` 内的文本，
   > 其余文本节点原样放行——结果放过了一张真实行情卡（`AAOI` / `$103.13` / `-0.25%`）。同一个缺口
   > 意味着任何渲染在这两个 testid 之外的真实内容都会原样留存：推荐关注模块、趋势条、卡片标题、
   > 社群名称。正确做法是**遍历所有文本节点**，只对结构性白名单（纯数字、时间、X 自己的界面文案）
   > 放行，其余一律替换。

   具体要做的：
   - 移除全部 `class` 与 `style` 属性（我们本来就不许依赖它们，去掉还能大幅缩小体积）；
   - `<svg>` 内容替换为占位 path，`<img>` 的 `src` 替换为 1px data URI；
   - 推文正文替换为合成文本（保留换行、Unicode、emoji `<img alt>` 这些**结构特征**）；
   - 显示名与 `@handle` 映射为合成账号（`alice`/`bob`/…）；
   - 推文 ID 映射为 `1000000000000000001` 起的连续合成 ID；
   - `data-testid="UserAvatar-Container-<用户名>"` 里嵌的用户名也要映射；
   - `aria-label` 文案替换为 `LABEL`（保留其中的数字，它们是结构的一部分）。
4. **必须保留**：`data-testid`、`role`、`tabindex`、`dir`、href 的路径结构、元素嵌套层级。这些才是被测的东西。
5. 落盘到 `tests/fixtures/x-*.html`，文件头写清来源、抓取日期和脱敏方式。

> ⚠️ 脱敏后**务必复检**：grep 一遍真实用户名、真实推文 ID、`@handle`、token/cookie 特征。第一版脱敏脚本曾因为"≤16 字符的短文本原样保留"这条规则放过了 9 个真实 @handle。

### 第 3 步：改 selector，别改调用方

只改 `src/hosts/x/selectors.ts`。如果发现自己要在组件里写选择器字符串，说明注册表少了一项——加进注册表，而不是就地硬编码。

### 第 4 步：打开 debug 日志

在扩展的 service worker 控制台里（`chrome://extensions` → 检查视图 service worker）：

```js
chrome.storage.local.set({ 'xf:debug': true })
```

刷新页面后，控制台会输出 `[xf:sidebar-locator]`、`[xf:inject]`、`[xf:route]` 等前缀的诊断信息，其中包括侧栏是通过哪条 fallback 命中的。**主 selector 失效时会走 fallback 但不会报错**——所以 fallback 命中的日志本身就是改版的早期信号。

---

## 4. 已知脆弱点排序

按"X 一改就会坏"的概率从高到低：

1. **操作栏组成**（2.6）——X 近年反复调整分享/书签的位置。缓解：语义识别 + 末尾追加兜底。
2. **引用块的 wrapper**（2.1）——目前判据是 `div[role="link"][tabindex="0"]` 且内部含 `User-Name`/`tweetText`。若 `role` 变了，`quoteSubtrees()` 会返回空，引用推文的正文归属就会出错。这是**静默**失效，优先补测试。
3. **详情页永久链接行**（2.2）——结构比 header 更"边缘"，改动风险高。兜底：焦点推文可以从 `location.pathname` 取 ID。
4. **侧栏列结构**（2.8）——公共祖先法比较稳，但 X 若把账号切换按钮移出该列就要重写。
5. `data-testid="tweet"` / `tweetText` / `User-Name` ——最稳定的一批，多年未变。

## 5. 快照相关实测（M2，2026-09-29 至 10-01）

提取帖子快照（`src/hosts/x/extract*.ts`）依据的事实，来自真实登录态 x.com 的只读实测和
`tests/fixtures/x-home-rich.html` 等 2026-09-30 的样本。

- **认证标记** `svg[data-testid="icon-verified"]` 在 `User-Name` 的第一个链接里；引用块的认证标记在它自己的
  `User-Name` 里。
- **头像** 在 `Tweet-User-Avatar` 里懒加载，`img` 与 `background-image` 两种画法都有；后台标签页里两者都
  还没有，所以保存时重新读取。当前地址多为 `_x96` 尺寸，存储时统一成 `_normal`。
- **视频**：`tweetPhoto > placementTracking > videoPlayer > videoComponent > video[poster]`，`src` 为
  `blob:`；GIF 的封面路径含 `/tweet_video_thumb/`。
- **广告**没有 `<time>`。`placementTracking` 不能单独作为广告判据：它会出现在普通视频帖内部，广告帖上则
  可能挂在帖子外层（`cellInnerDiv` 之内、`article` 之外）。
- **引用块** `div[role="link"][tabindex="0"]` 里**没有**链接：`@用户名` 在 `div[tabindex="-1"]` 里，时间在
  `div > time` 里；引用的媒体在 `testCondensedMedia` 里，敏感内容被 `previewInterstitial` 遮住。还见到
  `nestedQuotePreview`（引用里的引用），目前不读取。
- **「显示更多」**是 `tweetText` 的兄弟 `[data-testid="tweet-text-show-more-link"]`；详情页主帖显示全文，
  没有它。
- **链接卡片**：小卡片（`card.layoutSmall.media` + `card.layoutSmall.detail`）的域名、标题、描述都在卡片
  内部；大卡片（`card.layoutLarge.media`）内部只有图片和盖在图上的标题，域名印在卡片下方的另一个链接里
  （卡片的父容器之内、卡片之外）。域名与标题按文字的形状区分，不依赖界面语言。广告的大卡片里还会有视频
  或轮播（`LayoutCardCarousel-slide`）。
- **X 文章**的封面是 `article-cover-image`，目前不读取。
- **页面翻译**：Chrome 翻译会在文本里插入 `<font>`。提取按可见文字读取，结构不受影响，但读到的是译文。
- **x.com 上的 `<a>` 点击会被 X 自己的链接处理接管**：挂在页面上的下载链接不起作用，要放进封闭的 Shadow
  Root。反过来，`history.pushState` 加一次 `popstate` 事件就能让 X 在页面内切换路由（采集脚本的 `go()`）。
