# X Folders

在 X（Twitter）网页内部增加一套**本地**文件夹收藏系统。

它不是独立的书签管理器，也不是外部知识库。所有操作都在 X 页面里完成：左侧栏里建文件夹，每条推文的操作栏里多一个文件夹按钮，点一下存进去，点文件夹在主内容区浏览已存的推文，点记录跳回原推文。

**与 X 原生 Bookmark 完全独立**——插件不读取、不修改、不触发原生书签。

---

## 特性

- 左侧栏「我的收藏」文件夹树，支持两级（根 + 一层子文件夹）
- 新建 / 重命名 / 展开折叠 / 同级上移下移 / 递归删除（带确认）
- 每条可识别推文的操作栏中注入一个文件夹按钮
- 单例保存弹层：最近使用、当前归属勾选、弹层内新建文件夹并立即保存
- 同一条推文可同时属于多个文件夹；重复保存幂等
- Folder View 覆盖主内容列，按保存时间倒序分页浏览（每页 50 条）
- 数据存在扩展自己的 IndexedDB 里；**无后端、无 X API、无遥测、无远程代码**
- 适配 X 的 Light / Dim / Lights Out 三套主题
- X 的 SPA 导航和 React 重建后自动恢复，不产生重复注入

---

## 安装（开发者模式）

```bash
pnpm install
pnpm build
```

然后在 Chrome / Edge 中：

1. 打开 `chrome://extensions`
2. 打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」
4. 选择本仓库的 `.output/chrome-mv3` 目录

打包成 ZIP：

```bash
pnpm zip
```

产物在 `.output/` 下。

> **Node 版本**：WXT 0.21 要求 Node ≥ 22。另外 Node 25 起 corepack 不再随发行版附带，若没有 pnpm 请先 `npm i -g pnpm`。

---

## 开发

```bash
pnpm dev          # 开发模式，自动重载
pnpm typecheck    # wxt prepare && tsc --noEmit
pnpm lint         # eslint
pnpm test         # vitest run
pnpm test:watch   # vitest
```

调试日志默认关闭。开关放在**扩展自己的存储**里，所以要在扩展的 service worker 控制台里打开——
`chrome://extensions` → 找到本扩展 → 点「检查视图 service worker」：

```js
chrome.storage.local.set({ 'xf:debug': true })
```

刷新 x.com 后会看到 `[xf:*]` 前缀的诊断输出，其中包括 selector 是否走了 fallback——这是 X 改版的
早期信号。内容脚本的日志出现在**页面的**控制台里，后台的出现在 service worker 控制台里。

关掉：`chrome.storage.local.remove('xf:debug')`。

> 这个开关刻意不放在 `localStorage`。内容脚本里的 `localStorage` 属于**页面所属源**（x.com），
> 放在那里等于让 x.com 及它加载的任何脚本都能改扩展的日志级别。

---

## 权限

`manifest.permissions` 只有两项：

| 权限 | 用途 |
|---|---|
| `storage` | 跨标签变更通知通道（写入一条很小的变更记录，**不存收藏内容**） |
| `unlimitedStorage` | 让 IndexedDB 免于配额限制和存储压力驱逐，保证收藏不会被浏览器悄悄清掉 |

**没有** `tabs`、`cookies`、`webRequest`、`declarativeNetRequest`、`history`、`downloads`、`identity`，也没有 `<all_urls>`。内容脚本只匹配 `https://x.com/*` 和 `https://twitter.com/*`。

详见 [docs/privacy.md](docs/privacy.md)。

---

## 文档

| 文档 | 内容 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 架构、RPC 契约、事务纪律、分页契约、SPA 自愈 |
| [docs/selector-playbook.md](docs/selector-playbook.md) | X DOM 实测记录、改版后的修复流程 |
| [docs/privacy.md](docs/privacy.md) | 存了什么、没存什么、如何自行验证 |
| [docs/manual-qa.md](docs/manual-qa.md) | 手工验收矩阵与实际执行结果 |
| [docs/design-notes.md](docs/design-notes.md) | 设计参考与一手资料来源 |

---

## 不做什么

v0.1.0 明确不实现：AI 分类、标签、全文/语义搜索、X 原生书签导入或同步、X API / GraphQL / OAuth、云同步、导出（Markdown/JSON/PDF）、网页快照、媒体下载、拖拽排序、超过一层的子文件夹、多账号隔离、移动版 X、Safari 正式支持，以及任何数据分析或遥测。

---

## 许可证

[MIT](LICENSE)。

本项目为独立实现，未复制任何 GPL 项目的源码、样式、图标、文案或测试代码。参考来源见 [docs/design-notes.md](docs/design-notes.md)。
