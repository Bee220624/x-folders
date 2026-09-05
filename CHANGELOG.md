# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-09-03

首个版本。

### 新增

- **文件夹树**：左侧栏「我的收藏」区域，支持两级层级（根 + 一层子文件夹）。新建、重命名（双击 / F2 / 右键菜单）、展开折叠（状态持久化）、同级上移下移、递归删除（确认对话框会说明将删除的子文件夹数与收藏数，并说明同一推文在其他文件夹中的记录不受影响）。
- **窄侧栏模式**：侧栏可用宽度不足时，改为注入一个与 X 导航项尺寸接近的图标按钮，点击弹出可滚动的树面板，与宽侧栏复用同一套数据与交互逻辑。
- **推文操作栏按钮**：为每条可识别推文注入一个文件夹按钮。未保存为轮廓图标，已保存为填充图标并在 tooltip / ARIA 中显示所属文件夹数量。
- **保存弹层**：body 级单例 Shadow DOM 弹层，Floating UI 定位。包含最近使用（最多 3 个）、全部文件夹树、当前归属勾选，以及弹层内新建根文件夹并立即保存。
- **Folder View**：对齐主内容列的覆盖层，按保存时间倒序、每页 50 条滚动加载，可从当前文件夹移除、可跳回原推文。
- **多文件夹归属**：同一条推文可属于多个文件夹；重复保存幂等；从最后一个文件夹移除后自动清理孤立的推文元数据。
- **跨标签同步**：任一标签页的写入会通知所有 X 标签页刷新。
- **主题适配**：Light / Dim / Lights Out。

### 技术要点

- Manifest V3，权限仅 `storage` 与 `unlimitedStorage`；内容脚本仅匹配 x.com 与 twitter.com。
- 数据库位于 Background Service Worker 的 IndexedDB（Dexie），是唯一事实来源；Content Script 通过带运行时校验的 typed RPC 访问。
- 跨标签广播走 `chrome.storage.onChanged` 而非 `tabs.sendMessage`——后者需要枚举标签，而 `content_scripts.matches` 在 MV3 中不授予 host permission，会导致广播静默失效。
- 三层 Observer（root lifecycle / tweet stream / theme）分离；MutationRecord 按帧合批；推文增强按 8ms 时间预算在空闲时段分片处理。
- SPA 路由变化后在 0 / 250 / 1000ms 各执行一次幂等 ensure，整体走 single-flight。
- 每 2 秒的自愈检查只扫描当前已挂载的节点，页面隐藏时完全停止。

### 安全与健壮性加固

发布前一轮对抗性审查（含变异测试）发现并修复的问题，全部有回归测试守护：

- **Shadow root 改为 `mode: 'closed'`**。此前用 `open`，意味着 x.com 页面里的任意脚本都能
  `document.querySelector('[data-xf-sidebar-host]').shadowRoot.textContent`，读走完整的私密文件夹树
  与已保存推文内容。这不是硬边界（页面若在 `document_idle` 之前 patch 过
  `Element.prototype.attachShadow` 仍可拿到），但把成本从一行 `querySelector` 抬高到一次刻意且可被
  察觉的 hook。
- **RPC 重试改为显式幂等白名单**。此前对超时一律重试，而超时表示*响应*丢失而非请求未达，会把已提交的
  写重放一遍——实测一次「上移」会移动两格。`create` / `delete` / `moveUp` / `moveDown` /
  `removeTweet` 现在永不重试，调用方改为失败后重新同步。
- **调试开关移出 x.com 的 localStorage**，改用扩展自有的 `chrome.storage.local`；此前站点可以打开
  插件的详细日志。
- **修复四处清理句柄泄漏**（根 observer / 路由 / 侧栏 ResizeObserver / 健康检查间隔）：清理注册表此前
  会随 DOM 变更批次、SPA 导航、标签页显隐次数无界增长。
- **修复 `singleFlight` 在拒绝后永久卡死**，此前一次异常会永久停掉运行时的自愈重入路径。
- **限制两个无界 Map**：滚动过的推文的计数与完整记录此前不会随虚拟列表卸载而释放。
- **`RpcServer` 不再在已关闭的响应通道上二次发送**，避免 Worker 内的未处理 rejection。
- **夹具脱敏改为默认拒绝**：此前只合成 `tweetText` 与 `User-Name` 内的文本，放过了一张真实行情卡。

### 第二轮审查修复

- **修复保存后图标会悄悄变回未保存**。推文滚入视野时会发起成员计数查询；若用户在查询在途时保存了这条
  推文，那个**保存前算出的**回复落地后会把乐观计数覆盖回 0。现在按写入次序做守卫：只丢弃比本地写入更旧
  的回复，而不是一律以本地为准。
- **修复删除确认框会抢焦点**。`ConfirmDialog` 的聚焦 effect 依赖 `[props]`，而 props 每次渲染都是新对象，
  于是任何一次后台刷新重渲染都会把焦点从用户刚选中的「取消」拽回「删除」——此时敲回车就删了。改为仅在
  挂载时聚焦。
- 新增领域层属性测试（`domain-fuzz.test.ts`）：随机操作序列 + 逐步不变量校验，并对五种页大小做完整分页
  往返。已验证它能捕获游标边界与孤立行回收的回归。

### 已知的 X DOM 适配要点

以下三点与常见写法相反，详见 [docs/selector-playbook.md](docs/selector-playbook.md)：

- 引用推文**不是**嵌套的 `[data-testid="tweet"]`，而是同一 `<article>` 内的 `div[role="link"][tabindex="0"]`。
- 推文详情页的焦点推文，其 header 中**没有** `<time>`，时间戳在正文下方独立的永久链接行里。
- 时间线的操作栏中**没有** `[data-testid="bookmark"]`（书签折叠进了分享菜单），仅详情页有。
