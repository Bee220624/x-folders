# M1 最小闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 v0.1.0 第一次在真实 Chrome 里「装得上、用得了、不搞坏 X」：从看得见的 `dist/chrome-mv3` 安装 → 真实 x.com 上出现按钮 → 存进文件夹 → 页面内与侧边栏两处都能看到这条收藏；同时修掉审查发现的两个缺陷（按键外泄、全量重扫），并验证「在页面里点击打开侧边栏」是否可行。

**Architecture:** 在 v0.1.0 代码上做最小改动。新增一个 Chrome 侧边栏页面（复用现有的文件夹树和收藏列表组件）、两条独立于 RPC 的消息（打开侧边栏、让 X 标签页跳转到某条帖子）、一个统一的键盘隔离工具；新增 Playwright 端到端测试框架，加载构建后的真实扩展，把 x.com 请求指向本地页面样本。

**Tech Stack:** WXT 0.21、TypeScript（严格模式）、Preact、Dexie、Vitest + jsdom、Playwright（新增）、pnpm。

**依据：**
- 工单 `docs/superpowers/specs/2026-09-28-folders-for-x-v0.2-design.md` 第 5 节第 1 步
- 审查 `docs/superpowers/reviews/2026-09-28-v0.1.0-code-review.md` 第六节

**全局约定（每个任务都适用）：**
- 所有提交直接在 `main` 上，提交信息用中文，**不加任何 Claude / Anthropic 署名**。每个任务结束时 `git push origin main`。
- 每个任务结束前必须跑通：`pnpm typecheck`、`pnpm lint`、`pnpm test`。
- 需要用户动手或授权的步骤（下载 Chromium、加载扩展、用 Claude in Chrome 操作真实页面）先征得同意，不得跳过也不得代做。
- 任何测试失败：先用 superpowers:systematic-debugging 找根因，不许猜着改。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `wxt.config.ts` | 修改 | 输出目录改 `dist/`；声明 `action`（工具栏图标打开侧边栏需要） |
| `.gitignore`、`eslint.config.js` | 修改 | 忽略 `dist/`、Playwright 产物 |
| `package.json` | 修改 | `build:e2e`、`test:e2e` 脚本；Playwright 依赖 |
| `README.md` | 修改 | 安装路径改 `dist/chrome-mv3` |
| `src/ui/shared/keyboardIsolation.ts` | 新建 | 在插件宿主上拦截键盘事件，不让 X 看到 |
| `src/ui/shared/shadowMode.ts` | 新建 | Shadow Root 模式：只有端到端测试构建用 `open` |
| `src/ui/shared/ShadowHost.ts` | 修改 | 接入上面两项；更正注释（审查缺陷 5） |
| `src/hosts/x/TweetActionInjector.ts` | 修改 | 接入上面两项；新增只重绘不重新定位的 `repaint()` |
| `src/hosts/x/TweetEnhancer.ts` | 修改 | `refreshButtons()` 改用 `repaint()` |
| `src/hosts/x/XRuntime.ts` | 修改 | 根观察器不再全量重扫帖子（审查缺陷 2）；接入跳转请求 |
| `src/messaging/sidePanelProtocol.ts` | 新建 | 「打开侧边栏」「跳到帖子」两条消息的类型与判断 |
| `src/messaging/sidePanelClient.ts` | 新建 | 页面里请求后台打开侧边栏 |
| `src/background/sidePanel.ts` | 新建 | 后台：工具栏图标打开侧边栏；收到请求时在手势内打开 |
| `src/entrypoints/background.ts` | 修改 | 注册上一项 |
| `src/hosts/x/NavigateHandler.ts` | 新建 | 内容脚本：侧边栏让它跳到某条帖子时执行 |
| `src/sidepanel/openPost.ts` | 新建 | 侧边栏里点帖子：让当前 X 标签页跳转，否则新开标签页 |
| `src/sidepanel/styles.ts` | 新建 | 侧边栏页面样式（复用现有 CSS 字符串） |
| `src/sidepanel/SidePanelApp.tsx` | 新建 | 侧边栏界面：文件夹树 + 收藏列表 |
| `src/entrypoints/sidepanel/index.html`、`main.tsx` | 新建 | 侧边栏页面入口（WXT 自动写入 `side_panel` 与 `sidePanel` 权限） |
| `src/ui/shared/icons.ts` | 修改 | 新增侧边栏图标 |
| `src/ui/folder-view/FolderViewApp.tsx`、`folderView.css.ts` | 修改 | 标题栏「在侧边栏中打开」按钮（只在页面内覆盖层显示） |
| `src/hosts/x/FolderViewMount.tsx` | 修改 | 把按钮接到 `requestOpenSidePanel()` |
| `playwright.config.ts` | 新建 | 端到端测试配置 |
| `tests/e2e/harness.ts` | 新建 | 启动带扩展的 Chromium，把 x.com 指向本地样本 |
| `tests/e2e/minimal-loop.spec.ts` | 新建 | M1 端到端用例 |
| `tests/unit/keyboard-isolation.test.ts`、`shadow-mode.test.ts`、`xruntime-scan.test.ts`、`side-panel.test.ts`、`navigate-handler.test.ts`、`open-post.test.ts`、`side-panel-app.test.tsx`、`open-in-side-panel.test.tsx` | 新建 | 单元测试 |
| `docs/manual-qa.md`、`CHANGELOG.md` | 修改 | 真实 X 验证记录；未发布变更 |

---

### Task 1：构建产物输出到看得见的 `dist/`

**Files:**
- Modify: `wxt.config.ts`
- Modify: `.gitignore`
- Modify: `eslint.config.js:7`
- Modify: `README.md:25-47`

- [ ] **Step 1：改输出目录**

`wxt.config.ts` 中把

```ts
  srcDir: 'src',
  outDir: '.output',
```

改为

```ts
  srcDir: 'src',
  // Visible on purpose. `.output/` is hidden by the macOS file picker, and
  // "Load unpacked" on the repo root fails with "manifest missing".
  outDir: 'dist',
```

- [ ] **Step 2：忽略新产物目录**

`.gitignore` 在 `.output/` 一行后面加三行：

```
dist/
test-results/
playwright-report/
```

`eslint.config.js` 第 7 行改为：

```js
    ignores: ['node_modules/**', '.output/**', 'dist/**', 'test-results/**', 'playwright-report/**', '.wxt/**', 'tests/fixtures/**', '*.config.ts'],
```

- [ ] **Step 3：构建并确认产物位置**

Run: `pnpm build && ls dist/chrome-mv3/manifest.json`
Expected: 输出 `dist/chrome-mv3/manifest.json`

Run: `pnpm zip && ls dist/*.zip`
Expected: 输出 `dist/x-folders-0.1.0-chrome.zip`

- [ ] **Step 4：删掉旧的隐藏产物目录，避免装到过期构建**

Run: `rm -rf .output && ls -d .output`
Expected: `ls: .output: No such file or directory`

- [ ] **Step 5：更新 README 安装说明**

把 `README.md` 的「## 安装（开发者模式）」整节（到「---」之前）替换为：

````markdown
## 安装（开发者模式）

```bash
pnpm install
pnpm build
```

然后在 Chrome 中：

1. 打开 `chrome://extensions`，打开右上角「开发者模式」；
2. 点「加载已解压的扩展程序」；
3. 在弹出的选择框里按 `⌘ + ⇧ + G`，粘贴本仓库里 `dist/chrome-mv3` 的完整路径，回车后点「选择」。

> 要选的是 **`dist/chrome-mv3`**，不是仓库根目录——根目录没有 `manifest.json`，Chrome 会报「清单文件缺失或不可读取」。

打包成 ZIP：`pnpm zip`，产物在 `dist/` 下。

> **数据只保存在这台电脑的这个浏览器里。** 在扩展页点「移除」会连同全部收藏一起删除。

> **Node 版本**：WXT 0.21 要求 Node ≥ 22。若没有 pnpm，先 `npm i -g pnpm`。
````

- [ ] **Step 6：全量检查**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 三项都通过，`Tests  151 passed (151)`

- [ ] **Step 7：提交**

```bash
git add wxt.config.ts .gitignore eslint.config.js README.md
git commit -m "构建产物改为输出到可见的 dist/ 目录，更新安装说明"
git push origin main
```

---

### Task 2：统一键盘隔离（修复审查缺陷 1）

**Files:**
- Create: `src/ui/shared/keyboardIsolation.ts`
- Modify: `src/ui/shared/ShadowHost.ts`
- Modify: `src/hosts/x/TweetActionInjector.ts`
- Test: `tests/unit/keyboard-isolation.test.ts`

- [ ] **Step 1：写失败的测试**

新建 `tests/unit/keyboard-isolation.test.ts`：

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeAdapter } from '@/hosts/x/ThemeAdapter';
import { TweetActionInjector } from '@/hosts/x/TweetActionInjector';
import { createShadowHost } from '@/ui/shared/ShadowHost';
import { CleanupRegistry } from '@/utils/cleanup';
import { loadFixture } from '../helpers/fixtures';

const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const;

/** Stands in for X's page-level shortcut handler (bubble phase on document). */
function listenLikeThePage(): { seen: string[]; stop: () => void } {
  const seen: string[] = [];
  const record = (event: Event): void => {
    seen.push(`${event.type}:${(event as KeyboardEvent).key}`);
  };
  for (const type of KEY_EVENTS) document.addEventListener(type, record);
  return {
    seen,
    stop: () => {
      for (const type of KEY_EVENTS) document.removeEventListener(type, record);
    },
  };
}

function press(target: EventTarget, key: string): void {
  for (const type of KEY_EVENTS) {
    target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, composed: true }));
  }
}

describe('keyboard isolation', () => {
  let registry: CleanupRegistry | undefined;
  let page: ReturnType<typeof listenLikeThePage> | undefined;

  afterEach(() => {
    page?.stop();
    registry?.dispose();
    page = undefined;
    registry = undefined;
    document.body.innerHTML = '';
  });

  it('keeps keys typed into our UI away from page-level listeners', () => {
    registry = new CleanupRegistry();
    page = listenLikeThePage();
    const handle = createShadowHost({
      marker: 'data-xf-test-host',
      css: '',
      theme: new ThemeAdapter(),
      registry,
    });
    document.body.appendChild(handle.host);
    const input = document.createElement('input');
    handle.mount.appendChild(input);
    const seenByInput: string[] = [];
    input.addEventListener('keydown', (event) => seenByInput.push(event.key));

    for (const key of ['n', 'r', 't', 'l', 'j', 'k', 'Enter']) press(input, key);

    expect(seenByInput).toEqual(['n', 'r', 't', 'l', 'j', 'k', 'Enter']);
    expect(page.seen).toEqual([]);
  });

  it('leaves the page’s own keyboard handling alone', () => {
    page = listenLikeThePage();
    press(document.body, 'j');
    expect(page.seen).toEqual(['keydown:j', 'keypress:j', 'keyup:j']);
  });

  it('keeps keys pressed on an injected tweet button away from the page', () => {
    const { tweets } = loadFixture('x-home');
    page = listenLikeThePage();
    const injector = new TweetActionInjector(() => {});
    const result = tweets
      .map((tweet) => injector.ensure(tweet, { tweetId: '1', savedCount: 0 }))
      .find((candidate) => candidate !== null);
    const button = TweetActionInjector.buttonFor(result?.host);
    expect(button).not.toBeNull();

    if (button !== null) press(button, 'Enter');

    expect(page.seen).toEqual([]);
  });
});
```

- [ ] **Step 2：确认测试失败**

Run: `pnpm vitest run tests/unit/keyboard-isolation.test.ts`
Expected: FAIL，2 个失败（第 1、3 个用例，`page.seen` 里出现了按键），第 2 个通过

- [ ] **Step 3：实现键盘隔离**

新建 `src/ui/shared/keyboardIsolation.ts`：

```ts
const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const;

/**
 * Stops keyboard events that start inside one of our shadow hosts from
 * reaching x.com.
 *
 * X binds global shortcuts on the page (N new post, R reply, T repost, J/K
 * next/previous post…). From the page's side of a shadow root, both
 * `event.target` and `document.activeElement` are our host — a plain <div> —
 * so X cannot tell the user is typing into one of our inputs and would run a
 * shortcut for every letter. Stopping propagation at the host, in the bubble
 * phase, lets our own listeners inside the root see the event first while
 * nothing above the host — X's React root, document, window — sees it at all.
 *
 * Returns a function that removes the listeners again.
 */
export function isolateKeyboard(host: HTMLElement): () => void {
  const stop = (event: Event): void => {
    event.stopPropagation();
  };
  for (const type of KEY_EVENTS) host.addEventListener(type, stop);
  return () => {
    for (const type of KEY_EVENTS) host.removeEventListener(type, stop);
  };
}
```

- [ ] **Step 4：接入所有页面内宿主**

`src/ui/shared/ShadowHost.ts`：

(a) 在 import 区加一行：

```ts
import { isolateKeyboard } from './keyboardIsolation';
```

(b) 把 `createShadowHost` 上方注释里的这两段

```ts
 * The root is `closed` because these hosts hang in x.com's own document: with
 * `open`, any page script could read the user's entire folder tree out of
 * `document.querySelector('[data-xf-sidebar-host]').shadowRoot.textContent`,
 * and the saved-tweet authors and text out of the overlay host.
 *
 * This is not a hard boundary and should not be described as one. A page script
 * that patched `Element.prototype.attachShadow` before our `document_idle` run
 * would still capture every root we create. What it buys is cost and
 * visibility: harvesting goes from a one-line `querySelector` any script can do
 * incidentally to a deliberate, early, detectable prototype hook.
```

替换为

```ts
 * The root is `closed` because these hosts hang in x.com's own document: with
 * `open`, any page script could read the user's entire folder tree out of
 * `document.querySelector('[data-xf-sidebar-host]').shadowRoot.textContent`,
 * and the saved-tweet authors and text out of the overlay host. Patching
 * `Element.prototype.attachShadow` does not get around this: content scripts
 * run in an isolated world with their own prototypes, so a page-side patch
 * never sees our calls.
 *
 * Keyboard events are stopped at the host (see `isolateKeyboard`): from the
 * page's side, a user typing into our input looks like key presses on a plain
 * <div>, which X would run as shortcuts.
```

(c) 把

```ts
  const unregisterTheme = options.theme.register(host);
  // The handle both runs the teardown and takes it off the registry, so calling
  // dispose() early and letting the registry dispose later are the same thing.
  const teardown = options.registry.add(() => {
    unregisterTheme();
    host.remove();
  });
```

替换为

```ts
  const unregisterTheme = options.theme.register(host);
  const releaseKeyboard = isolateKeyboard(host);
  // The handle both runs the teardown and takes it off the registry, so calling
  // dispose() early and letting the registry dispose later are the same thing.
  const teardown = options.registry.add(() => {
    releaseKeyboard();
    unregisterTheme();
    host.remove();
  });
```

`src/hosts/x/TweetActionInjector.ts`：

(a) 在 import 区加一行：

```ts
import { isolateKeyboard } from '@/ui/shared/keyboardIsolation';
```

(b) 把类注释中的

```ts
 * The shadow root is `closed`: the host sits in x.com's own document, and an
 * open root would let any page script walk our UI. As on the other hosts this
 * is a cost increase, not a boundary — a page script that patched
 * `Element.prototype.attachShadow` before our `document_idle` run would capture
 * these roots anyway — but it takes reading our DOM from a one-line
 * `querySelector` to a deliberate, detectable hook.
```

替换为

```ts
 * The shadow root is `closed`: the host sits in x.com's own document, and an
 * open root would let any page script walk our UI. Key presses on the button
 * are stopped at the host so X never mistakes them for its own shortcuts.
```

(c) 在 `#createHost` 里 `shadow.appendChild(button);` 之后加：

```ts
    // Removed together with the host; there is nothing to unregister.
    isolateKeyboard(host);
```

- [ ] **Step 5：确认测试通过**

Run: `pnpm vitest run tests/unit/keyboard-isolation.test.ts`
Expected: PASS，3 passed

- [ ] **Step 6：全量检查**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 全部通过，`Tests  154 passed (154)`

- [ ] **Step 7：提交**

```bash
git add src/ui/shared/keyboardIsolation.ts src/ui/shared/ShadowHost.ts src/hosts/x/TweetActionInjector.ts tests/unit/keyboard-isolation.test.ts
git commit -m "插件界面的按键不再外泄给 X，避免触发 X 快捷键"
git push origin main
```

---

### Task 3：端到端测试专用构建（Shadow Root 改为 open）

Playwright 和页面都够不到 closed Shadow Root，端到端测试无法点击弹层和侧栏里的元素。只有 `wxt build --mode e2e` 产出的测试构建用 `open`，它输出到单独的 `dist/chrome-mv3-e2e/`，只给测试框架加载；你安装的 `dist/chrome-mv3/` 仍是 `closed`（Task 8 在真实页面上复核）。

**Files:**
- Create: `src/ui/shared/shadowMode.ts`
- Modify: `src/ui/shared/ShadowHost.ts`
- Modify: `src/hosts/x/TweetActionInjector.ts`
- Modify: `package.json`
- Test: `tests/unit/shadow-mode.test.ts`

- [ ] **Step 1：写失败的测试**

新建 `tests/unit/shadow-mode.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { shadowMode } from '@/ui/shared/shadowMode';

describe('shadowMode', () => {
  it('is closed in every build except the browser-test build', () => {
    expect(import.meta.env.MODE).not.toBe('e2e');
    expect(shadowMode()).toBe('closed');
  });
});
```

- [ ] **Step 2：确认测试失败**

Run: `pnpm vitest run tests/unit/shadow-mode.test.ts`
Expected: FAIL，找不到模块 `@/ui/shared/shadowMode`

- [ ] **Step 3：实现**

新建 `src/ui/shared/shadowMode.ts`：

```ts
/**
 * Closed in every real build: our hosts live in x.com's document, and an open
 * root would let any page script read the user's folders and saved posts.
 *
 * The one exception is the Playwright build (`wxt build --mode e2e`, output in
 * `dist/chrome-mv3-e2e`). Browser tests have to click through the popover and
 * the sidebar, and neither Playwright nor the page can reach into a closed
 * root. That build is only ever loaded by the test harness.
 */
export function shadowMode(): ShadowRootMode {
  return import.meta.env.MODE === 'e2e' ? 'open' : 'closed';
}
```

`src/ui/shared/ShadowHost.ts`：import 区加 `import { shadowMode } from './shadowMode';`，并把

```ts
  const root = host.attachShadow({ mode: 'closed' });
```

改为

```ts
  const root = host.attachShadow({ mode: shadowMode() });
```

`src/hosts/x/TweetActionInjector.ts`：import 区加 `import { shadowMode } from '@/ui/shared/shadowMode';`，并把

```ts
    const shadow = host.attachShadow({ mode: 'closed' });
```

改为

```ts
    const shadow = host.attachShadow({ mode: shadowMode() });
```

`package.json` 的 `scripts` 里，在 `"build"` 后面加一行：

```json
    "build:e2e": "wxt build --mode e2e",
```

- [ ] **Step 4：确认测试通过、测试构建位置正确**

Run: `pnpm vitest run tests/unit/shadow-mode.test.ts`
Expected: PASS

Run: `pnpm build:e2e && ls dist/chrome-mv3-e2e/manifest.json`
Expected: 输出 `dist/chrome-mv3-e2e/manifest.json`

- [ ] **Step 5：全量检查**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 全部通过，`Tests  155 passed (155)`

- [ ] **Step 6：提交**

```bash
git add src/ui/shared/shadowMode.ts src/ui/shared/ShadowHost.ts src/hosts/x/TweetActionInjector.ts package.json tests/unit/shadow-mode.test.ts
git commit -m "新增端到端测试专用构建，仅该构建的 Shadow Root 为 open"
git push origin main
```

---

### Task 4：页面变动不再触发全量重扫（修复审查缺陷 2）

两处改动：根观察器只做「整体被替换」的修复，不再重新提取所有帖子；数量更新后只重绘按钮，不再为每个按钮重新定位操作栏。

**Files:**
- Modify: `src/hosts/x/XRuntime.ts:132-188`
- Modify: `src/hosts/x/TweetActionInjector.ts`
- Modify: `src/hosts/x/TweetEnhancer.ts:130-139`
- Test: `tests/unit/xruntime-scan.test.ts`
- Test: `tests/unit/action-injection.test.ts`（追加用例）

- [ ] **Step 1：写失败的测试**

新建 `tests/unit/xruntime-scan.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const counter = vi.hoisted(() => ({ extractions: 0 }));

vi.mock('@/hosts/x/TweetExtractor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hosts/x/TweetExtractor')>();
  return {
    ...actual,
    extractTweet: (...args: Parameters<typeof actual.extractTweet>) => {
      counter.extractions += 1;
      return actual.extractTweet(...args);
    },
  };
});

import { XRuntime } from '@/hosts/x/XRuntime';
import { loadFixture } from '../helpers/fixtures';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('XRuntime scanning', () => {
  let runtime: XRuntime | undefined;

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
    counter.extractions = 0;
  });

  it('does not re-extract every post when X changes unrelated parts of the page', async () => {
    loadFixture('x-home');
    runtime = new XRuntime();
    runtime.start();
    await sleep(300); // the start-up scan drains in idle slices
    const afterStart = counter.extractions;
    expect(afterStart).toBeGreaterThan(0);

    const nav = document.querySelector('header[role="banner"] nav');
    expect(nav).not.toBeNull();
    // Stays under the 2s health tick, so only the root observer can react.
    for (let i = 0; i < 8; i += 1) {
      nav?.appendChild(document.createElement('div'));
      await sleep(150); // past the 120ms root debounce every time
    }
    await sleep(200);

    expect(counter.extractions).toBe(afterStart);
  });

  // Passes before and after the change: it guards the one case the removed
  // full scan used to cover — X swapping in a whole new primary column.
  it('scans a replacement primary column once when X swaps it in', async () => {
    loadFixture('x-home');
    runtime = new XRuntime();
    runtime.start();
    await sleep(300);

    const column = document.querySelector('[data-testid="primaryColumn"]');
    expect(column).not.toBeNull();
    const replacement = column?.cloneNode(true) as HTMLElement;
    replacement.querySelectorAll('[data-xf-action-host]').forEach((host) => host.remove());
    column?.replaceWith(replacement);
    await sleep(500);

    const tweets = Array.from(
      replacement.querySelectorAll('article[data-testid="tweet"]:not([data-xf-skip])'),
    );
    expect(tweets.length).toBeGreaterThan(0);
    for (const tweet of tweets) {
      expect(tweet.querySelectorAll('[data-xf-action-host]')).toHaveLength(1);
    }
  });
});
```

在 `tests/unit/action-injection.test.ts` 末尾的 `describe` 块内追加（沿用该文件已有的 `loadFixture` 导入）：

```ts
  it('repaints its own host without rebuilding it, and ignores hosts it did not create', () => {
    const { tweets } = loadFixture('x-home');
    const injector = new TweetActionInjector(() => {});
    const result = tweets
      .map((tweet) => injector.ensure(tweet, { tweetId: '1', savedCount: 0 }))
      .find((candidate) => candidate !== null);
    expect(result).toBeDefined();
    const host = result?.host ?? null;
    const button = TweetActionInjector.buttonFor(host);

    if (host !== null) injector.repaint(host, 2);
    expect(TweetActionInjector.buttonFor(host)).toBe(button);
    expect(button?.getAttribute('data-saved')).toBe('true');
    expect(button?.getAttribute('aria-label')).toBe('已保存到 2 个文件夹');

    const foreign = document.createElement('div');
    foreign.setAttribute('data-xf-action-host', '');
    foreign.setAttribute('data-xf-tweet-id', '1');
    expect(() => injector.repaint(foreign, 3)).not.toThrow();
  });
```

- [ ] **Step 2：确认测试失败**

Run: `pnpm vitest run tests/unit/xruntime-scan.test.ts tests/unit/action-injection.test.ts`
Expected: FAIL：`does not re-extract…` 失败（提取次数大于启动时）；`repaints its own host…` 失败（`injector.repaint is not a function`）；其余通过

- [ ] **Step 3：根观察器只做轻量修复**

`src/hosts/x/XRuntime.ts`，把

```ts
  /** Idempotent; safe to call from any observer, timer or route change. */
  async #ensureAll(): Promise<void> {
    if (this.#registry.disposed) return;
    this.#sidebar.ensure();
    this.#folderView.ensure();
    this.#popover.ensure();
    this.#retargetTweetStream();
    this.#enhancer.enqueue(scanTweetRoots(document));
  }
```

替换为

```ts
  /**
   * Full pass: every mounted tweet plus the chrome around them. Runs at
   * start-up and after route changes, when X re-renders the timeline wholesale.
   */
  async #ensureAll(): Promise<void> {
    if (this.#registry.disposed) return;
    this.#ensureChrome();
    this.#enhancer.enqueue(scanTweetRoots(document));
  }

  /**
   * Cheap pass for the root observer: re-mount what X may have replaced and
   * re-point the tweet stream observer. Tweets are deliberately not scanned
   * here — X's DOM changes constantly, and re-extracting every mounted tweet
   * after each burst is wasted work that competes with scrolling. New tweets
   * arrive through the stream observer; a replacement primary column is
   * scanned once, when the observer moves onto it.
   */
  #ensureChrome(): void {
    if (this.#registry.disposed) return;
    this.#sidebar.ensure();
    this.#folderView.ensure();
    this.#popover.ensure();
    this.#retargetTweetStream();
  }
```

把根观察器回调里的

```ts
      this.#rootDebounce = setTimeout(() => {
        this.#rootDebounce = null;
        this.#route.check();
        void this.#reinitialize();
      }, ROOT_DEBOUNCE_MS);
```

替换为

```ts
      this.#rootDebounce = setTimeout(() => {
        this.#rootDebounce = null;
        this.#route.check();
        this.#ensureChrome();
      }, ROOT_DEBOUNCE_MS);
```

把

```ts
  /** Re-points the stream observer when X swaps the primary column out. */
  #retargetTweetStream(): void {
    const target = document.querySelector(X_SELECTORS.primaryColumn) ?? document.body;
    if (target === this.#streamTarget || this.#streamBatcher === null) return;
    this.#streamTarget = target;
    this.#streamBatcher.observe(target, { childList: true, subtree: true });
    log.debug('tweet stream observer retargeted');
  }
```

替换为

```ts
  /** Re-points the stream observer when X swaps the primary column out. */
  #retargetTweetStream(): void {
    const target = document.querySelector(X_SELECTORS.primaryColumn) ?? document.body;
    if (target === this.#streamTarget || this.#streamBatcher === null) return;
    const replaced = this.#streamTarget !== null;
    this.#streamTarget = target;
    this.#streamBatcher.observe(target, { childList: true, subtree: true });
    // Tweets X rendered into the new column before we were watching it never
    // produced a mutation record we could see.
    if (replaced) this.#enhancer.enqueue(scanTweetRoots(target));
    log.debug('tweet stream observer retargeted');
  }
```

- [ ] **Step 4：数量更新只重绘**

`src/hosts/x/TweetActionInjector.ts`，在 `#createHost` 方法之前加：

```ts
  /**
   * Repaints a host this context created. No DOM lookups, so it is cheap
   * enough to run over every button on the page after each count update.
   * A host from an earlier context (not in the WeakMap) is left alone; the
   * next `ensure()` for its tweet rebuilds it.
   */
  repaint(host: HTMLElement, savedCount: number): void {
    if (!buttons.has(host)) return;
    const tweetId = host.getAttribute(XF_ATTR.tweetId);
    if (tweetId === null) return;
    this.#applyState(host, { tweetId, savedCount });
  }
```

`src/hosts/x/TweetEnhancer.ts`，把

```ts
  /** Repaints buttons after a membership count changes. */
  refreshButtons(scope: ParentNode = document): void {
    for (const host of hostsIn(scope)) {
      const tweetId = host.getAttribute(XF_ATTR.tweetId);
      if (tweetId === null) continue;
      const root = host.closest<HTMLElement>(X_SELECTORS.tweetRoot);
      if (root === null) continue;
      this.injector.ensure(root, { tweetId, savedCount: this.counts.countFor(tweetId) });
    }
  }
```

替换为

```ts
  /**
   * Repaints buttons after a membership count changes. Paint only: running the
   * full `ensure()` here re-located every action bar on the page for each
   * count reply, which is exactly the burst of work a long scroll cannot
   * afford.
   */
  refreshButtons(scope: ParentNode = document): void {
    for (const host of hostsIn(scope)) {
      const tweetId = host.getAttribute(XF_ATTR.tweetId);
      if (tweetId === null) continue;
      this.injector.repaint(host, this.counts.countFor(tweetId));
    }
  }
```

如果 `X_SELECTORS` 在 `TweetEnhancer.ts` 中已不再被使用，`pnpm lint` 不会报错（它仍被 `tweetsMissingButton` 使用）；保持 import 不变。

- [ ] **Step 5：确认测试通过**

Run: `pnpm vitest run tests/unit/xruntime-scan.test.ts tests/unit/action-injection.test.ts`
Expected: PASS（`xruntime-scan` 2 passed；`action-injection` 13 passed）

- [ ] **Step 6：全量检查**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 全部通过，`Tests  158 passed (158)`

- [ ] **Step 7：提交**

```bash
git add src/hosts/x/XRuntime.ts src/hosts/x/TweetActionInjector.ts src/hosts/x/TweetEnhancer.ts tests/unit/xruntime-scan.test.ts tests/unit/action-injection.test.ts
git commit -m "页面变动后不再全量重扫帖子，数量更新只重绘按钮"
git push origin main
```

---

### Task 5：后台打开侧边栏

**Files:**
- Create: `src/messaging/sidePanelProtocol.ts`
- Create: `src/background/sidePanel.ts`
- Modify: `src/entrypoints/background.ts`
- Modify: `wxt.config.ts`
- Test: `tests/unit/side-panel.test.ts`

- [ ] **Step 1：写失败的测试**

新建 `tests/unit/side-panel.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSidePanel } from '@/background/sidePanel';
import { OPEN_SIDE_PANEL, type SimpleResponse } from '@/messaging/sidePanelProtocol';

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: SimpleResponse) => void,
) => boolean;

describe('background side panel opener', () => {
  const open = vi.fn<(options: { tabId: number }) => Promise<void>>();
  const setPanelBehavior = vi.fn<(behavior: { openPanelOnActionClick: boolean }) => Promise<void>>();
  let listener: Listener;

  beforeEach(() => {
    open.mockReset().mockResolvedValue(undefined);
    setPanelBehavior.mockReset().mockResolvedValue(undefined);
    Object.assign(chrome, { sidePanel: { open, setPanelBehavior } });
    vi.mocked(chrome.runtime.onMessage.addListener).mockClear();
    registerSidePanel();
    const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
    listener = calls[calls.length - 1]?.[0] as unknown as Listener;
  });

  it('lets the toolbar icon open the panel', () => {
    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it('opens the panel for the sender tab synchronously, inside the gesture', async () => {
    const sendResponse = vi.fn();
    const keepChannelOpen = listener(
      { kind: OPEN_SIDE_PANEL },
      { tab: { id: 7 } as chrome.tabs.Tab },
      sendResponse,
    );
    // Called before the listener returned: nothing was awaited first.
    expect(open).toHaveBeenCalledWith({ tabId: 7 });
    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
  });

  it('reports a refusal instead of throwing', async () => {
    open.mockRejectedValue(new Error('may only be called in response to a user gesture'));
    const sendResponse = vi.fn();
    listener({ kind: OPEN_SIDE_PANEL }, { tab: { id: 7 } as chrome.tabs.Tab }, sendResponse);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false })),
    );
  });

  it('leaves every other message to the RPC listener', () => {
    const sendResponse = vi.fn();
    expect(listener({ kind: 'xf:rpc', method: 'health.ping' }, {}, sendResponse)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2：确认测试失败**

Run: `pnpm vitest run tests/unit/side-panel.test.ts`
Expected: FAIL，找不到模块 `@/background/sidePanel`

- [ ] **Step 3：消息协议**

新建 `src/messaging/sidePanelProtocol.ts`：

```ts
/**
 * Messages that deliberately live outside the RPC table, because each has a
 * constraint the generic RPC path would hide:
 *  - opening the side panel must happen synchronously inside the background
 *    listener, while the user's click still counts as a gesture;
 *  - navigation requests go *to* a content script, which RPC never does.
 */

export const OPEN_SIDE_PANEL = 'xf:open-side-panel';
export const NAVIGATE_TO_POST = 'xf:navigate';

export interface OpenSidePanelRequest {
  kind: typeof OPEN_SIDE_PANEL;
}

export interface NavigateRequest {
  kind: typeof NAVIGATE_TO_POST;
  url: string;
}

export interface SimpleResponse {
  ok: boolean;
  message?: string;
}

function kindOf(value: unknown): unknown {
  return typeof value === 'object' && value !== null
    ? (value as { kind?: unknown }).kind
    : undefined;
}

export function isOpenSidePanelRequest(value: unknown): value is OpenSidePanelRequest {
  return kindOf(value) === OPEN_SIDE_PANEL;
}

export function isNavigateRequest(value: unknown): value is NavigateRequest {
  return (
    kindOf(value) === NAVIGATE_TO_POST && typeof (value as { url?: unknown }).url === 'string'
  );
}

export function isSimpleResponse(value: unknown): value is SimpleResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  );
}
```

- [ ] **Step 4：后台实现**

新建 `src/background/sidePanel.ts`：

```ts
import { isOpenSidePanelRequest, type SimpleResponse } from '@/messaging/sidePanelProtocol';
import { createLogger } from '@/utils/logger';

const log = createLogger('side-panel');

/**
 * Two ways into the side panel: the toolbar icon, and a click inside x.com.
 *
 * `chrome.sidePanel.open()` is only honoured while the user gesture that led to
 * it is still live, so it is called synchronously inside the listener —
 * before anything is awaited — for the sender's own tab.
 *
 * Must be called synchronously at worker start, like the RPC listener.
 */
export function registerSidePanel(): void {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => log.warn('setPanelBehavior failed', error));

  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: SimpleResponse) => void,
    ): boolean => {
      if (!isOpenSidePanelRequest(message)) return false;
      const reply = (response: SimpleResponse): void => {
        try {
          sendResponse(response);
        } catch (error) {
          log.debug('response channel closed', error);
        }
      };
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        reply({ ok: false, message: 'no-tab' });
        return false;
      }
      chrome.sidePanel
        .open({ tabId })
        .then(() => reply({ ok: true }))
        .catch((error: unknown) => {
          log.warn('sidePanel.open failed', error);
          reply({ ok: false, message: error instanceof Error ? error.message : String(error) });
        });
      return true;
    },
  );
}
```

`src/entrypoints/background.ts` 替换为：

```ts
import { createHandlers } from '@/background/rpc/handlers';
import { registerRpcServer } from '@/background/rpc/RpcServer';
import { registerSidePanel } from '@/background/sidePanel';
import { applyStoredLogLevel } from '@/utils/logger';

export default defineBackground({
  type: 'module',
  main() {
    // Registered synchronously during module evaluation. A listener attached
    // after an await would not exist when the worker is woken *by* a message,
    // and that message would be dropped.
    registerRpcServer(createHandlers());
    registerSidePanel();

    // Deliberately after the listeners and deliberately not awaited: the log
    // level is not worth delaying message registration for.
    void applyStoredLogLevel();
  },
});
```

`wxt.config.ts` 的 `manifest` 里，在 `permissions` 一行前加：

```ts
    // The toolbar icon is one of the two ways into the side panel; without an
    // `action` key, sidePanel.setPanelBehavior has nothing to bind to.
    action: { default_title: 'X Folders' },
```

- [ ] **Step 5：确认测试通过**

Run: `pnpm vitest run tests/unit/side-panel.test.ts`
Expected: PASS，4 passed

- [ ] **Step 6：全量检查**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 全部通过，`Tests  162 passed (162)`

- [ ] **Step 7：提交**

```bash
git add src/messaging/sidePanelProtocol.ts src/background/sidePanel.ts src/entrypoints/background.ts wxt.config.ts tests/unit/side-panel.test.ts
git commit -m "后台支持从工具栏和页面点击打开侧边栏"
git push origin main
```

---

### Task 6：内容脚本接受「跳到这条帖子」请求

**Files:**
- Create: `src/hosts/x/NavigateHandler.ts`
- Modify: `src/hosts/x/XRuntime.ts`（`start()`）
- Test: `tests/unit/navigate-handler.test.ts`

- [ ] **Step 1：写失败的测试**

新建 `tests/unit/navigate-handler.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listenForNavigateRequests } from '@/hosts/x/NavigateHandler';
import { NAVIGATE_TO_POST, type SimpleResponse } from '@/messaging/sidePanelProtocol';
import { CleanupRegistry } from '@/utils/cleanup';

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: SimpleResponse) => void,
) => boolean;

const POST = 'https://x.com/alice/status/1000000000000000001';

describe('navigate requests from the side panel', () => {
  const navigate = vi.fn<(url: string) => void>();
  let registry: CleanupRegistry;
  let listener: Listener;

  beforeEach(() => {
    navigate.mockReset();
    vi.mocked(chrome.runtime.onMessage.addListener).mockClear();
    vi.mocked(chrome.runtime.onMessage.removeListener).mockClear();
    registry = new CleanupRegistry();
    listenForNavigateRequests(registry, navigate);
    listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0]?.[0] as unknown as Listener;
  });

  it('answers first, then navigates to a safe x.com post', () => {
    const sendResponse = vi.fn();
    listener({ kind: NAVIGATE_TO_POST, url: POST }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    expect(navigate).toHaveBeenCalledWith(POST);
    expect(sendResponse.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('refuses anything that is not an https x.com URL', () => {
    for (const url of ['javascript:alert(1)', 'https://evil.example/x', 'http://x.com/a/status/1']) {
      const sendResponse = vi.fn();
      listener({ kind: NAVIGATE_TO_POST, url }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores other messages', () => {
    const sendResponse = vi.fn();
    expect(listener({ kind: 'xf:rpc' }, {}, sendResponse)).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('stops listening when the content script is disposed', () => {
    registry.dispose();
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(listener);
  });
});
```

- [ ] **Step 2：确认测试失败**

Run: `pnpm vitest run tests/unit/navigate-handler.test.ts`
Expected: FAIL，找不到模块 `@/hosts/x/NavigateHandler`

- [ ] **Step 3：实现**

新建 `src/hosts/x/NavigateHandler.ts`：

```ts
import { isNavigateRequest, type SimpleResponse } from '@/messaging/sidePanelProtocol';
import type { CleanupRegistry } from '@/utils/cleanup';
import { isSafeXUrl } from '@/utils/url';

/**
 * Lets the side panel open a saved post in this tab.
 *
 * The URL is re-checked here: it crossed a context boundary and is treated as
 * untrusted. The reply goes out *before* navigating, because navigating tears
 * this content script down and the side panel would otherwise wait for an
 * answer that never comes.
 */
export function listenForNavigateRequests(
  registry: CleanupRegistry,
  navigate: (url: string) => void = (url) => location.assign(url),
): void {
  const listener = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: SimpleResponse) => void,
  ): boolean => {
    if (!isNavigateRequest(message)) return false;
    if (!isSafeXUrl(message.url)) {
      sendResponse({ ok: false, message: 'unsafe-url' });
      return false;
    }
    sendResponse({ ok: true });
    navigate(message.url);
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  registry.add(() => chrome.runtime.onMessage.removeListener(listener));
}
```

`src/hosts/x/XRuntime.ts`：import 区加

```ts
import { listenForNavigateRequests } from './NavigateHandler';
```

在 `start()` 里 `this.#health.start();` 之后加一行：

```ts
    listenForNavigateRequests(this.#registry);
```

- [ ] **Step 4：确认测试通过**

Run: `pnpm vitest run tests/unit/navigate-handler.test.ts`
Expected: PASS，4 passed

- [ ] **Step 5：全量检查**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 全部通过，`Tests  166 passed (166)`

- [ ] **Step 6：提交**

```bash
git add src/hosts/x/NavigateHandler.ts src/hosts/x/XRuntime.ts tests/unit/navigate-handler.test.ts
git commit -m "内容脚本支持由侧边栏发起的帖子跳转"
git push origin main
```

---

### Task 7：侧边栏页面

**Files:**
- Create: `src/sidepanel/openPost.ts`
- Create: `src/sidepanel/styles.ts`
- Create: `src/sidepanel/SidePanelApp.tsx`
- Create: `src/entrypoints/sidepanel/index.html`
- Create: `src/entrypoints/sidepanel/main.tsx`
- Test: `tests/unit/open-post.test.ts`
- Test: `tests/unit/side-panel-app.test.tsx`

- [ ] **Step 1：写 `openPost` 的失败测试**

新建 `tests/unit/open-post.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openPost } from '@/sidepanel/openPost';

const POST = 'https://x.com/alice/status/1000000000000000001';

function setLastError(value: { message: string } | undefined): void {
  if (value === undefined) delete (chrome.runtime as { lastError?: { message: string } }).lastError;
  else (chrome.runtime as { lastError?: { message: string } }).lastError = value;
}

describe('opening a post from the side panel', () => {
  const query = vi.fn<(info: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>>();
  const create = vi.fn<(props: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>>();
  const sendMessage =
    vi.fn<(tabId: number, message: unknown, callback: (response: unknown) => void) => void>();

  beforeEach(() => {
    query.mockReset().mockResolvedValue([{ id: 42 } as chrome.tabs.Tab]);
    create.mockReset().mockResolvedValue({ id: 43 } as chrome.tabs.Tab);
    sendMessage.mockReset();
    setLastError(undefined);
    Object.assign(chrome, { tabs: { query, create, sendMessage } });
  });

  it('asks the active X tab to navigate, and opens nothing else', async () => {
    sendMessage.mockImplementation((_tabId, _message, callback) => callback({ ok: true }));
    await openPost(POST, { newTab: false });
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(sendMessage).toHaveBeenCalledWith(
      42,
      { kind: 'xf:navigate', url: POST },
      expect.any(Function),
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('falls back to a new tab when the active tab has no X content script', async () => {
    sendMessage.mockImplementation((_tabId, _message, callback) => {
      setLastError({ message: 'Could not establish connection. Receiving end does not exist.' });
      callback(undefined);
      setLastError(undefined);
    });
    await openPost(POST, { newTab: false });
    expect(create).toHaveBeenCalledWith({ url: POST });
  });

  it('opens a new tab straight away when asked to', async () => {
    await openPost(POST, { newTab: true });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({ url: POST });
  });

  it('never opens a URL that is not an x.com post link', async () => {
    await openPost('javascript:alert(1)', { newTab: true });
    expect(create).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2：确认失败**

Run: `pnpm vitest run tests/unit/open-post.test.ts`
Expected: FAIL，找不到模块 `@/sidepanel/openPost`

- [ ] **Step 3：实现 `openPost`**

新建 `src/sidepanel/openPost.ts`：

```ts
import {
  NAVIGATE_TO_POST,
  isSimpleResponse,
  type NavigateRequest,
} from '@/messaging/sidePanelProtocol';
import { isSafeXUrl } from '@/utils/url';

export interface OpenPostOptions {
  /** ⌘/Ctrl-click: always a new tab. */
  newTab: boolean;
}

/**
 * Opens a saved post from the side panel.
 *
 * The panel is an extension page: following the link itself would navigate
 * the panel, not the page beside it. The active tab is asked first — if it is
 * an X tab, our content script answers and navigates itself, which needs no
 * `tabs` permission. Anything else (a non-X tab, no answer) gets a new tab.
 */
export async function openPost(url: string, options: OpenPostOptions): Promise<void> {
  if (!isSafeXUrl(url)) return;
  if (!options.newTab) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined && (await askTabToNavigate(tab.id, url))) return;
  }
  await chrome.tabs.create({ url });
}

function askTabToNavigate(tabId: number, url: string): Promise<boolean> {
  const request: NavigateRequest = { kind: NAVIGATE_TO_POST, url };
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, request, (response: unknown) => {
        // Reading lastError is what marks "no content script there" as handled.
        if (chrome.runtime.lastError !== undefined) {
          resolve(false);
          return;
        }
        resolve(isSimpleResponse(response) && response.ok);
      });
    } catch {
      resolve(false);
    }
  });
}
```

- [ ] **Step 4：确认 `openPost` 测试通过**

Run: `pnpm vitest run tests/unit/open-post.test.ts`
Expected: PASS，4 passed

- [ ] **Step 5：写侧边栏界面的失败测试**

新建 `tests/unit/side-panel-app.test.tsx`：

```tsx
import { options, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderWithCount } from '@/core/domain/folder';
import { FolderStore } from '@/state/FolderStore';

const { rpcMock, openPostMock } = vi.hoisted(() => ({
  rpcMock: vi.fn<(method: string, payload: unknown) => Promise<unknown>>(),
  openPostMock: vi.fn<(url: string, options: { newTab: boolean }) => Promise<void>>(),
}));

vi.mock('@/messaging/RpcClient', () => ({ rpc: rpcMock, rpcOrNull: vi.fn() }));
vi.mock('@/sidepanel/openPost', () => ({ openPost: openPostMock }));

import { SidePanelApp } from '@/sidepanel/SidePanelApp';

options.requestAnimationFrame = (callback: () => void): void => callback();

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const FOLDER: FolderWithCount = {
  id: 'f1',
  name: 'AI',
  parentId: null,
  position: 1000,
  collapsed: false,
  createdAt: 1,
  updatedAt: 1,
  tweetCount: 1,
};
const POST = 'https://x.com/alice/status/1000000000000000001';

describe('SidePanelApp', () => {
  let container: HTMLElement;

  beforeEach(() => {
    openPostMock.mockReset().mockResolvedValue(undefined);
    rpcMock.mockReset().mockImplementation(async (method) => {
      if (method === 'folders.list') {
        return { ok: true, data: { folders: [FOLDER], recentFolderIds: [] } };
      }
      if (method === 'memberships.listFolderTweets') {
        return {
          ok: true,
          data: {
            items: [
              {
                savedAt: 1,
                tweet: {
                  tweetId: '1000000000000000001',
                  canonicalUrl: POST,
                  authorName: 'Alice',
                  username: 'alice',
                  text: '一条收藏',
                  capturedAt: 1,
                  updatedAt: 1,
                },
              },
            ],
            nextCursor: null,
          },
        };
      }
      return { ok: true, data: null };
    });
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('lists a folder’s posts and routes a click to openPost instead of navigating the panel', async () => {
    const before = location.href;
    render(<SidePanelApp store={new FolderStore()} />, container);
    await flush();

    const folderButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'AI',
    );
    expect(folderButton).toBeDefined();
    folderButton?.click();
    await flush();

    const link = container.querySelector<HTMLAnchorElement>(`a[href="${POST}"]`);
    expect(link).not.toBeNull();
    link?.click();

    expect(openPostMock).toHaveBeenCalledWith(POST, { newTab: false });
    expect(location.href).toBe(before);
  });
});
```

- [ ] **Step 6：确认失败**

Run: `pnpm vitest run tests/unit/side-panel-app.test.tsx`
Expected: FAIL，找不到模块 `@/sidepanel/SidePanelApp`

- [ ] **Step 7：实现侧边栏界面**

新建 `src/sidepanel/styles.ts`：

```ts
import { tokensFor } from '@/hosts/x/ThemeAdapter';
import { FOLDER_VIEW_CSS } from '@/ui/folder-view/folderView.css';
import { BASE_CSS, FEEDBACK_CSS } from '@/ui/shared/theme.css';
import { SIDEBAR_CSS } from '@/ui/sidebar/sidebar.css';

/**
 * The side panel is an ordinary extension page, so the CSS strings the shadow
 * roots use go into one <style> in its head. `:host` rules simply do not match
 * here; `.xf-root` carries the equivalent base styles.
 *
 * M1 follows the system colour scheme. Following X's own theme arrives in a
 * later milestone.
 */
export function mountSidePanelStyles(doc: Document): void {
  const style = doc.createElement('style');
  style.textContent = `${BASE_CSS}${FEEDBACK_CSS}${SIDEBAR_CSS}${FOLDER_VIEW_CSS}
html, body { margin: 0; height: 100%; background: var(--xf-bg); }
#app { height: 100%; }
.xf-sp { display: flex; flex-direction: column; height: 100%; }
.xf-sp-tree { flex: 0 0 auto; max-height: 40vh; overflow-y: auto; border-bottom: 1px solid var(--xf-border); }
.xf-sp-view { flex: 1 1 auto; min-height: 0; }`;
  doc.head.appendChild(style);

  const dark = doc.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches === true;
  for (const [name, value] of Object.entries(tokensFor(dark ? 'lightsOut' : 'light'))) {
    doc.documentElement.style.setProperty(name, value);
  }
}
```

新建 `src/sidepanel/SidePanelApp.tsx`：

```tsx
import { useEffect, useState } from 'preact/hooks';
import type { FolderId } from '@/core/domain/folder';
import type { FolderStore } from '@/state/FolderStore';
import { FolderViewApp } from '@/ui/folder-view/FolderViewApp';
import { SidebarApp } from '@/ui/sidebar/SidebarApp';
import { openPost } from './openPost';

export interface SidePanelAppProps {
  store: FolderStore;
}

/**
 * M1 side panel: the same folder tree and folder list the page uses, stacked.
 * Clicks on a post are routed to the X tab instead of navigating the panel.
 */
export function SidePanelApp(props: SidePanelAppProps): preact.JSX.Element {
  const [folderId, setFolderId] = useState<FolderId | null>(null);

  useEffect(() => {
    void props.store.refresh();
  }, [props.store]);

  return (
    <div class="xf-root xf-sp" onClick={routePostLinks}>
      <div class="xf-sp-tree">
        <SidebarApp store={props.store} mode="wide" onOpenFolder={setFolderId} />
      </div>
      <div class="xf-sp-view">
        {folderId === null ? (
          <div class="xf-fv-state">选择一个文件夹查看收藏。</div>
        ) : (
          <FolderViewApp
            store={props.store}
            folderId={folderId}
            onClose={() => setFolderId(null)}
            onMembershipChanged={() => {}}
          />
        )}
      </div>
    </div>
  );
}

function routePostLinks(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return;
  event.preventDefault();
  void openPost(anchor.href, { newTab: event.metaKey || event.ctrlKey });
}
```

新建 `src/entrypoints/sidepanel/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>X Folders</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

新建 `src/entrypoints/sidepanel/main.tsx`：

```tsx
import { render } from 'preact';
import { SidePanelApp } from '@/sidepanel/SidePanelApp';
import { mountSidePanelStyles } from '@/sidepanel/styles';
import { FolderStore } from '@/state/FolderStore';
import { CleanupRegistry } from '@/utils/cleanup';
import { applyStoredLogLevel } from '@/utils/logger';

void applyStoredLogLevel();

const registry = new CleanupRegistry();
const store = new FolderStore();
// Same change channel the content scripts use, so a save in any X tab shows
// up here without a refresh.
store.attach(registry);
mountSidePanelStyles(document);

const app = document.getElementById('app');
if (app !== null) render(<SidePanelApp store={store} />, app);

window.addEventListener('pagehide', () => registry.dispose());
```

- [ ] **Step 8：确认测试通过、清单正确**

Run: `pnpm vitest run tests/unit/side-panel-app.test.tsx tests/unit/open-post.test.ts`
Expected: PASS，5 passed

Run: `pnpm build && node -e "const m=require('./dist/chrome-mv3/manifest.json');console.log(JSON.stringify({side_panel:m.side_panel,permissions:m.permissions,action:m.action}))"`
Expected: `{"side_panel":{"default_path":"sidepanel.html"},"permissions":["storage","unlimitedStorage","sidePanel"],"action":{"default_title":"X Folders"}}`（`permissions` 顺序可不同，必须恰好这三项）

- [ ] **Step 9：全量检查**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 全部通过，`Tests  171 passed (171)`

- [ ] **Step 10：提交**

```bash
git add src/sidepanel src/entrypoints/sidepanel tests/unit/open-post.test.ts tests/unit/side-panel-app.test.tsx
git commit -m "新增侧边栏页面：文件夹树与收藏列表，点击帖子在 X 标签页打开"
git push origin main
```

---

### Task 8：覆盖层「在侧边栏中打开」按钮（验证页面内能否打开侧边栏）

**Files:**
- Create: `src/messaging/sidePanelClient.ts`
- Modify: `src/ui/shared/icons.ts`
- Modify: `src/ui/folder-view/FolderViewApp.tsx`
- Modify: `src/ui/folder-view/folderView.css.ts`
- Modify: `src/hosts/x/FolderViewMount.tsx`
- Test: `tests/unit/open-in-side-panel.test.tsx`
- Test: `tests/unit/side-panel.test.ts`（追加客户端用例）

- [ ] **Step 1：写失败的测试**

新建 `tests/unit/open-in-side-panel.test.tsx`：

```tsx
import { options, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderStore } from '@/state/FolderStore';
import { FolderViewApp } from '@/ui/folder-view/FolderViewApp';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn<(method: string, payload: unknown) => Promise<unknown>>(),
}));
vi.mock('@/messaging/RpcClient', () => ({ rpc: rpcMock, rpcOrNull: vi.fn() }));

options.requestAnimationFrame = (callback: () => void): void => callback();

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const BUTTON = 'button[aria-label="在侧边栏中打开"]';

describe('the overlay’s side panel button', () => {
  let container: HTMLElement;

  beforeEach(() => {
    rpcMock.mockReset().mockResolvedValue({ ok: true, data: { items: [], nextCursor: null } });
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('is offered on the page overlay and hands the click straight over', async () => {
    const onOpenInSidePanel = vi.fn();
    render(
      <FolderViewApp
        store={new FolderStore()}
        folderId="f1"
        onClose={() => {}}
        onMembershipChanged={() => {}}
        onOpenInSidePanel={onOpenInSidePanel}
      />,
      container,
    );
    await flush();
    const button = container.querySelector<HTMLButtonElement>(BUTTON);
    expect(button).not.toBeNull();
    button?.click();
    expect(onOpenInSidePanel).toHaveBeenCalledTimes(1);
  });

  it('is not offered inside the side panel itself', async () => {
    render(
      <FolderViewApp
        store={new FolderStore()}
        folderId="f1"
        onClose={() => {}}
        onMembershipChanged={() => {}}
      />,
      container,
    );
    await flush();
    expect(container.querySelector(BUTTON)).toBeNull();
  });
});
```

在 `tests/unit/side-panel.test.ts` 顶部 import 区加

```ts
import { requestOpenSidePanel } from '@/messaging/sidePanelClient';
```

并在文件末尾追加：

```ts
describe('requestOpenSidePanel', () => {
  beforeEach(() => {
    vi.mocked(chrome.runtime.sendMessage).mockReset();
    delete (chrome.runtime as { lastError?: { message: string } }).lastError;
  });

  it('sends the request synchronously, while the click is still a gesture', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      ((_message: unknown, callback: (response: unknown) => void) => callback({ ok: true })) as never,
    );
    const pending = requestOpenSidePanel();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { kind: OPEN_SIDE_PANEL },
      expect.any(Function),
    );
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('turns an unreachable background into a plain failure', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      ((_message: unknown, callback: (response: unknown) => void) => {
        (chrome.runtime as { lastError?: { message: string } }).lastError = {
          message: 'Extension context invalidated.',
        };
        callback(undefined);
        delete (chrome.runtime as { lastError?: { message: string } }).lastError;
      }) as never,
    );
    await expect(requestOpenSidePanel()).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );
  });
});
```

- [ ] **Step 2：确认失败**

Run: `pnpm vitest run tests/unit/open-in-side-panel.test.tsx tests/unit/side-panel.test.ts`
Expected: FAIL：找不到模块 `@/messaging/sidePanelClient`；`is offered on the page overlay…` 找不到按钮

- [ ] **Step 3：客户端**

新建 `src/messaging/sidePanelClient.ts`：

```ts
import {
  OPEN_SIDE_PANEL,
  isSimpleResponse,
  type OpenSidePanelRequest,
  type SimpleResponse,
} from './sidePanelProtocol';

/**
 * Asks the background to open the side panel for this tab.
 *
 * Call it directly from the click handler: `sendMessage` runs synchronously
 * inside the Promise executor, which is what lets the background still treat
 * the request as part of the user's gesture.
 */
export function requestOpenSidePanel(): Promise<SimpleResponse> {
  const request: OpenSidePanelRequest = { kind: OPEN_SIDE_PANEL };
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(request, (response: unknown) => {
        const lastError = chrome.runtime.lastError;
        if (lastError !== undefined) {
          resolve({ ok: false, message: lastError.message ?? 'unavailable' });
          return;
        }
        resolve(isSimpleResponse(response) ? response : { ok: false, message: 'bad-response' });
      });
    } catch (error) {
      resolve({ ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  });
}
```

- [ ] **Step 4：图标与按钮**

`src/ui/shared/icons.ts` 的 `ICON_PATHS` 里，在 `external` 之前加：

```ts
  /** A window with a right-hand panel: "open in the side panel". */
  sidePanel:
    'M4 5.75A1.75 1.75 0 0 1 5.75 4h12.5A1.75 1.75 0 0 1 20 5.75v12.5A1.75 1.75 0 0 1 18.25 20H5.75A1.75 1.75 0 0 1 4 18.25V5.75Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .14.11.25.25.25H14v-13H5.75Zm9.75 0v13h2.75c.14 0 .25-.11.25-.25V5.75a.25.25 0 0 0-.25-.25H15.5Z',
```

`src/ui/folder-view/FolderViewApp.tsx`：

(a) `FolderViewAppProps` 里加一个可选属性：

```ts
  /** Present only on the page overlay: hands the reading over to the side panel. */
  onOpenInSidePanel?: () => void;
```

(b) 在 `CloseIcon` 函数后面加：

```tsx
function SidePanelIcon(): preact.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(createIcon('sidePanel', 20));
  }, []);
  return <span ref={ref} aria-hidden="true" style="display:inline-flex" />;
}
```

(c) 在 `<header class="xf-fv-header">` 里，`<div class="xf-fv-title">…</div>` 之后、`</header>` 之前加：

```tsx
        {props.onOpenInSidePanel !== undefined && (
          <button
            type="button"
            class="xf-icon-button xf-fv-side-panel"
            aria-label="在侧边栏中打开"
            title="在侧边栏中打开"
            onClick={props.onOpenInSidePanel}
          >
            <SidePanelIcon />
          </button>
        )}
```

`src/ui/folder-view/folderView.css.ts`：在 `.xf-fv-title { … }` 那一行之后加：

```css
.xf-fv-side-panel { margin-left: auto; }
```

- [ ] **Step 5：把按钮接到覆盖层**

`src/hosts/x/FolderViewMount.tsx`：

(a) import 区加：

```ts
import { requestOpenSidePanel } from '@/messaging/sidePanelClient';
import { toasts } from '@/ui/shared/toastStore';
```

(b) `#render` 里给 `<FolderViewApp …>` 加一个属性：

```tsx
        onOpenInSidePanel={() => this.#openInSidePanel()}
```

(c) 在 `#render` 方法之后加：

```ts
  /**
   * Stays synchronous up to `requestOpenSidePanel()`: the browser only lets the
   * background open the panel while this click still counts as a gesture.
   * Whether it does at all from a page click is exactly what M1 verifies on real
   * Chrome; the fallback is the toolbar icon.
   */
  #openInSidePanel(): void {
    void requestOpenSidePanel().then((result) => {
      if (!result.ok) {
        toasts.show('无法从页面打开侧边栏，请点浏览器工具栏上的扩展图标。', { tone: 'danger' });
      }
    });
  }
```

- [ ] **Step 6：确认测试通过**

Run: `pnpm vitest run tests/unit/open-in-side-panel.test.tsx tests/unit/side-panel.test.ts`
Expected: PASS（2 passed；6 passed）

- [ ] **Step 7：全量检查**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 全部通过，`Tests  175 passed (175)`

- [ ] **Step 8：提交**

```bash
git add src/messaging/sidePanelClient.ts src/ui/shared/icons.ts src/ui/folder-view/FolderViewApp.tsx src/ui/folder-view/folderView.css.ts src/hosts/x/FolderViewMount.tsx tests/unit/open-in-side-panel.test.tsx tests/unit/side-panel.test.ts
git commit -m "覆盖层标题栏新增「在侧边栏中打开」按钮"
git push origin main
```

---

### Task 9：真浏览器端到端测试

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/harness.ts`
- Create: `tests/e2e/minimal-loop.spec.ts`
- Modify: `package.json`

- [ ] **Step 1：下载许可**

用户已于 2026-09-29 批准下载 Playwright 的 Chromium。用户提到用 Homebrew，但 Homebrew 不提供 Playwright 配套的 Chromium 版本；下载走 Playwright 自带的安装命令（来源：Playwright 官方下载源，约 150MB，存放在 `~/Library/Caches/ms-playwright`），这一点已向用户说明。

- [ ] **Step 2：安装**

Run: `pnpm add -D @playwright/test && pnpm exec playwright install chromium`
Expected: 安装成功，最后输出包含 `Chromium` 下载完成的提示

`package.json` 的 `scripts` 里，在 `"test:watch"` 后面加：

```json
    "test:e2e": "pnpm build:e2e && playwright test"
```

（注意给上一行补逗号。）

- [ ] **Step 3：Playwright 配置**

新建 `playwright.config.ts`：

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  // One browser with the extension loaded per test; they must not share state.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
```

- [ ] **Step 4：测试框架**

新建 `tests/e2e/harness.ts`：

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, test as base, type BrowserContext, type Page, type Worker } from '@playwright/test';

/** The Playwright build: same code, shadow roots open (see src/ui/shared/shadowMode.ts). */
const EXTENSION_DIR = resolve(process.cwd(), 'dist/chrome-mv3-e2e');
const FIXTURE_DIR = resolve(process.cwd(), 'tests/fixtures');

/** Which captured page answers an x.com path. */
function fixtureFor(pathname: string): string {
  if (/^\/[^/]+\/status\/\d+/.test(pathname)) return 'x-status.html';
  if (pathname.startsWith('/search')) return 'x-search.html';
  if (pathname === '/home' || pathname === '/') return 'x-home.html';
  return 'x-profile.html';
}

export interface Harness {
  context: BrowserContext;
  extensionId: string;
  worker: Worker;
  openX(path?: string): Promise<Page>;
}

export const test = base.extend<{ harness: Harness }>({
  // Playwright reads fixture dependencies from this destructuring pattern.
  // eslint-disable-next-line no-empty-pattern
  harness: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
    });

    // Nothing leaves the machine: every other host is refused, and x.com is
    // answered from the captured fixtures. Later routes win, so the x.com
    // route is registered last.
    await context.route(/^https?:\/\/(?!x\.com\/)/, (route) => route.abort());
    await context.route('https://x.com/**', async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'document') {
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      const { pathname } = new URL(request.url());
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: readFileSync(resolve(FIXTURE_DIR, fixtureFor(pathname)), 'utf8'),
      });
    });

    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;

    const openX = async (path = '/home'): Promise<Page> => {
      const page = await context.newPage();
      await page.goto(`https://x.com${path}`);
      return page;
    };

    await use({ context, extensionId, worker, openX });
    await context.close();
  },
});

export { expect } from '@playwright/test';
```

- [ ] **Step 5：M1 端到端用例**

新建 `tests/e2e/minimal-loop.spec.ts`：

```ts
import type { Page } from '@playwright/test';
import { expect, test } from './harness';

const HOST = '[data-xf-action-host]';

/** Creates a root folder from the sidebar, then saves the first post into it. */
async function saveFirstPostInto(page: Page, folderName: string): Promise<string> {
  const sidebar = page.locator('[data-xf-sidebar-host]');
  await sidebar.getByRole('button', { name: '新建文件夹' }).click();
  const input = sidebar.getByPlaceholder('文件夹名称');
  await input.fill(folderName);
  await input.press('Enter');
  await expect(sidebar.getByRole('button', { name: folderName, exact: true })).toBeVisible();

  const host = page.locator(HOST).first();
  const tweetId = await host.getAttribute('data-xf-tweet-id');
  if (tweetId === null) throw new Error('action host without a tweet id');
  await host.locator('button').click();

  const popover = page.locator('[data-xf-popover-host]');
  await expect(popover).toHaveCount(1);
  await popover.getByRole('menuitemcheckbox', { name: folderName, exact: true }).first().click();
  await expect(popover).toHaveCount(0);
  await expect(host.locator('button')).toHaveAttribute('data-saved', 'true');
  return tweetId;
}

test('every extractable post gets exactly one folder button', async ({ harness }) => {
  const page = await harness.openX('/home');
  const extractable = page.locator('article[data-testid="tweet"]:not([data-xf-skip])');
  await expect.poll(() => page.locator(HOST).count(), { timeout: 2_000 }).toBeGreaterThan(0);
  await expect
    .poll(async () => (await page.locator(HOST).count()) === (await extractable.count()), {
      timeout: 2_000,
    })
    .toBe(true);
  const perPost = await extractable.evaluateAll((posts) =>
    posts.map((post) => post.querySelectorAll('[data-xf-action-host]').length),
  );
  expect(perPost.every((count) => count === 1)).toBe(true);
});

test('the folder tree mounts once and stays single', async ({ harness }) => {
  const page = await harness.openX('/home');
  await expect(page.locator('[data-xf-sidebar-host]')).toHaveCount(1, { timeout: 2_000 });
  await page.waitForTimeout(2_500); // at least one health tick
  await expect(page.locator('[data-xf-sidebar-host]')).toHaveCount(1);
});

test('a saved post shows in the page overlay and in the side panel', async ({ harness }) => {
  const page = await harness.openX('/home');
  const tweetId = await saveFirstPostInto(page, 'AI');

  await page.locator('[data-xf-sidebar-host]').getByRole('button', { name: 'AI', exact: true }).click();
  const overlay = page.locator('[data-xf-overlay-host]');
  await expect(overlay.locator(`[data-xf-tweet-id="${tweetId}"]`)).toHaveCount(1);
  await expect(overlay.getByRole('button', { name: '在侧边栏中打开' })).toBeVisible();

  // The real side panel is browser chrome Playwright cannot drive; the same
  // page opened in a tab exercises everything but the panel frame itself.
  const panel = await harness.context.newPage();
  await panel.goto(`chrome-extension://${harness.extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(panel.locator(`[data-xf-tweet-id="${tweetId}"]`)).toHaveCount(1);
});

test('clicking a post in the side panel opens it in a tab, not inside the panel', async ({ harness }) => {
  const page = await harness.openX('/home');
  const tweetId = await saveFirstPostInto(page, 'AI');
  const panel = await harness.context.newPage();
  await panel.goto(`chrome-extension://${harness.extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'AI', exact: true }).click();
  // openPost asks the *active* tab first; make that the panel page, which has
  // no content script, so the new-tab fallback is what gets exercised.
  await panel.bringToFront();

  const [opened] = await Promise.all([
    harness.context.waitForEvent('page'),
    panel.locator(`[data-xf-tweet-id="${tweetId}"] a`).first().click(),
  ]);
  await opened.waitForLoadState();
  expect(opened.url()).toMatch(/^https:\/\/x\.com\/[^/]+\/status\/\d+$/);
  expect(panel.url()).toContain('/sidepanel.html');
});

test('typing a folder name never reaches page-level shortcut listeners', async ({ harness }) => {
  await harness.context.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __xfSeenKeys: string[] }).__xfSeenKeys = seen;
    document.addEventListener('keydown', (event) => seen.push(event.key));
  });
  const page = await harness.openX('/home');
  const sidebar = page.locator('[data-xf-sidebar-host]');
  await sidebar.getByRole('button', { name: '新建文件夹' }).click();
  await sidebar.getByPlaceholder('文件夹名称').pressSequentially('nrtljk');

  const seen = await page.evaluate(
    () => (window as unknown as { __xfSeenKeys: string[] }).__xfSeenKeys,
  );
  expect(seen).toEqual([]);
});

test('200 new posts all get a button without long tasks', async ({ harness }) => {
  const page = await harness.openX('/home');
  await expect(page.locator(HOST).first()).toBeAttached({ timeout: 3_000 });
  const before = await page.locator(HOST).count();

  await page.evaluate(() => {
    const store = window as unknown as { __xfLong: Array<{ start: number; duration: number }> };
    store.__xfLong = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        store.__xfLong.push({ start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'longtask' });
  });

  const burstEnd = await page.evaluate(() => {
    const source = document
      .querySelector('article[data-testid="tweet"]:not([data-xf-skip])')
      ?.closest('[data-testid="cellInnerDiv"]');
    const parent = source?.parentElement;
    if (source === null || source === undefined || parent === null || parent === undefined) {
      throw new Error('timeline not found');
    }
    for (let i = 0; i < 200; i += 1) {
      const clone = source.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-xf-action-host]').forEach((host) => host.remove());
      const id = `9${String(i).padStart(18, '0')}`;
      clone.querySelectorAll('a[href*="/status/"]').forEach((anchor) => {
        const href = anchor.getAttribute('href') ?? '';
        anchor.setAttribute('href', href.replace(/\/status\/\d+/, `/status/${id}`));
      });
      parent.appendChild(clone);
    }
    // The cloning itself is one long task of ours; only what follows counts.
    return performance.now();
  });

  await expect
    .poll(() => page.locator(HOST).count(), { timeout: 5_000 })
    .toBe(before + 200);
  const longTasks = await page.evaluate(
    () => (window as unknown as { __xfLong: Array<{ start: number; duration: number }> }).__xfLong,
  );
  expect(longTasks.filter((task) => task.start >= burstEnd && task.duration > 50)).toEqual([]);
});
```

- [ ] **Step 6：运行端到端测试**

Run: `pnpm test:e2e`
Expected: 6 passed

任何一条失败：用 superpowers:systematic-debugging 找根因，修复时先在单元测试里复现，再改代码；修完重跑到全部通过。**不允许**为了让测试通过而放宽断言（例如把 50ms 改大）——如需调整，先向用户说明原因。

- [ ] **Step 7：全量检查**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 全部通过，`Tests  175 passed (175)`

- [ ] **Step 8：提交**

```bash
git add playwright.config.ts tests/e2e package.json pnpm-lock.yaml
git commit -m "新增 Playwright 端到端测试：加载真实扩展，x.com 指向本地样本"
git push origin main
```

---

### Task 10：真实 X 冒烟测试（需要你配合）

**Files:**
- Modify: `docs/manual-qa.md`

- [ ] **Step 1：构建安装版本**

Run: `pnpm build && ls dist/chrome-mv3/manifest.json`
Expected: 输出 `dist/chrome-mv3/manifest.json`

- [ ] **Step 2：请用户加载扩展，并征得操作真实页面的授权**

向用户说明：
1. `chrome://extensions` →（如有之前失败的条目先移除）→「加载已解压的扩展程序」→ `⌘ + ⇧ + G` → 粘贴 `/Users/bee/Dev/Extension/folder-for-x/dist/chrome-mv3` → 选择；
2. 确认扩展卡片上没有红色「错误」按钮；
3. 同意由 Claude 用 Claude in Chrome 在已登录的 x.com 上按下面的清单检查。承诺：不点赞 / 转帖 / 书签 / 发帖，不改任何设置；只读页面、截图、点击扩展自己的界面，以及打开 X 的「更多」菜单（只看层叠关系，不点选项）。

得到明确同意后才继续。

- [ ] **Step 3：按清单逐项检查（真实登录态 x.com）**

在新建的标签页打开 `https://x.com/home`，逐项执行并记录「通过 / 不通过 + 证据」：

| # | 检查 | 方法 | 通过标准 |
|---|---|---|---|
| 1 | 左栏树只出现一个 | 页面脚本：`document.querySelectorAll('[data-xf-sidebar-host]').length` | 加载后 2 秒内为 1，5 秒后仍为 1 |
| 2 | 安装版是 closed | 页面脚本：`document.querySelector('[data-xf-sidebar-host]').shadowRoot` | `null` |
| 3 | 每条帖子恰好一个按钮 | 页面脚本：统计每个未标 `data-xf-skip` 的 `article[data-testid="tweet"]` 内 `[data-xf-action-host]` 数量 | 全部为 1 |
| 4 | 布局没被挤坏 | 截图 | 账号切换按钮可见；X 导航项、发帖按钮位置正常 |
| 5 | 打字不触发 X 快捷键 | 点左栏「+」，真实键盘输入「测试nrtljk」后删掉多余字母，回车 | 期间地址栏不变、X 没有弹出任何对话框、没有帖子被点赞；最终建出「测试」文件夹 |
| 6 | 保存 | 点第一条帖子的文件夹按钮 → 弹层选「测试」 | 弹层关闭，按钮变蓝 |
| 7 | 页面内查看 | 点左栏「测试」 | 覆盖层列出这条帖子 |
| 8 | X 的弹层在上面 | 覆盖层打开时点 X 左栏「更多」 | X 的菜单显示在覆盖层之上；按 Esc 关闭菜单 |
| 9 | 页面内打开侧边栏（可行性验证） | 记录 `innerWidth`，点覆盖层标题栏「在侧边栏中打开」，再读 `innerWidth` | 通过：宽度变小（侧边栏打开）；不通过：出现「无法从页面打开侧边栏」提示——两种结果都如实记录 |
| 10 | 工具栏打开侧边栏 | 请用户点工具栏上的扩展图标（没固定时在拼图图标菜单里，可顺手点图钉固定），看侧边栏 | 用户确认侧边栏里有「测试」文件夹 |
| 11 | 侧边栏点帖子 | 请用户在侧边栏里点「测试」→ 点这条帖子 | 左边 X 页面跳到原帖，侧边栏保持不动 |
| 12 | 详情页主帖有按钮 | 在第 11 步打开的详情页，页面脚本统计 `article[data-testid="tweet"][tabindex="-1"] [data-xf-action-host]` | 为 1 |
| 13 | 滚动 | 回首页向下滚动 5 屏，每屏停 1 秒 | 每屏新出现的帖子都已有按钮；滚动无明显卡顿 |
| 14 | 清理 | 在左栏删除「测试」文件夹 | 确认框写明数量；删除后按钮恢复空心 |

- [ ] **Step 4：失败项处理**

任何一项不通过（第 9 项除外，它是可行性验证）：停下，用 superpowers:systematic-debugging 找根因；在单元或端到端测试里先复现，再修复；修完回到 Step 1 重新走受影响的检查项。

第 9 项若不通过：记录 Chrome 给出的原因，M3 计划改为「页面里的切换按钮提示用户点工具栏图标」，并在报告中告知用户。

- [ ] **Step 5：记录结果**

把 `docs/manual-qa.md` 整个替换为 M1 的真实验收记录。标题里的日期写执行当天；Chrome 版本号请用户从 `chrome://version` 第一行读给你（Claude in Chrome 打不开 `chrome://` 页面）。结构：

```markdown
# 手工验收记录

## M1 最小闭环（执行日期，真实登录态 x.com，Chrome 版本号，macOS）

| # | 检查 | 结果 | 证据 / 备注 |
|---|---|---|---|
（逐行填写 Step 3 的 14 项，结果只能是「通过」「不通过」「未执行（原因）」）

## 尚未验证

（列出本次没有覆盖、留给后续里程碑的项目，例如 暗淡 / 熄灯主题、窄屏模式、扩展重载后无残留）
```

- [ ] **Step 6：提交**

```bash
git add docs/manual-qa.md
git commit -m "记录 M1 真实 X 冒烟测试结果"
git push origin main
```

---

### Task 11：M1 收尾

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1：全部检查**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm build && pnpm zip`
Expected: 全部成功；单元测试 175 passed；端到端 6 passed；`dist/chrome-mv3/` 与 `dist/x-folders-0.1.0-chrome.zip` 存在

- [ ] **Step 2：更新 CHANGELOG**

在 `CHANGELOG.md` 的 `## [0.1.0]` 之前插入：

```markdown
## [未发布]

### 修复

- 插件界面里的按键不再传给 X：此前在文件夹名输入框打字可能触发 X 的快捷键。
- 页面变动后不再全量重扫所有帖子；按钮状态更新只重绘，不再重新定位操作栏。

### 新增

- 构建产物输出到可见的 `dist/chrome-mv3`，安装说明同步更新。
- Chrome 侧边栏：文件夹树与收藏列表；点帖子在旁边的 X 标签页打开。
- 收藏列表标题栏「在侧边栏中打开」按钮。
- Playwright 端到端测试：加载构建后的真实扩展，x.com 请求指向本地页面样本。
```

- [ ] **Step 3：提交并推送**

```bash
git add CHANGELOG.md
git commit -m "更新 CHANGELOG：M1 最小闭环"
git push origin main
```

- [ ] **Step 4：向用户汇报并决定下一步**

按工单 4.3 的结构汇报 M1：已完成、验证结果（命令 + PASS/FAIL + 用例数）、真实 X 验证（逐项）、可行性验证第 9 项的结论、构建产物路径、已知限制。然后按 M1 的真实结果写 M2 的实施计划（见下方路线图），经用户确认后再执行。

---

## 后续里程碑（各自单独成计划，前一个在真实 Chrome 验证通过后再写）

| 里程碑 | 内容 | 对应工单 |
|---|---|---|
| M2 帖子快照与富卡片 | 数据库第 2 版与迁移；快照校验（地址白名单）；提取头像 / 认证 / 媒体 / 引用帖 / 链接卡片 / 截断标记；再次出现时补全；还原 X 的富卡片组件；重新抓取并脱敏页面样本；审查缺陷 3（版本号写死）、4（层级写死为两层） | 2.4、3.2、3.3 第 2 条 |
| M3 两种阅读模式完整版 | 共享阅读视图；侧边栏完整界面；侧边栏模式下 X 左栏只留入口图标；切换按钮与偏好记忆；页面内「返回恢复」 | 2.3、3.4 |
| M4 搜索 | 后台搜索服务；两种模式的搜索框与范围切换；5,000 条 0.2 秒性能测试 | 2.5 |
| M5 导出与导入 | 备份格式、校验、合并；数据管理页；往返测试 | 2.6、3.2 |
| M6 主题、双语与上架准备 | 侧边栏跟随 X 背景；中英语言文件并替换全部写死文案；固定开发版扩展 ID；扩展重载后无残留的端到端测试；上架素材与隐私政策；文档重写；最终真实 X 验收；版本号 0.2.0 | 2.7、3.5、3.6、4 |
