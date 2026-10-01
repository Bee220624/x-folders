# M3 两种阅读模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「页面内」和「浏览器侧边栏」两种阅读模式做完整：一键互相切换并记住选择，切换时带上正在看的文件夹；侧边栏模式下 X 左栏只留一个入口；点卡片打开原帖改用 X 页面内切换，不再整页重新加载；页面内模式看完原帖按浏览器「返回」，收藏列表回到原来的文件夹和位置；已补全的长帖在卡片里先折叠，点「显示更多」就地展开。

**Architecture:** 阅读模式是 `chrome.storage.local` 里的一个键，X 页面和侧边栏都通过 `ReadingModeStore` 读写并监听变化——侧边栏页面一打开就写成「侧边栏」，它顶部的按钮写回「页面内」。侧边栏和旁边的 X 标签页用三条消息交接（接管文件夹、交还文件夹、打开原帖），都由侧边栏发给当前标签页的内容脚本，不需要新权限。打开原帖由内容脚本改地址并发一个 `popstate`，让 X 自己换页；3 秒内没换成就整页加载兜底。返回位置按「历史条目」记在 `chrome.storage.session`（只在内存里），回到那个条目时取出并恢复一次。

**Tech Stack:** WXT 0.21、TypeScript（严格模式）、Preact、Vitest + jsdom、Playwright、pnpm。不新增依赖，不新增权限。

**依据：**
- 工单 `docs/superpowers/specs/2026-09-28-folders-for-x-v0.2-design.md` 2.3（两种阅读模式）、2.4（已补全的长帖在卡片内折叠 / 展开）、3.1（阅读模式偏好存在扩展存储里）、3.4（实现要点）、3.5（权限）、修订说明第 17 条、附录 A 第 14 条
- 效果图 `docs/superpowers/specs/assets/2026-09-28-reading-modes-mockup.html`
- `docs/manual-qa.md`「用户反馈（转入 M3）」：你在 2026-10-01 选定的 A（页面内快速切换）与 C（长帖卡片内展开）

**不在本里程碑：** 搜索框以及切换时「带上搜索词」（M4，和搜索一起做）；「⋯」菜单里的导出 / 导入入口（M5）；侧边栏跟随 X 的主题、中英双语（M6）。

**全局约定（每个任务都适用）：**
- 所有提交直接在 `main` 上，提交信息用中文，**不加任何 Claude / Anthropic 署名**。每个任务结束时 `git push origin main`。
- 每个任务结束前必须跑通：`pnpm typecheck`、`pnpm lint`、`pnpm test`。改到页面行为的任务（2、3、6、8、9、10）另跑 `pnpm test:e2e`。
- 需要你配合的步骤（Task 11 真实 X 检查）先征得同意；全程不点赞、不转帖、不书签、不发帖、不改设置。
- 任何测试失败：先用 superpowers:systematic-debugging 找根因，不许猜着改。
- 所有 X 选择器只写在 `src/hosts/x/selectors.ts`。本计划不新增 X 选择器。

---

## 2026-10-01 本地实测（写计划前验证过的前提）

用一个临时探针在本机 Chromium 153 + 构建好的扩展 + 样本页面上验证（没有碰你的真实 X；探针已删除，没有提交）：

| 前提 | 实测结果 |
|---|---|
| 内容脚本能拿到「历史条目」的标识 | `navigation.currentEntry.key` 在内容脚本里可读。页面内返回、整页加载后再返回，回到的都是同一个标识 |
| 内容脚本能用只在内存里的会话存储 | 默认不行，报错原文「Access to storage is not allowed from this context.」；后台调用一次 `chrome.storage.session.setAccessLevel(...)` 之后可以读写 |
| 内容脚本发出的「换页信号」页面收得到 | 内容脚本里 `history.pushState` + `PopStateEvent`：地址变了，页面自己的 `popstate` 监听器收到了，`state` 是 `{}`——和 M2 抓样本时在页面里直接执行、X 确实换了页的写法，对页面来说没有区别 |
| 测试里能真的打开浏览器侧边栏 | Playwright 点页面里的按钮后，`chrome.runtime.getContexts` 里出现了 `SIDE_PANEL`，侧边栏页面真的加载了 |

**整份计划演练过一遍。** 写完之后，我把 Task 1–10 的全部代码按顺序应用到仓库的一个临时副本上（不动仓库本身，没有提交，副本已删除）：

- 每个任务结束时，类型检查、代码规范检查、单元测试都通过；单元测试数量与下文各任务写的一致（272 → 354）。
- 端到端测试在 Task 2、3、6、8、9 之后都是 13 条全过，Task 10 之后 18 条全过；新增和改过的用例重复跑 3 遍，结果稳定。
- 正式构建的权限清单仍然只有 `storage`、`unlimitedStorage`、`sidePanel` 三项。
- 演练中发现、已写回计划的问题有一个：样本页面没有 X 的两栏布局，收藏列表覆盖层在测试里只有 13 像素高、里面的按钮点不到（见 Task 3 Step 9）。

演练覆盖不到的是真实 X，以及计划文字本身有没有抄错（执行时每一步仍然先看测试失败、再看它通过）。

**只有真实 X 才能回答的一件事：** X 的路由对内容脚本发出的信号是否和对页面里发出的一样响应。Task 11 第 1 项专门检查。如果不响应，功能不会坏——3 秒后整页加载，和现在一样——但「不整页刷新」就没达到；那时停下来和你确认备选方案（在页面里放一小段脚本转发这个信号），不擅自实现。

---

## 需要你知道的取舍

| # | 取舍 | 说明 |
|---|---|---|
| 1 | 切换按钮上的字 | 收藏列表顶部写「切换到侧边栏」，侧边栏顶部写「切换到页面内」（效果图的写法）。鼠标悬停提示里写「切换阅读模式」 |
| 2 | 侧边栏模式下的左栏入口 | 放在原来文件夹树的位置（「发帖」按钮下面）。左栏宽时是「图标 + 我的收藏」，窄时只有图标 |
| 3 | 返回恢复只发生一次 | 只有「点卡片离开 → 按返回」会恢复，恢复后这条记录就用掉了。通过 X 自己的链接离开再返回，不恢复（工单 2.3） |
| 4 | 恢复位置以「最上面那条帖子」为准 | 不是简单记像素。这样你在原帖页顺手又存了一条、或者移除了一条，回来时位置也不会错位 |
| 5 | 长帖折叠的长度 | 和 X 时间线一致：约 280 个英文字符（中文约 140 字）。只超出一点点的不折叠。展开后不提供「收起」（X 也没有） |
| 6 | 侧边栏里刚点开的卡片会高亮 | 来自效果图，方便一条接一条地看 |
| 7 | 新增的两条小记录 | 阅读模式（存在扩展存储里）；返回位置（只在内存里，关浏览器即清，最多 20 条，内容只有文件夹 ID、帖子 ID 和几个数字）。Task 12 写进隐私说明 |
| 8 | 页面内切换的兜底 | X 在 3 秒内没有显示目标帖，就整页加载。已被原作者删除的帖子会因此多加载一次，结果一样是 X 的「页面不存在」 |

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/core/readingMode.ts` | 新建 | 阅读模式的类型、默认值、校验 |
| `src/core/constants.ts` | 修改 | 两个存储键名 |
| `src/state/ReadingModeStore.ts` | 新建 | 读写阅读模式，监听别处的切换 |
| `src/hosts/x/navigateInPage.ts` | 新建 | 让 X 在页面内换到某条帖子；超时整页加载 |
| `src/hosts/x/NavigateHandler.ts` | 修改 | 侧边栏请求打开原帖时改用页面内切换 |
| `src/ui/tweet-card/collapse.ts` | 新建 | 长帖折叠规则（纯函数） |
| `src/ui/tweet-card/TweetText.tsx` | 修改 | 折叠显示、就地展开 |
| `src/hosts/x/historyEntry.ts` | 新建 | 当前历史条目的标识 |
| `src/hosts/x/ReturnState.ts` | 新建 | 返回位置在会话存储里的存取 |
| `src/background/sessionStorage.ts` | 新建 | 把会话存储开放给内容脚本 |
| `src/entrypoints/background.ts` | 修改 | 启动时调用上一项 |
| `tests/setup.ts` | 修改 | chrome 模拟补 `storage.session` |
| `src/ui/folder-view/viewPosition.ts` | 新建 | 读取 / 还原列表位置（纯函数） |
| `src/ui/folder-view/FolderViewApp.tsx` | 修改 | 点卡片时交出位置；打开时按位置恢复；切换按钮；高亮刚点的卡片 |
| `src/ui/folder-view/SavedTweetCard.tsx`、`folderView.css.ts` | 修改 | 高亮样式、切换按钮样式 |
| `src/hosts/x/FolderViewMount.tsx` | 修改 | 打开原帖、离开前上报位置、带位置打开 |
| `src/messaging/sidePanelProtocol.ts` | 修改 | 新增「接管文件夹」「交还文件夹」两条消息 |
| `src/hosts/x/PanelBridge.ts` | 新建 | 内容脚本回应这两条消息 |
| `src/sidepanel/activeTab.ts` | 新建 | 侧边栏向旁边的标签页发消息 |
| `src/sidepanel/openPost.ts` | 修改 | 改用上一项 |
| `src/hosts/x/openPanelFromPage.ts` | 新建 | 从页面里的点击打开侧边栏（两处共用） |
| `src/ui/sidebar/PanelEntry.tsx`、`sidebar.css.ts` | 新建 / 修改 | 侧边栏模式下左栏的入口 |
| `src/hosts/x/SidebarMount.tsx`、`selectors.ts` | 修改 | 按阅读模式显示文件夹树或入口 |
| `src/hosts/x/XRuntime.ts` | 修改 | 把以上各项接起来 |
| `src/sidepanel/SidePanelApp.tsx`、`styles.ts`、`src/entrypoints/sidepanel/main.tsx` | 修改 | 侧边栏顶栏、进入即切换、接管文件夹、切回 |
| `tests/unit/*.test.ts(x)` | 新建 / 修改 | 见各任务 |
| `tests/e2e/actions.ts`、`reading-modes.spec.ts`、`rich-card.spec.ts`、`minimal-loop.spec.ts` | 新建 / 修改 | 端到端测试 |
| `docs/manual-qa.md`、`privacy.md`、`architecture.md`、`selector-playbook.md`、`README.md`、`CHANGELOG.md`、工单附录 | 修改 | 收尾文档 |

---

### Task 1：阅读模式偏好

**Files:**
- Create: `src/core/readingMode.ts`
- Modify: `src/core/constants.ts`
- Create: `src/state/ReadingModeStore.ts`
- Test: `tests/unit/reading-mode-store.test.ts`

- [ ] **Step 1：写失败的测试**

新建 `tests/unit/reading-mode-store.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { READING_MODE_KEY } from '@/core/constants';
import { isReadingMode } from '@/core/readingMode';
import { ReadingModeStore } from '@/state/ReadingModeStore';
import { CleanupRegistry } from '@/utils/cleanup';
import { chromeStorageSnapshot, resetChromeStub } from '../setup';

describe('ReadingModeStore', () => {
  let registry: CleanupRegistry;

  beforeEach(() => {
    resetChromeStub();
    registry = new CleanupRegistry();
  });

  afterEach(() => {
    registry.dispose();
    vi.restoreAllMocks();
  });

  it('accepts only the two modes', () => {
    expect(isReadingMode('page')).toBe(true);
    expect(isReadingMode('panel')).toBe(true);
    expect(isReadingMode('sidebar')).toBe(false);
    expect(isReadingMode(undefined)).toBe(false);
  });

  it('starts in page mode and knows it has not looked yet', async () => {
    const store = new ReadingModeStore();
    expect(store.mode).toBe('page');
    expect(store.loaded).toBe(false);

    await store.load();
    expect(store.mode).toBe('page');
    expect(store.loaded).toBe(true);
  });

  it('picks up the stored choice and tells listeners', async () => {
    await chrome.storage.local.set({ [READING_MODE_KEY]: 'panel' });
    const store = new ReadingModeStore();
    const listener = vi.fn();
    store.subscribe(listener);

    await store.load();
    expect(store.mode).toBe('panel');
    expect(listener).toHaveBeenCalledExactlyOnceWith('panel');
  });

  it('keeps the default when the stored value is not a mode', async () => {
    await chrome.storage.local.set({ [READING_MODE_KEY]: 'sidebar' });
    const store = new ReadingModeStore();
    await store.load();
    expect(store.mode).toBe('page');
  });

  it('switches at once, writes the choice, and is not told about its own write', async () => {
    const store = new ReadingModeStore();
    store.attach(registry);
    const listener = vi.fn();
    store.subscribe(listener);

    await store.set('panel');
    expect(store.mode).toBe('panel');
    expect(store.loaded).toBe(true);
    expect(chromeStorageSnapshot().get(READING_MODE_KEY)).toBe('panel');
    expect(listener).toHaveBeenCalledExactlyOnceWith('panel');
  });

  it('follows a switch made somewhere else and ignores other keys', async () => {
    const store = new ReadingModeStore();
    store.attach(registry);
    const listener = vi.fn();
    store.subscribe(listener);

    await chrome.storage.local.set({ [READING_MODE_KEY]: 'panel' });
    expect(store.mode).toBe('panel');
    expect(store.loaded).toBe(true);

    await chrome.storage.local.set({ 'something:else': true });
    expect(listener).toHaveBeenCalledExactlyOnceWith('panel');
  });

  it('does not let a slow first read undo a newer switch', async () => {
    const store = new ReadingModeStore();
    store.attach(registry);
    let answer = (): void => {};
    vi.spyOn(chrome.storage.local, 'get').mockImplementation((() =>
      new Promise((resolve) => {
        answer = () => resolve({ [READING_MODE_KEY]: 'page' });
      })) as never);

    const loading = store.load();
    await store.set('panel');
    answer();
    await loading;
    expect(store.mode).toBe('panel');
  });

  it('carries on when storage fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(chrome.storage.local, 'get').mockImplementation((() =>
      Promise.reject(new Error('gone'))) as never);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation((() =>
      Promise.reject(new Error('gone'))) as never);
    const store = new ReadingModeStore();

    await store.load();
    expect(store.loaded).toBe(true);
    expect(store.mode).toBe('page');

    await store.set('panel');
    expect(store.mode).toBe('panel');
  });

  it('stops listening once disposed', async () => {
    const store = new ReadingModeStore();
    store.attach(registry);
    const listener = vi.fn();
    store.subscribe(listener);

    registry.dispose();
    await chrome.storage.local.set({ [READING_MODE_KEY]: 'panel' });
    expect(listener).not.toHaveBeenCalled();
    expect(store.mode).toBe('page');
  });
});
```

- [ ] **Step 2：运行，确认失败**

Run: `pnpm vitest run tests/unit/reading-mode-store.test.ts`
Expected: FAIL，报找不到 `@/core/readingMode`（`Failed to resolve import`）。

- [ ] **Step 3：写实现**

新建 `src/core/readingMode.ts`：

```ts
/** Where saved posts are read: over X's main column, or in the browser's side panel. */
export type ReadingMode = 'page' | 'panel';

/** A fresh install reads in the page (work order 2.3). */
export const DEFAULT_READING_MODE: ReadingMode = 'page';

export function isReadingMode(value: unknown): value is ReadingMode {
  return value === 'page' || value === 'panel';
}
```

`src/core/constants.ts`：在 `DEBUG_FLAG_KEY` 那一段后面加上：

```ts
/** `chrome.storage.local` key holding the reading mode: `'page'` or `'panel'`. */
export const READING_MODE_KEY = 'xf:reading-mode';
```

新建 `src/state/ReadingModeStore.ts`：

```ts
import { READING_MODE_KEY } from '@/core/constants';
import { DEFAULT_READING_MODE, isReadingMode, type ReadingMode } from '@/core/readingMode';
import type { CleanupRegistry } from '@/utils/cleanup';
import { createLogger } from '@/utils/logger';

const log = createLogger('reading-mode');

export type ReadingModeListener = (mode: ReadingMode) => void;

/**
 * The reading mode, shared by every X tab and the side panel through
 * `chrome.storage.local` (work order 3.1): whoever switches writes the key and
 * everyone else hears `storage.onChanged`. The background keeps nothing.
 */
export class ReadingModeStore {
  #mode: ReadingMode = DEFAULT_READING_MODE;
  #loaded = false;
  /** Bumped by every switch, so a slow first read cannot undo a newer one. */
  #revision = 0;
  readonly #listeners = new Set<ReadingModeListener>();

  get mode(): ReadingMode {
    return this.#mode;
  }

  /** False until the stored choice is known; before that `mode` is only the default. */
  get loaded(): boolean {
    return this.#loaded;
  }

  /** Called on changes only. Read `mode` for the current value. */
  subscribe(listener: ReadingModeListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  attach(registry: CleanupRegistry): void {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      if (areaName !== 'local') return;
      const change = changes[READING_MODE_KEY];
      if (change === undefined) return;
      this.#revision += 1;
      this.#loaded = true;
      this.#apply(isReadingMode(change.newValue) ? change.newValue : DEFAULT_READING_MODE);
    };
    chrome.storage.onChanged.addListener(listener);
    registry.add(() => chrome.storage.onChanged.removeListener(listener));
    registry.add(() => this.#listeners.clear());
  }

  /** Reads the stored choice. Never rejects: a storage failure leaves the default. */
  async load(): Promise<void> {
    const revision = this.#revision;
    let stored: unknown;
    try {
      stored = (await chrome.storage.local.get(READING_MODE_KEY))[READING_MODE_KEY];
    } catch (error) {
      log.warn('could not read the reading mode', error);
    }
    this.#loaded = true;
    // A switch heard while the read was in flight is newer than its answer.
    if (revision === this.#revision && isReadingMode(stored)) this.#apply(stored);
  }

  /** Switches for everyone: applied here at once, and written for the others. */
  async set(mode: ReadingMode): Promise<void> {
    this.#revision += 1;
    this.#loaded = true;
    // The write is issued first — an async function runs up to its first await
    // synchronously — because a listener may close this very page.
    const written = this.#write(mode);
    this.#apply(mode);
    await written;
  }

  async #write(mode: ReadingMode): Promise<void> {
    try {
      await chrome.storage.local.set({ [READING_MODE_KEY]: mode });
    } catch (error) {
      log.warn('could not store the reading mode', error);
    }
  }

  #apply(mode: ReadingMode): void {
    if (mode === this.#mode) return;
    this.#mode = mode;
    for (const listener of this.#listeners) listener(mode);
  }
}
```

- [ ] **Step 4：运行，确认通过**

Run: `pnpm vitest run tests/unit/reading-mode-store.test.ts`
Expected: PASS，`Tests  9 passed`。

- [ ] **Step 5：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全部成功；`Tests  281 passed`（原 272 + 本任务 9）。

```bash
git add src/core/readingMode.ts src/core/constants.ts src/state/ReadingModeStore.ts tests/unit/reading-mode-store.test.ts
git commit -m "阅读模式偏好：存在扩展存储里，任何一处切换各处即时生效"
git push origin main
```

---

### Task 2：打开原帖改为 X 页面内切换

**Files:**
- Create: `src/hosts/x/navigateInPage.ts`
- Modify: `src/hosts/x/FolderViewMount.tsx`
- Modify: `src/hosts/x/NavigateHandler.ts`
- Test: `tests/unit/navigate-in-page.test.ts`
- Test: `tests/unit/folder-view.test.tsx`（修改）

- [ ] **Step 1：写失败的测试**

新建 `tests/unit/navigate-in-page.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IN_PAGE_TIMEOUT_MS,
  navigateInPage,
  onPostPage,
  showsPost,
} from '@/hosts/x/navigateInPage';
import { CleanupRegistry } from '@/utils/cleanup';
import { mountPost, postHtml, quoteHtml } from '../helpers/postDom';

const POST = 'https://x.com/alice/status/1234567890';

describe('navigateInPage', () => {
  let registry: CleanupRegistry;
  const assign = vi.fn<(url: string) => void>();
  const replace = vi.fn<(url: string) => void>();
  const go = (url: string): void => navigateInPage(url, { registry, assign, replace });

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new CleanupRegistry();
    assign.mockReset();
    replace.mockReset();
    document.body.innerHTML = '';
    history.pushState({}, '', '/home');
  });

  afterEach(() => {
    registry.dispose();
    vi.useRealTimers();
    history.pushState({}, '', '/home');
  });

  it('changes the address and tells the page, without loading anything', () => {
    const heard: unknown[] = [];
    const onPop = (event: PopStateEvent): void => {
      heard.push(event.state);
    };
    window.addEventListener('popstate', onPop);
    go(POST);
    window.removeEventListener('popstate', onPop);

    expect(location.href).toBe(POST);
    // X's router throws away a popstate whose state is undefined.
    expect(heard).toEqual([{}]);
    expect(assign).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('stands down once X shows the post', () => {
    go(POST);
    mountPost(postHtml({ focused: true }));
    vi.advanceTimersByTime(IN_PAGE_TIMEOUT_MS + 500);
    expect(replace).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('loads the page in full when X never shows the post', () => {
    go(POST);
    vi.advanceTimersByTime(IN_PAGE_TIMEOUT_MS - 200);
    expect(replace).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(replace).toHaveBeenCalledExactlyOnceWith(POST);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stands down when the reader has already moved on', () => {
    go(POST);
    history.pushState({}, '', '/notifications');
    vi.advanceTimersByTime(IN_PAGE_TIMEOUT_MS + 500);
    expect(replace).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does nothing when the page is already that post', () => {
    history.pushState({}, '', '/alice/status/1234567890');
    const pushed = vi.spyOn(history, 'pushState');
    go(POST);
    expect(pushed).not.toHaveBeenCalled();
    pushed.mockRestore();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('loads in full across origins and for anything that is not a post', () => {
    go('https://twitter.com/alice/status/1234567890');
    expect(assign).toHaveBeenLastCalledWith('https://twitter.com/alice/status/1234567890');
    go('https://x.com/alice');
    expect(assign).toHaveBeenLastCalledWith('https://x.com/alice');
    expect(location.pathname).toBe('/home');
  });

  it('refuses anything that is not an https x.com address', () => {
    go('javascript:alert(1)');
    go('https://evil.example/alice/status/1234567890');
    expect(assign).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/home');
  });

  it('stops watching when the content script is disposed', () => {
    go(POST);
    registry.dispose();
    vi.advanceTimersByTime(IN_PAGE_TIMEOUT_MS + 500);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('telling which post the page is on', () => {
  afterEach(() => {
    history.pushState({}, '', '/home');
  });

  it('recognises the post X shows as the subject of the page', () => {
    mountPost(postHtml({ focused: true }));
    expect(showsPost('1234567890')).toBe(true);
    expect(showsPost('999')).toBe(false);
  });

  it('is not fooled by a timeline row, or by the post the subject quotes', () => {
    mountPost(postHtml());
    expect(showsPost('1234567890')).toBe(false);
    mountPost(postHtml({ focused: true, quoteHtml: quoteHtml({ linkId: '42' }) }));
    expect(showsPost('42')).toBe(false);
  });

  it('reads the address bar, photo viewer and all', () => {
    history.pushState({}, '', '/alice/status/77/photo/1');
    expect(onPostPage('77')).toBe(true);
    expect(onPostPage('78')).toBe(false);
  });
});
```

- [ ] **Step 2：运行，确认失败**

Run: `pnpm vitest run tests/unit/navigate-in-page.test.ts`
Expected: FAIL，报找不到 `@/hosts/x/navigateInPage`。

- [ ] **Step 3：写实现**

新建 `src/hosts/x/navigateInPage.ts`：

```ts
import type { CleanupRegistry } from '@/utils/cleanup';
import { createLogger } from '@/utils/logger';
import { isSafeXUrl, parseStatusUrl } from '@/utils/url';
import { X_SELECTORS } from './selectors';
import { findIdentityAnchor, quoteSubtrees } from './TweetExtractor';

const log = createLogger('navigate');

/** How long X gets to show the post before the page is loaded in full instead. */
export const IN_PAGE_TIMEOUT_MS = 3000;
const POLL_MS = 100;

export interface NavigateDeps {
  registry: CleanupRegistry;
  /** A full page load that adds a history entry. Injectable: jsdom cannot navigate. */
  assign?: (url: string) => void;
  /** A full page load in place of the current history entry. */
  replace?: (url: string) => void;
}

/** True when the address bar is already on this post's page. */
export function onPostPage(tweetId: string): boolean {
  return parseStatusUrl(location.href)?.tweetId === tweetId;
}

/** True when X is showing this post as the subject of the page. */
export function showsPost(tweetId: string, doc: Document = document): boolean {
  const focused = doc.querySelector(X_SELECTORS.focusedTweet);
  if (focused === null) return false;
  const anchor = findIdentityAnchor(focused, quoteSubtrees(focused));
  return anchor !== null && parseStatusUrl(anchor.href)?.tweetId === tweetId;
}

/**
 * Opens a post the way one of X's own links does: X's router is told the
 * address changed and swaps the page in place, with no reload (work order 2.3;
 * measured on real X on 2026-09-30, appendix A item 14).
 *
 * `pushState` plus a `popstate` event is all it takes, and both work from the
 * content script's isolated world, so nothing is injected into the page.
 * Should X ever stop answering — the post is not on screen after
 * IN_PAGE_TIMEOUT_MS — the address is loaded in full, as before.
 */
export function navigateInPage(url: string, deps: NavigateDeps): void {
  if (!isSafeXUrl(url)) return;
  const assign = deps.assign ?? ((target: string) => location.assign(target));
  const replace = deps.replace ?? ((target: string) => location.replace(target));

  const post = parseStatusUrl(url);
  const target = new URL(url);
  // Only a post can be watched for, and pushState cannot leave the origin
  // (a twitter.com page asked for an x.com address).
  if (post === null || target.origin !== location.origin) {
    assign(url);
    return;
  }
  if (onPostPage(post.tweetId)) return;

  try {
    history.pushState({}, '', `${target.pathname}${target.search}${target.hash}`);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  } catch (error) {
    log.warn('in-page navigation failed', error);
    assign(url);
    return;
  }

  const landed = location.href;
  const started = Date.now();
  const timer = setInterval(() => {
    // The reader moved on, or X did its part: nothing left to guard.
    if (location.href !== landed || showsPost(post.tweetId)) {
      stop();
      return;
    }
    if (Date.now() - started < IN_PAGE_TIMEOUT_MS) return;
    stop();
    log.warn('X did not switch pages; loading in full');
    replace(landed);
  }, POLL_MS);
  const stop = deps.registry.addInterval(timer);
}
```

- [ ] **Step 4：运行，确认通过**

Run: `pnpm vitest run tests/unit/navigate-in-page.test.ts`
Expected: PASS，`Tests  11 passed`。

- [ ] **Step 5：给收藏列表的测试加上「打开原帖」的用例**

`tests/unit/folder-view.test.tsx`：

在文件顶部的变量声明里，`let membershipChanges: Array<[string, number]> = [];` 后面加一行：

```ts
let navigations: string[] = [];
```

在 `beforeEach` 里，`membershipChanges = [];` 后面加一行：

```ts
    navigations = [];
```

把 `beforeEach` 里构造 `FolderViewMount` 的那段改成（多了 `navigate`）：

```ts
    mount = new FolderViewMount({
      store,
      theme: new ThemeAdapter(document),
      registry,
      onMembershipChanged: (tweetId, membershipCount) =>
        membershipChanges.push([tweetId, membershipCount]),
      navigate: (url) => {
        navigations.push(url);
      },
    });
```

在 `it('links each row to its post and never links an unsafe one', …)` 这个用例后面加两个用例：

```ts
  it('opens a post through X’s own page switch, or a new tab on ⌘/Ctrl-click', async () => {
    seed(2);
    await store.refresh();
    await open();
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const name = rows()[0]?.querySelector<HTMLElement>('.xf-tc-name');

    name?.click();
    expect(navigations).toEqual([records[0]?.tweet.canonicalUrl]);
    expect(opened).not.toHaveBeenCalled();

    name?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    expect(opened).toHaveBeenCalledWith(
      records[0]?.tweet.canonicalUrl,
      '_blank',
      'noopener,noreferrer',
    );
    expect(navigations).toHaveLength(1);
    opened.mockRestore();
  });

  it('just closes when the page is already showing that post', async () => {
    seed(1);
    await store.refresh();
    await open();
    const saved = records[0]?.tweet;
    history.pushState({}, '', `/${saved?.username}/status/${saved?.tweetId}`);
    try {
      rows()[0]?.querySelector<HTMLElement>('.xf-tc-name')?.click();
      expect(navigations).toEqual([]);
      expect(mount.isOpen()).toBe(false);
    } finally {
      history.pushState({}, '', '/home');
    }
  });
```

- [ ] **Step 6：运行，确认失败**

Run: `pnpm vitest run tests/unit/folder-view.test.tsx`
Expected: 新加的两个用例 FAIL（`navigations` 是空的：现在点卡片走的是 `location.assign`）。`pnpm typecheck` 此时也会报 `navigate` 不在 `FolderViewDeps` 里。

- [ ] **Step 7：收藏列表改用页面内切换**

`src/hosts/x/FolderViewMount.tsx`，四处：

① import 区，把

```ts
import { isSafeXUrl } from '@/utils/url';
import { locatePrimaryColumn } from './PrimaryColumnLocator';
```

改成

```ts
import { isSafeXUrl, parseStatusUrl } from '@/utils/url';
import { navigateInPage, onPostPage } from './navigateInPage';
import { locatePrimaryColumn } from './PrimaryColumnLocator';
```

② `FolderViewDeps` 接口里，`onMembershipChanged` 后面加：

```ts
  /** Opens a post in this tab. Defaults to X's in-page switch; tests pass a spy. */
  navigate?: (url: string) => void;
```

③ `#render` 里把 `onOpenPost={openPostHere}` 改成：

```tsx
        onOpenPost={(url, options) => this.#openPost(url, options)}
```

④ 删除文件末尾的 `openPostHere` 函数（连同它上面的注释），在类里 `#openInSidePanel` 方法后面加：

```ts
  /**
   * A click on a card: X switches to the post in place, as it does for its own
   * links, and the route change closes this view. ⌘/Ctrl-click opens a new tab
   * instead. Only x.com permalinks are followed.
   */
  #openPost(url: string, options: OpenOptions): void {
    if (!isSafeXUrl(url)) return;
    if (options.newTab) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    const post = parseStatusUrl(url);
    // Already on that post's page: the list only has to get out of the way.
    if (post !== null && onPostPage(post.tweetId)) {
      this.close();
      return;
    }
    if (this.deps.navigate !== undefined) this.deps.navigate(url);
    else navigateInPage(url, { registry: this.deps.registry });
  }
```

- [ ] **Step 8：侧边栏请求打开原帖时也用页面内切换**

`src/hosts/x/NavigateHandler.ts`：import 区加一行

```ts
import { navigateInPage } from './navigateInPage';
```

把函数上方的注释和签名

```ts
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
```

改成

```ts
/**
 * Lets the side panel open a saved post in this tab, the way X opens its own
 * links (see navigateInPage).
 *
 * The URL is re-checked here: it crossed a context boundary and is treated as
 * untrusted. The reply goes out *before* navigating: should the in-page switch
 * fall back to a full load, this content script is torn down and the side
 * panel would otherwise wait for an answer that never comes.
 */
export function listenForNavigateRequests(
  registry: CleanupRegistry,
  navigate: (url: string) => void = (url) => navigateInPage(url, { registry }),
): void {
```

- [ ] **Step 9：运行，确认通过**

Run: `pnpm vitest run tests/unit/folder-view.test.tsx tests/unit/navigate-handler.test.ts tests/unit/navigate-in-page.test.ts`
Expected: PASS，三个文件全部通过。

- [ ] **Step 10：全量检查（含端到端）并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e
```

Expected: 全部成功；单元测试 `Tests  294 passed`（281 + 13）；端到端 `13 passed`——「点卡片打开原帖」那一条照旧通过，因为地址立刻就变了。

```bash
git add src/hosts/x/navigateInPage.ts src/hosts/x/FolderViewMount.tsx src/hosts/x/NavigateHandler.ts tests/unit/navigate-in-page.test.ts tests/unit/folder-view.test.tsx
git commit -m "打开原帖改为 X 页面内切换，X 没有响应时 3 秒后整页加载"
git push origin main
```

---

### Task 3：已补全的长帖在卡片内折叠 / 展开

**Files:**
- Create: `src/ui/tweet-card/collapse.ts`
- Modify: `src/ui/tweet-card/TweetText.tsx`
- Test: `tests/unit/collapse.test.ts`
- Test: `tests/unit/tweet-card.test.tsx`（修改）
- Test: `tests/e2e/harness.ts`（修改）
- Test: `tests/e2e/rich-card.spec.ts`（修改）

规则：帖子还是 X 截断的那一段（`truncated` 为真）时不动，「显示更多」照旧是打开原帖的链接。帖子已经是全文时，按 X 的算法计长度（英文、数字、常见标点算 1，中文和表情算 2），超过 300 就只显示前 280，后面跟「…」和一个「显示更多」按钮；点按钮在卡片里展开，不跳转。

- [ ] **Step 1：写折叠规则的失败测试**

新建 `tests/unit/collapse.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import type { TextSegment } from '@/core/domain/tweet';
import {
  COLLAPSE_LIMIT,
  COLLAPSE_SLACK,
  collapseSegments,
  weightedLength,
} from '@/ui/tweet-card/collapse';

const text = (value: string): TextSegment => ({ kind: 'text', text: value });
const shown = (segments: readonly TextSegment[]): string =>
  segments.map((segment) => segment.text).join('');

describe('weightedLength', () => {
  it('counts Latin as 1 and CJK or emoji as 2, as X does', () => {
    expect(weightedLength('hello')).toBe(5);
    expect(weightedLength('你好')).toBe(4);
    expect(weightedLength('a你🙂')).toBe(5);
  });
});

describe('collapseSegments', () => {
  it('leaves alone a post within the limit, and one only a little over it', () => {
    const short = [text('a'.repeat(COLLAPSE_LIMIT))];
    expect(collapseSegments(short)).toEqual({ segments: short, collapsed: false });
    const slightlyOver = [text('a'.repeat(COLLAPSE_LIMIT + COLLAPSE_SLACK))];
    expect(collapseSegments(slightlyOver).collapsed).toBe(false);
  });

  it('cuts a long post at the limit and ends it with an ellipsis', () => {
    const result = collapseSegments([text('a'.repeat(1000))]);
    expect(result.collapsed).toBe(true);
    expect(shown(result.segments)).toBe(`${'a'.repeat(COLLAPSE_LIMIT)}…`);
  });

  it('gives Chinese half as many characters', () => {
    const result = collapseSegments([text('字'.repeat(600))]);
    expect(shown(result.segments)).toBe(`${'字'.repeat(COLLAPSE_LIMIT / 2)}…`);
  });

  it('never cuts through a link, a mention or a hashtag', () => {
    const link: TextSegment = { kind: 'link', text: 'example.com/a-long-path', url: 'https://t.co/x' };
    const lead = text('a'.repeat(COLLAPSE_LIMIT - 5));
    const result = collapseSegments([lead, link, text('b'.repeat(500))]);
    expect(result.collapsed).toBe(true);
    expect(result.segments).toEqual([lead, text('…')]);
  });

  it('keeps the whole segments that fit before the cut', () => {
    const mention: TextSegment = { kind: 'mention', text: '@bob', username: 'bob' };
    const result = collapseSegments([text('Hi '), mention, text(` ${'c'.repeat(600)}`)]);
    expect(result.segments.slice(0, 2)).toEqual([text('Hi '), mention]);
    expect(shown(result.segments)).toBe(`Hi @bob ${'c'.repeat(272)}…`);
  });

  it('does not leave blank lines hanging before the ellipsis', () => {
    const body = `${'a'.repeat(COLLAPSE_LIMIT - 2)}\n\n${'b'.repeat(500)}`;
    expect(shown(collapseSegments([text(body)]).segments)).toBe(`${'a'.repeat(COLLAPSE_LIMIT - 2)}…`);
  });

  it('does not split an emoji in two', () => {
    const body = `${'a'.repeat(COLLAPSE_LIMIT - 1)}🙂${'b'.repeat(500)}`;
    expect(shown(collapseSegments([text(body)]).segments)).toBe(`${'a'.repeat(COLLAPSE_LIMIT - 1)}…`);
  });
});
```

- [ ] **Step 2：运行，确认失败**

Run: `pnpm vitest run tests/unit/collapse.test.ts`
Expected: FAIL，报找不到 `@/ui/tweet-card/collapse`。

- [ ] **Step 3：写折叠规则**

新建 `src/ui/tweet-card/collapse.ts`：

```ts
import type { TextSegment } from '@/core/domain/tweet';

/** X's timeline cuts a long post at 280 weighted characters; so does the card. */
export const COLLAPSE_LIMIT = 280;
/** Text only this much over the limit is shown whole: folding away one line helps nobody. */
export const COLLAPSE_SLACK = 20;

/**
 * X's own way of counting: Latin letters, digits and common punctuation weigh
 * 1; everything else — CJK, emoji — weighs 2. So the limit is about 280 English
 * characters or 140 Chinese ones.
 */
function weightOf(codePoint: number): number {
  const light =
    codePoint <= 0x10ff ||
    (codePoint >= 0x2000 && codePoint <= 0x200d) ||
    (codePoint >= 0x2010 && codePoint <= 0x201f) ||
    (codePoint >= 0x2032 && codePoint <= 0x2037);
  return light ? 1 : 2;
}

export function weightedLength(text: string): number {
  let total = 0;
  // Iterating a string walks code points, so an emoji is one step, not two.
  for (const char of text) total += weightOf(char.codePointAt(0) ?? 0);
  return total;
}

/** As much of the start of `text` as fits in `budget`, never splitting a character. */
function takeWeighted(text: string, budget: number): string {
  let out = '';
  let used = 0;
  for (const char of text) {
    const weight = weightOf(char.codePointAt(0) ?? 0);
    if (used + weight > budget) break;
    out += char;
    used += weight;
  }
  return out;
}

/** Drops trailing blank space, so the ellipsis follows the last word. */
function trimTail(segments: TextSegment[]): void {
  for (;;) {
    const last = segments[segments.length - 1];
    if (last === undefined || last.kind !== 'text') return;
    const trimmed = last.text.trimEnd();
    if (trimmed.length === last.text.length) return;
    if (trimmed.length > 0) {
      segments[segments.length - 1] = { kind: 'text', text: trimmed };
      return;
    }
    segments.pop();
  }
}

export interface Collapsed {
  segments: TextSegment[];
  /** False: the text was short enough, and `segments` is all of it. */
  collapsed: boolean;
}

/**
 * The start of a long post, for the folded card (work order 2.4). Plain text is
 * cut at the limit; a link, mention or hashtag is kept whole or left out, never
 * cut through.
 */
export function collapseSegments(
  segments: readonly TextSegment[],
  limit: number = COLLAPSE_LIMIT,
  slack: number = COLLAPSE_SLACK,
): Collapsed {
  const total = segments.reduce((sum, segment) => sum + weightedLength(segment.text), 0);
  if (total <= limit + slack) return { segments: [...segments], collapsed: false };

  const kept: TextSegment[] = [];
  let used = 0;
  for (const segment of segments) {
    const weight = weightedLength(segment.text);
    if (used + weight <= limit) {
      kept.push(segment);
      used += weight;
      continue;
    }
    if (segment.kind === 'text') {
      const head = takeWeighted(segment.text, limit - used);
      if (head.length > 0) kept.push({ kind: 'text', text: head });
    }
    break;
  }
  trimTail(kept);
  kept.push({ kind: 'text', text: '…' });
  return { segments: kept, collapsed: true };
}
```

- [ ] **Step 4：运行，确认通过**

Run: `pnpm vitest run tests/unit/collapse.test.ts`
Expected: PASS，`Tests  8 passed`。

- [ ] **Step 5：给卡片测试加上折叠 / 展开的用例**

`tests/unit/tweet-card.test.tsx`：在 `it('offers "显示更多" on a truncated post', …)` 这个用例后面加两个用例：

```ts
  it('folds a long complete post and unfolds it in place', async () => {
    const long = 'a'.repeat(700);
    const onOpen = draw({ ...RICH, text: long, segments: [{ kind: 'text', text: long }], media: [] });
    const body = (): string => container.querySelector('.xf-tc-text')?.textContent ?? '';

    expect(body()).toContain('…');
    expect(body().length).toBeLessThan(320);
    const more = container.querySelector<HTMLButtonElement>('button.xf-tc-more');
    expect(more?.textContent).toBe('显示更多');

    more?.click();
    await flush();
    expect(container.querySelector('.xf-tc-more')).toBeNull();
    expect(body()).toBe(long);
    // Unfolding is not opening.
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('keeps "显示更多" a link to the post while only X’s own cut is saved', () => {
    const long = 'a'.repeat(700);
    draw({ ...RICH, text: long, segments: [{ kind: 'text', text: long }], truncated: true });
    expect(container.querySelector('button.xf-tc-more')).toBeNull();
    expect(container.querySelector('a.xf-tc-more')).not.toBeNull();
    expect(container.querySelector('.xf-tc-text')?.textContent).toContain(long);
  });
```

- [ ] **Step 6：运行，确认失败**

Run: `pnpm vitest run tests/unit/tweet-card.test.tsx`
Expected: 新加的第一个用例 FAIL（卡片显示了全部 700 个字符，也没有「显示更多」按钮）。第二个用例现在就能过，它守住的是「未补全的不折叠」。

- [ ] **Step 7：卡片正文接上折叠规则**

把 `src/ui/tweet-card/TweetText.tsx` 整个替换为：

```tsx
import { useMemo, useState } from 'preact/hooks';
import type { TextSegment } from '@/core/domain/tweet';
import { isAllowedLinkUrl } from '@/utils/url';
import { collapseSegments } from './collapse';
import { displayLinkText } from './format';

const OUTBOUND = { target: '_blank', rel: 'noopener noreferrer' } as const;

function renderSegment(segment: TextSegment, key: number): preact.ComponentChildren {
  switch (segment.kind) {
    case 'text':
    case 'emoji':
      return segment.text;
    case 'mention':
      return (
        <a key={key} class="xf-tc-link" href={`https://x.com/${encodeURIComponent(segment.username)}`} {...OUTBOUND}>
          {segment.text}
        </a>
      );
    case 'hashtag':
      return (
        <a key={key} class="xf-tc-link" href={`https://x.com/hashtag/${encodeURIComponent(segment.tag)}`} {...OUTBOUND}>
          {segment.text}
        </a>
      );
    case 'link':
      // Checked again at render time: whatever the database holds, only
      // http(s) ever becomes a link.
      return isAllowedLinkUrl(segment.url) ? (
        <a key={key} class="xf-tc-link" href={segment.url} title={segment.url} {...OUTBOUND}>
          {displayLinkText(segment.text)}
        </a>
      ) : (
        displayLinkText(segment.text)
      );
  }
}

export interface TweetTextProps {
  segments: readonly TextSegment[];
  /** X cut the text short, and that cut is all that was saved. */
  truncated: boolean;
  /** Where "显示更多" leads while the text is X's cut: the post itself; null when it has no safe link. */
  moreHref: string | null;
  onMore: (event: MouseEvent) => void;
}

/**
 * Post text with links, mentions and hashtags live; newlines are kept by CSS.
 *
 * "显示更多" means one of two things (work order 2.4). While only X's own cut
 * of a long post is saved, it is a link to the post. Once the whole text is
 * saved, the card folds it the way X's timeline does and the same words unfold
 * it in place, with no navigation.
 */
export function TweetText(props: TweetTextProps): preact.JSX.Element | null {
  const [unfolded, setUnfolded] = useState(false);
  const folded = useMemo(
    () => (props.truncated ? null : collapseSegments(props.segments)),
    [props.segments, props.truncated],
  );
  const folding = folded !== null && folded.collapsed && !unfolded ? folded.segments : null;
  const shown = folding ?? props.segments;

  if (shown.length === 0 && !props.truncated) return null;
  return (
    <div class="xf-tc-text" dir="auto">
      {shown.map(renderSegment)}
      {props.truncated && props.moreHref !== null && (
        <>
          {' '}
          <a class="xf-tc-more" href={props.moreHref} onClick={props.onMore}>
            显示更多
          </a>
        </>
      )}
      {folding !== null && (
        <>
          {' '}
          <button type="button" class="xf-tc-more" onClick={() => setUnfolded(true)}>
            显示更多
          </button>
        </>
      )}
    </div>
  );
}
```

样式不用改：`.xf-tc-more` 已经是强调色，按钮的字体和光标来自公共样式；卡片把 `button` 当作控件，点它不会打开原帖。

- [ ] **Step 8：运行，确认通过**

Run: `pnpm vitest run tests/unit/tweet-card.test.tsx tests/unit/collapse.test.ts`
Expected: PASS。

- [ ] **Step 9：更新端到端测试——样本页面的布局，和长帖用例**

先补测试装置。样本页面保留了 X 的结构、没有 X 的样式，左侧导航因此占满第一屏，主栏从第 707 像素才开始；页面没滚动时，收藏列表覆盖层只有 13 像素高，里面的按钮点不到（2026-10-01 实测）。真实 X 上导航固定在左边、主栏从窗口顶部开始。让样本页面也是这个形状：`tests/e2e/harness.ts` 的 `addInitScript` 里，把

```ts
        // On real X the navigation sits inside a z-index 0 stacking context, so
        // nothing mounted in it can rise above our page-level overlay.
        const banner = nav.closest('header[role="banner"]');
        if (banner instanceof HTMLElement) Object.assign(banner.style, { position: 'relative', zIndex: '0' });
```

改成

```ts
        // X lays the page out in columns: the navigation is pinned to the left
        // edge and the main column starts at the top of the window beside it.
        // Unstyled, the banner fills the first screen and pushes the main column
        // — and with it the folder-view overlay — below the fold. On real X it
        // also sits in a z-index 0 stacking context, so nothing mounted in it
        // can rise above our page-level overlay.
        const banner = nav.closest('header[role="banner"]');
        if (banner instanceof HTMLElement) {
          Object.assign(banner.style, { position: 'fixed', top: '0', left: '0', width: '275px', zIndex: '0' });
        }
        const main = document.querySelector('main');
        if (main instanceof HTMLElement) main.style.marginLeft = '275px';
```

再改长帖用例。补全之后，卡片上的「显示更多」不再消失，而是从「链接」变成「按钮」。把 `tests/e2e/rich-card.spec.ts` 里 `test('a post saved cut short is completed once its own page has been seen', …)` 整个用例替换为：

```ts
test('a post saved cut short is completed once its own page has been seen, then unfolds in the card', async ({
  harness,
}) => {
  const page = await harness.openX(RICH);
  await ready(page);
  await createFolder(page, '长帖');
  await saveInto(page, LONG_POST, '长帖');
  const overlay = await openFolder(page, '长帖');
  // Saved from the timeline: X's own cut, and "显示更多" is a link to the post.
  await expect(overlay.locator(`[data-xf-tweet-id="${LONG_POST}"] a.xf-tc-more`)).toHaveCount(1);

  // The post's own page shows the whole text: once its saved count arrives,
  // the refresher sends the fuller capture and the background merges it.
  const detail = await harness.openX(`/user1/status/${LONG_POST}?fixture=status-long`);
  await ready(detail);

  // Completed: the link gives way to a button that unfolds the text in place.
  await expect
    .poll(
      async () => {
        await page.reload();
        const again = await openFolder(page, '长帖');
        return again.locator(`[data-xf-tweet-id="${LONG_POST}"] button.xf-tc-more`).count();
      },
      { timeout: 10_000 },
    )
    .toBe(1);

  const row = page.locator('[data-xf-overlay-host]').locator(`[data-xf-tweet-id="${LONG_POST}"]`);
  await expect(row.locator('a.xf-tc-more')).toHaveCount(0);
  const folded = (await row.locator('.xf-tc-text').innerText()).length;
  await row.locator('button.xf-tc-more').click();
  await expect(row.locator('button.xf-tc-more')).toHaveCount(0);
  expect((await row.locator('.xf-tc-text').innerText()).length).toBeGreaterThan(folded);
  // Unfolded where it is: the page did not go anywhere.
  await expect(page).toHaveURL(/\/home/);
});
```

（长帖样本的全文是 424 个字符、全部算 2，远超折叠线，所以补全后一定是折叠的。）

- [ ] **Step 10：全量检查（含端到端）并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e
```

Expected: 全部成功；单元测试 `Tests  304 passed`（294 + 10）；端到端 `13 passed`。

```bash
git add src/ui/tweet-card/collapse.ts src/ui/tweet-card/TweetText.tsx tests/unit/collapse.test.ts tests/unit/tweet-card.test.tsx tests/e2e/harness.ts tests/e2e/rich-card.spec.ts
git commit -m "已补全的长帖在卡片内折叠，「显示更多」就地展开"
git push origin main
```

---

### Task 4：返回位置的存取

**Files:**
- Modify: `src/core/constants.ts`
- Modify: `tests/setup.ts`
- Create: `src/hosts/x/historyEntry.ts`
- Create: `src/hosts/x/ReturnState.ts`
- Create: `src/background/sessionStorage.ts`
- Modify: `src/entrypoints/background.ts`
- Test: `tests/unit/return-state.test.ts`
- Test: `tests/unit/session-access.test.ts`

工单 3.4：返回位置「只存在浏览器会话里，关闭浏览器即清除；跳转可能是整页加载，恢复逻辑不能依赖内容脚本的内存」。所以存在 `chrome.storage.session`（只在内存里，X 页面上的脚本读不到），按「历史条目」的标识分开存——回到哪个条目，就取哪个条目的记录。

- [ ] **Step 1：测试用的 chrome 模拟补上会话存储**

把 `tests/setup.ts` 里从文件开头到 `const chromeStub = { … };` 结束的部分（即 `/** jsdom implements neither of these.` 这段注释之前的全部内容）替换为：

```ts
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

/**
 * Minimal `chrome` stub. The extension only touches `storage.local`,
 * `storage.session`, `storage.onChanged`, `runtime.sendMessage` and
 * `runtime.getManifest`; anything else is intentionally absent so an
 * accidental new API dependency fails loudly in tests.
 */
type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;

interface StoredListener {
  (changes: Changes, area: string): void;
}

const changeListeners = new Set<StoredListener>();

/** One storage area. `storage.onChanged` listeners are told which one changed. */
function createArea(area: 'local' | 'session') {
  const data = new Map<string, unknown>();
  return {
    data,
    api: {
      async get(keys?: string | string[]): Promise<Record<string, unknown>> {
        const out: Record<string, unknown> = {};
        const wanted = keys === undefined ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
        for (const key of wanted) {
          if (data.has(key)) out[key] = data.get(key);
        }
        return out;
      },
      async set(items: Record<string, unknown>): Promise<void> {
        const changes: Changes = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: data.get(key), newValue: value };
          data.set(key, value);
        }
        for (const listener of changeListeners) listener(changes, area);
      },
      async remove(key: string): Promise<void> {
        data.delete(key);
      },
    },
  };
}

const local = createArea('local');
const session = createArea('session');

const chromeStub = {
  runtime: {
    lastError: undefined as { message: string } | undefined,
    sendMessage: vi.fn(),
    getManifest: vi.fn(() => ({ manifest_version: 3, name: 'X Folders (test)', version: '0.0.0-test' })),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  storage: {
    local: local.api,
    // In memory for the browser session. Content scripts reach it only after
    // the background opens it (src/background/sessionStorage.ts).
    session: { ...session.api, setAccessLevel: vi.fn(async (): Promise<void> => {}) },
    onChanged: {
      addListener(listener: StoredListener): void {
        changeListeners.add(listener);
      },
      removeListener(listener: StoredListener): void {
        changeListeners.delete(listener);
      },
    },
  },
};
```

再把文件末尾的两个导出函数替换为三个：

```ts
export function resetChromeStub(): void {
  local.data.clear();
  session.data.clear();
  changeListeners.clear();
  chromeStub.runtime.lastError = undefined;
}

export function chromeStorageSnapshot(): Map<string, unknown> {
  return new Map(local.data);
}

export function chromeSessionSnapshot(): Map<string, unknown> {
  return new Map(session.data);
}
```

中间的 `matchMedia`、`ResizeObserver` 两段和 `Object.defineProperty(globalThis, 'chrome', …)` 那一行保持不变。

Run: `pnpm test`
Expected: 和改之前一样全部通过（`Tests  304 passed`）——这一步只是重排，没有改变任何行为。

- [ ] **Step 2：写失败的测试**

新建 `tests/unit/return-state.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RETURN_STATE_KEY } from '@/core/constants';
import { currentEntryKey } from '@/hosts/x/historyEntry';
import { rememberReturn, takeReturn, type ReturnState } from '@/hosts/x/ReturnState';
import { chromeSessionSnapshot, chromeStorageSnapshot, resetChromeStub } from '../setup';

const state = (overrides: Partial<ReturnState> = {}): ReturnState => ({
  folderId: 'f1',
  anchorId: '1000000000000000001',
  offset: 40,
  count: 50,
  at: 1_000,
  ...overrides,
});

describe('return state', () => {
  beforeEach(() => {
    resetChromeStub();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('comes back once, for the history entry it was written under', async () => {
    await rememberReturn('entry-a', state());
    expect(await takeReturn('entry-b')).toBeNull();
    expect(await takeReturn('entry-a')).toEqual(state());
    expect(await takeReturn('entry-a')).toBeNull();
  });

  it('lives in session storage only', async () => {
    await rememberReturn('entry-a', state());
    expect(chromeSessionSnapshot().has(RETURN_STATE_KEY)).toBe(true);
    expect(chromeStorageSnapshot().size).toBe(0);
  });

  it('keeps the newest twenty entries', async () => {
    for (let i = 0; i < 25; i += 1) await rememberReturn(`entry-${i}`, state({ at: i }));
    expect(await takeReturn('entry-4')).toBeNull();
    expect(await takeReturn('entry-5')).toEqual(state({ at: 5 }));
    expect(await takeReturn('entry-24')).toEqual(state({ at: 24 }));
  });

  it('drops anything stored that is not a return state', async () => {
    await chrome.storage.session.set({
      [RETURN_STATE_KEY]: { bad: { folderId: 7 }, good: state() },
    });
    expect(await takeReturn('bad')).toBeNull();
    expect(await takeReturn('good')).toEqual(state());
  });

  it('turns a storage failure into "nothing remembered"', async () => {
    vi.spyOn(chrome.storage.session, 'get').mockImplementation((() =>
      Promise.reject(new Error('Access to storage is not allowed from this context.'))) as never);
    await expect(rememberReturn('entry-a', state())).resolves.toBeUndefined();
    await expect(takeReturn('entry-a')).resolves.toBeNull();
  });
});

describe('currentEntryKey', () => {
  it('reads the key of the history entry the page is on', () => {
    const fake = { navigation: { currentEntry: { key: 'k-1' } } } as unknown as Window;
    expect(currentEntryKey(fake)).toBe('k-1');
  });

  it('is null where the Navigation API or the entry is missing', () => {
    expect(currentEntryKey({} as unknown as Window)).toBeNull();
    expect(currentEntryKey({ navigation: { currentEntry: null } } as unknown as Window)).toBeNull();
    // jsdom has no Navigation API.
    expect(currentEntryKey(window)).toBeNull();
  });
});
```

新建 `tests/unit/session-access.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { openSessionStorageToContentScripts } from '@/background/sessionStorage';

describe('session storage access', () => {
  it('opens session storage to the extension’s content scripts', () => {
    const setAccessLevel = vi.mocked(chrome.storage.session.setAccessLevel);
    setAccessLevel.mockClear();
    openSessionStorageToContentScripts();
    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
  });

  it('does not throw when the browser refuses', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(chrome.storage.session.setAccessLevel).mockImplementationOnce((() =>
      Promise.reject(new Error('refused'))) as never);
    expect(() => openSessionStorageToContentScripts()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 3：运行，确认失败**

Run: `pnpm vitest run tests/unit/return-state.test.ts tests/unit/session-access.test.ts`
Expected: FAIL，报找不到 `@/hosts/x/historyEntry`、`@/hosts/x/ReturnState`、`@/background/sessionStorage`。

- [ ] **Step 4：写实现**

`src/core/constants.ts`：在 `READING_MODE_KEY` 后面加上：

```ts
/** `chrome.storage.session` key: where each history entry's folder list was left. */
export const RETURN_STATE_KEY = 'xf:return';
```

新建 `src/hosts/x/historyEntry.ts`：

```ts
interface EntryLike {
  key?: unknown;
}

interface NavigationLike {
  currentEntry?: EntryLike | null;
}

/**
 * A stable id for the history entry the page is on (Navigation API). It stays
 * the same across reloads and full page loads, and is what the browser comes
 * back to on "back" — measured in a content script on 2026-10-01. Null where
 * the API is missing; the list then simply does not come back by itself.
 */
export function currentEntryKey(win: Window = window): string | null {
  const navigation = (win as unknown as { navigation?: NavigationLike }).navigation;
  const key = navigation?.currentEntry?.key;
  return typeof key === 'string' && key.length > 0 ? key : null;
}
```

新建 `src/hosts/x/ReturnState.ts`：

```ts
import { RETURN_STATE_KEY } from '@/core/constants';
import { createLogger } from '@/utils/logger';

const log = createLogger('return-state');

/** Entries kept at most; the oldest go first. One is written per post opened from a list. */
const MAX_ENTRIES = 20;

/** Where a folder list was when the reader left it for a post (work order 3.4). */
export interface ReturnState {
  folderId: string;
  /** The post at the top of the list; null when the list was empty. */
  anchorId: string | null;
  /** How far that post's top edge had scrolled above the list's, in px. */
  offset: number;
  /** Rows loaded at the time: the restore loads no further than a page past this. */
  count: number;
  /** When it was written. */
  at: number;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isReturnState(value: unknown): value is ReturnState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.folderId === 'string' &&
    state.folderId.length > 0 &&
    (state.anchorId === null || typeof state.anchorId === 'string') &&
    typeof state.offset === 'number' &&
    Number.isFinite(state.offset) &&
    isCount(state.count) &&
    isCount(state.at)
  );
}

async function readAll(): Promise<Record<string, ReturnState>> {
  const stored: unknown = (await chrome.storage.session.get(RETURN_STATE_KEY))[RETURN_STATE_KEY];
  const out: Record<string, ReturnState> = {};
  if (typeof stored !== 'object' || stored === null) return out;
  for (const [key, value] of Object.entries(stored)) {
    if (isReturnState(value)) out[key] = value;
  }
  return out;
}

/**
 * Remembers where the list was, under the history entry being left.
 *
 * `chrome.storage.session` on purpose: it lives in memory and ends with the
 * browser session, it survives the full page load a navigation may turn into,
 * and — unlike the page's own sessionStorage — x.com's scripts cannot read it.
 * Read-modify-write without a lock: two tabs would have to open a post in the
 * same instant to lose an entry, and the cost is one list not coming back.
 */
export async function rememberReturn(entryKey: string, state: ReturnState): Promise<void> {
  try {
    const all = await readAll();
    all[entryKey] = state;
    const newest = Object.entries(all)
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, MAX_ENTRIES);
    await chrome.storage.session.set({ [RETURN_STATE_KEY]: Object.fromEntries(newest) });
  } catch (error) {
    log.debug('could not remember the list position', error);
  }
}

/** What was remembered for this history entry. Removed as it is read: a list comes back once. */
export async function takeReturn(entryKey: string): Promise<ReturnState | null> {
  try {
    const all = await readAll();
    const state = all[entryKey];
    if (state === undefined) return null;
    const rest = Object.fromEntries(Object.entries(all).filter(([key]) => key !== entryKey));
    await chrome.storage.session.set({ [RETURN_STATE_KEY]: rest });
    return state;
  } catch (error) {
    log.debug('could not read the list position', error);
    return null;
  }
}
```

新建 `src/background/sessionStorage.ts`：

```ts
import { createLogger } from '@/utils/logger';

const log = createLogger('session-storage');

/**
 * `chrome.storage.session` is closed to content scripts until the extension
 * opens it ("Access to storage is not allowed from this context."). The page
 * overlay keeps its return-to-list position there (see ReturnState). The
 * setting is remembered by the browser; calling it at every start is harmless.
 */
export function openSessionStorageToContentScripts(): void {
  chrome.storage.session
    .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
    .catch((error: unknown) => log.warn('setAccessLevel failed', error));
}
```

把 `src/entrypoints/background.ts` 整个替换为：

```ts
import { createHandlers } from '@/background/rpc/handlers';
import { registerRpcServer } from '@/background/rpc/RpcServer';
import { openSessionStorageToContentScripts } from '@/background/sessionStorage';
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
    openSessionStorageToContentScripts();

    // Deliberately after the listeners and deliberately not awaited: the log
    // level is not worth delaying message registration for.
    void applyStoredLogLevel();
  },
});
```

- [ ] **Step 5：运行，确认通过**

Run: `pnpm vitest run tests/unit/return-state.test.ts tests/unit/session-access.test.ts`
Expected: PASS，`Tests  9 passed`。

- [ ] **Step 6：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全部成功；`Tests  313 passed`（304 + 9）。

```bash
git add src/core/constants.ts tests/setup.ts src/hosts/x/historyEntry.ts src/hosts/x/ReturnState.ts src/background/sessionStorage.ts src/entrypoints/background.ts tests/unit/return-state.test.ts tests/unit/session-access.test.ts
git commit -m "返回位置按历史条目记在会话存储里，后台把会话存储开放给内容脚本"
git push origin main
```

---

### Task 5：列表位置的读取与还原

**Files:**
- Create: `src/ui/folder-view/viewPosition.ts`
- Modify: `src/ui/folder-view/FolderViewApp.tsx`
- Test: `tests/unit/view-position.test.ts`
- Test: `tests/unit/folder-view-restore.test.tsx`

位置记成「列表最上面还看得见的那条帖子 + 它已经滚出去多少像素 + 当时加载了多少条」，而不是一个像素数。还原时先加载到那条帖子出现，再把它放回原处；找不到（它被移除了）就最多比原来多加载一页，然后停在顶部。

- [ ] **Step 1：写位置读取 / 还原的失败测试**

新建 `tests/unit/view-position.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { applyViewPosition, readViewPosition } from '@/ui/folder-view/viewPosition';

/** jsdom lays nothing out, so each element is given the rectangle a browser would report. */
function place(element: HTMLElement, top: number, height: number): void {
  element.getBoundingClientRect = (): DOMRect => ({
    x: 0,
    y: top,
    left: 0,
    top,
    width: 600,
    height,
    right: 600,
    bottom: top + height,
    toJSON: () => ({}),
  });
}

/** A 300px-tall list at y=100 holding 200px rows, already scrolled by `scrolled` px. */
function listOf(ids: string[], scrolled: number): HTMLElement {
  const list = document.createElement('div');
  place(list, 100, 300);
  ids.forEach((id, index) => {
    const row = document.createElement('div');
    row.setAttribute('data-xf-tweet-id', id);
    place(row, 100 + index * 200 - scrolled, 200);
    list.appendChild(row);
  });
  list.scrollTop = scrolled;
  document.body.appendChild(list);
  return list;
}

describe('view position', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads the first post still in view and how far it has scrolled off', () => {
    expect(readViewPosition(listOf(['1', '2', '3'], 0))).toEqual({ anchorId: '1', offset: 0, count: 3 });
    expect(readViewPosition(listOf(['1', '2', '3'], 250))).toEqual({ anchorId: '2', offset: 50, count: 3 });
    // Exactly on a row boundary: the row above is out of view.
    expect(readViewPosition(listOf(['1', '2', '3'], 200))).toEqual({ anchorId: '2', offset: 0, count: 3 });
  });

  it('reads an empty list as its top', () => {
    expect(readViewPosition(listOf([], 0))).toEqual({ anchorId: null, offset: 0, count: 0 });
  });

  it('scrolls the anchor post back to where it was', () => {
    const list = listOf(['1', '2', '3'], 0);
    expect(applyViewPosition(list, { anchorId: '2', offset: 50, count: 3 })).toBe(true);
    expect(list.scrollTop).toBe(250);
  });

  it('holds its place when a post was saved above it meanwhile', () => {
    const list = listOf(['new', '1', '2', '3'], 0);
    applyViewPosition(list, { anchorId: '2', offset: 50, count: 3 });
    expect(list.scrollTop).toBe(450);
  });

  it('reports a post that is not loaded yet, and leaves the list alone', () => {
    const list = listOf(['1', '2'], 0);
    expect(applyViewPosition(list, { anchorId: '9', offset: 0, count: 60 })).toBe(false);
    expect(list.scrollTop).toBe(0);
  });

  it('goes to the top of a post that is now shorter than the old offset', () => {
    const list = listOf(['1', '2', '3'], 0);
    applyViewPosition(list, { anchorId: '2', offset: 900, count: 3 });
    expect(list.scrollTop).toBe(200);
  });

  it('has nowhere to go in a list that was empty', () => {
    expect(applyViewPosition(listOf(['1'], 0), { anchorId: null, offset: 0, count: 0 })).toBe(true);
  });
});
```

- [ ] **Step 2：运行，确认失败**

Run: `pnpm vitest run tests/unit/view-position.test.ts`
Expected: FAIL，报找不到 `@/ui/folder-view/viewPosition`。

- [ ] **Step 3：写实现**

新建 `src/ui/folder-view/viewPosition.ts`：

```ts
import type { TweetId } from '@/core/domain/tweet';
import { XF_ATTR } from '@/hosts/x/selectors';

/**
 * Where a reader is in a folder list, in terms that survive a reload: the post
 * at the top rather than a pixel count, so a post saved or removed in the
 * meantime — or a long post that is folded again — does not shift the place.
 */
export interface ViewPosition {
  /** The first post still in view; null in an empty list. */
  anchorId: TweetId | null;
  /** How far that post's top edge has scrolled above the list's top edge, in px. */
  offset: number;
  /** Rows loaded. */
  count: number;
}

export const TOP_OF_LIST: ViewPosition = { anchorId: null, offset: 0, count: 0 };

function rowsOf(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>(`[${XF_ATTR.tweetId}]`));
}

export function readViewPosition(list: HTMLElement): ViewPosition {
  const rows = rowsOf(list);
  const top = list.getBoundingClientRect().top;
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom > top) {
      return {
        anchorId: row.getAttribute(XF_ATTR.tweetId),
        offset: Math.round(top - rect.top),
        count: rows.length,
      };
    }
  }
  return { anchorId: null, offset: 0, count: rows.length };
}

/**
 * Scrolls `list` so the anchor post sits where it was. False while that post is
 * not among the loaded rows.
 */
export function applyViewPosition(list: HTMLElement, position: ViewPosition): boolean {
  if (position.anchorId === null) return true;
  const row = rowsOf(list).find(
    (candidate) => candidate.getAttribute(XF_ATTR.tweetId) === position.anchorId,
  );
  if (row === undefined) return false;
  const rect = row.getBoundingClientRect();
  // A post that was unfolded then and is folded now can be shorter than the
  // old offset; its top is the closest thing to "where it was".
  const offset = position.offset < rect.height ? position.offset : 0;
  list.scrollTop += Math.round(rect.top - list.getBoundingClientRect().top + offset);
  return true;
}
```

- [ ] **Step 4：运行，确认通过**

Run: `pnpm vitest run tests/unit/view-position.test.ts`
Expected: PASS，`Tests  7 passed`。

- [ ] **Step 5：写收藏列表「交出位置 / 按位置恢复」的失败测试**

新建 `tests/unit/folder-view-restore.test.tsx`：

```tsx
import { options, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedTweetView } from '@/core/domain/membership';
import type { ListFolderTweetsPayload } from '@/messaging/protocol';
import { FolderStore } from '@/state/FolderStore';
import { FolderViewApp, type FolderViewAppProps } from '@/ui/folder-view/FolderViewApp';
import type { ViewPosition } from '@/ui/folder-view/viewPosition';
import { tweetFixture } from '../helpers/db';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn<(method: string, payload: unknown) => Promise<unknown>>(),
}));
vi.mock('@/messaging/RpcClient', () => ({ rpc: rpcMock, rpcOrNull: vi.fn() }));

options.requestAnimationFrame = (callback: () => void): void => callback();

const ROW_HEIGHT = 200;
/** A folder whose first page never arrives. */
const SLOW_FOLDER = 'slow';
const idOf = (index: number): string => String(1_000_000_000_000_000_000n + BigInt(index));

let records: SavedTweetView[] = [];
let requests: ListFolderTweetsPayload[] = [];
let container: HTMLElement;
let store: FolderStore;
let undoLayout: () => void;

function seed(count: number): void {
  records = Array.from({ length: count }, (_unused, index) => ({
    savedAt: 1_700_000_000_000 - index * 1000,
    tweet: tweetFixture(idOf(index)),
  }));
}

/** Keyset paging over the fake store, exactly as the background does it. */
function page(payload: ListFolderTweetsPayload): unknown {
  const cursor = payload.cursor;
  const start =
    cursor === undefined
      ? 0
      : records.findIndex((record) => record.tweet.tweetId === cursor.tweetId) + 1;
  const items = records.slice(start, start + payload.limit);
  const last = items.at(-1);
  const exhausted = last === undefined || start + items.length >= records.length;
  return {
    ok: true,
    data: {
      items,
      nextCursor:
        exhausted || last === undefined
          ? null
          : { savedAt: last.savedAt, tweetId: last.tweet.tweetId },
    },
  };
}

/**
 * jsdom lays nothing out. Here every row is 200px tall and the list's top edge
 * is at y=0, so a row's rectangle follows from its index and the scroll offset.
 */
function fakeLayout(): () => void {
  const proto = HTMLElement.prototype as { getBoundingClientRect?: () => DOMRect };
  proto.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    const list = this.closest<HTMLElement>('.xf-fv-list');
    let top = 0;
    let height = 0;
    if (list !== null && this !== list && this.hasAttribute('data-xf-tweet-id')) {
      const index = Array.from(list.querySelectorAll('[data-xf-tweet-id]')).indexOf(this);
      top = index * ROW_HEIGHT - list.scrollTop;
      height = ROW_HEIGHT;
    }
    return { x: 0, y: top, left: 0, top, width: 600, height, right: 600, bottom: top + height, toJSON: () => ({}) };
  };
  return () => {
    delete proto.getBoundingClientRect;
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function list(): HTMLElement {
  const found = container.querySelector<HTMLElement>('.xf-fv-list');
  if (found === null) throw new Error('list not rendered');
  return found;
}

function show(
  folderId: string,
  extra: { restore?: ViewPosition; onOpenPost?: FolderViewAppProps['onOpenPost'] } = {},
): void {
  render(
    <FolderViewApp
      store={store}
      folderId={folderId}
      onClose={() => {}}
      onMembershipChanged={() => {}}
      onOpenPost={extra.onOpenPost ?? (() => {})}
      restore={extra.restore}
    />,
    container,
  );
}

describe('folder view: position', () => {
  beforeEach(() => {
    requests = [];
    store = new FolderStore();
    rpcMock.mockReset().mockImplementation(async (method, payload) => {
      if (method !== 'memberships.listFolderTweets') {
        return { ok: false, error: { code: 'UNKNOWN', message: 'unexpected call' } };
      }
      const request = payload as ListFolderTweetsPayload;
      requests.push(request);
      if (request.folderId === SLOW_FOLDER) return new Promise(() => {});
      return page(request);
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    undoLayout = fakeLayout();
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    undoLayout();
  });

  it('tells whoever opens a post where the list is', async () => {
    seed(10);
    const onOpenPost = vi.fn<FolderViewAppProps['onOpenPost']>();
    show('f1', { onOpenPost });
    await settle();

    list().scrollTop = 450;
    container.querySelectorAll<HTMLElement>('.xf-tc-name')[3]?.click();
    expect(onOpenPost).toHaveBeenCalledExactlyOnceWith(
      `https://x.com/alice/status/${idOf(3)}`,
      { newTab: false },
      { anchorId: idOf(2), offset: 50, count: 10 },
    );
  });

  it('comes back to the post that was at the top, loading as many pages as it takes', async () => {
    seed(120);
    show('f1', { restore: { anchorId: idOf(70), offset: 30, count: 100 } });
    await settle();

    expect(requests).toHaveLength(2);
    expect(list().scrollTop).toBe(70 * ROW_HEIGHT + 30);
  });

  it('gives up a page past what was loaded when the post is gone', async () => {
    seed(300);
    show('f1', { restore: { anchorId: '999', offset: 0, count: 60 } });
    await settle();

    // 50 and 100 rows are short of 60 + one page; 150 is not.
    expect(requests).toHaveLength(3);
    expect(list().scrollTop).toBe(0);
  });

  it('restores nothing once the reader has switched folders', async () => {
    seed(10);
    show(SLOW_FOLDER, { restore: { anchorId: idOf(3), offset: 30, count: 10 } });
    await settle();
    show('f2');
    await settle();

    expect(requests.map((request) => request.folderId)).toEqual([SLOW_FOLDER, 'f2']);
    expect(container.querySelectorAll('[data-xf-tweet-id]')).toHaveLength(10);
    expect(list().scrollTop).toBe(0);
  });
});
```

- [ ] **Step 6：运行，确认失败**

Run: `pnpm vitest run tests/unit/folder-view-restore.test.tsx`
Expected: FAIL：第一个用例收到的只有两个参数；第二、三个用例只请求了 1 页、`scrollTop` 是 0。（`pnpm typecheck` 此时会报 `restore` 不在 `FolderViewAppProps` 里。）

- [ ] **Step 7：收藏列表交出位置、按位置恢复**

`src/ui/folder-view/FolderViewApp.tsx`，六处：

① import 区，在 `import { SavedTweetCard } from './SavedTweetCard';` 后面加：

```ts
import { applyViewPosition, readViewPosition, TOP_OF_LIST, type ViewPosition } from './viewPosition';
```

② `FolderViewAppProps` 里，把

```ts
  /** Opens a post from a card: the page navigates itself, the side panel asks the X tab. */
  onOpenPost: (url: string, options: OpenOptions) => void;
}
```

改成

```ts
  /**
   * Opens a post from a card: the page navigates itself, the side panel asks
   * the X tab. `position` is where the list is right now, so the page can put
   * it back when the reader returns.
   */
  onOpenPost: (url: string, options: OpenOptions, position: ViewPosition) => void;
  /** Where to put the list once it has loaded: the page overlay coming back after "back". */
  restore?: ViewPosition;
}
```

③ 在 `const generation = useRef(0);` 后面加：

```ts
  /** Used once, and only for the folder the view was opened with. */
  const restoreRef = useRef(
    props.restore === undefined ? null : { folderId: props.folderId, position: props.restore },
  );
```

④ 在 `onScroll` 的定义后面加：

```ts
  // Coming back from a post: load until the post that was at the top is here,
  // then put it back. Loading stops a page past what was loaded before — a post
  // removed in the meantime must not drag the whole folder in.
  useEffect(() => {
    const pending = restoreRef.current;
    const list = listRef.current;
    if (pending === null || list === null || status !== 'ready') return;
    const gaveUp =
      pending.folderId !== props.folderId ||
      exhausted ||
      moreError !== null ||
      items.length >= pending.position.count + FOLDER_TWEETS_PAGE_SIZE;
    if (pending.folderId === props.folderId && applyViewPosition(list, pending.position)) {
      restoreRef.current = null;
      return;
    }
    if (gaveUp) {
      restoreRef.current = null;
      return;
    }
    void loadPage(false);
  }, [exhausted, items, loadPage, moreError, props.folderId, status]);
```

⑤ 在 `remove` 的定义后面（`const now = Date.now();` 之前）加：

```ts
  const openPost = (url: string, options: OpenOptions): void => {
    const list = listRef.current;
    props.onOpenPost(url, options, list === null ? TOP_OF_LIST : readViewPosition(list));
  };
```

⑥ 把 `<SavedTweetCard … />` 里的 `onOpen={props.onOpenPost}` 改成 `onOpen={openPost}`；把「⋯」菜单 `onSelect` 里的

```ts
            if (action === 'open') props.onOpenPost(menuTarget.tweet.canonicalUrl, { newTab: true });
```

改成

```ts
            if (action === 'open') openPost(menuTarget.tweet.canonicalUrl, { newTab: true });
```

- [ ] **Step 8：运行，确认通过**

Run: `pnpm vitest run tests/unit/folder-view-restore.test.tsx tests/unit/folder-view.test.tsx tests/unit/side-panel-app.test.tsx`
Expected: PASS（后两个文件是回归：收藏列表原有行为、侧边栏点卡片都不变）。

- [ ] **Step 9：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全部成功；`Tests  324 passed`（313 + 11）。

```bash
git add src/ui/folder-view/viewPosition.ts src/ui/folder-view/FolderViewApp.tsx tests/unit/view-position.test.ts tests/unit/folder-view-restore.test.tsx
git commit -m "收藏列表：点卡片时交出当前位置，打开时可按位置恢复"
git push origin main
```

---

### Task 6：看完原帖按「返回」，收藏列表回到原处

**Files:**
- Modify: `src/hosts/x/FolderViewMount.tsx`
- Modify: `src/hosts/x/XRuntime.ts`
- Test: `tests/unit/return-restore.test.ts`
- Test: `tests/unit/folder-view.test.tsx`（修改）

流程：点卡片（不是新标签页）→ 离开前把「文件夹 + 位置」记在当前历史条目名下 → 换到原帖。之后每次地址变化、以及内容脚本每次启动，都看一眼「现在这个历史条目名下有没有记录」：有就取出来、打开那个文件夹并恢复位置。通过 X 自己的链接离开时什么都没记，所以返回也不会恢复。

- [ ] **Step 1：写失败的测试**

新建 `tests/unit/return-restore.test.ts`：

```ts
import { options } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RETURN_STATE_KEY } from '@/core/constants';
import type { FolderWithCount } from '@/core/domain/folder';
import type { SavedTweetView } from '@/core/domain/membership';
import { XF_ATTR } from '@/hosts/x/selectors';
import { shadowRootOf } from '@/ui/shared/ShadowHost';
import { tweetFixture } from '../helpers/db';
import { loadFixture } from '../helpers/fixtures';
import { chromeSessionSnapshot, resetChromeStub } from '../setup';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn<(method: string, payload: unknown) => Promise<unknown>>(),
}));
vi.mock('@/messaging/RpcClient', () => ({ rpc: rpcMock, rpcOrNull: vi.fn(async () => null) }));

import { XRuntime } from '@/hosts/x/XRuntime';

options.requestAnimationFrame = (callback: () => void): void => callback();

const FOLDER: FolderWithCount = {
  id: 'f1',
  name: 'AI',
  parentId: null,
  position: 1000,
  collapsed: false,
  createdAt: 1,
  updatedAt: 1,
  tweetCount: 2,
};
const SAVED: SavedTweetView[] = ['1000000000000000001', '1000000000000000002'].map((id, index) => ({
  savedAt: 2_000 - index,
  tweet: tweetFixture(id),
}));
const FIRST_POST_PATH = '/alice/status/1000000000000000001';
const HOME_ENTRY = 'entry:/home';

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Lets storage, RPC replies and Preact effects run their course. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await pause(0);
}

/** jsdom delivers the popstate of history.back() on a later task. */
async function goBack(): Promise<void> {
  history.back();
  await pause(30);
  await settle();
}

/**
 * jsdom has no Navigation API. One history entry per address is all these
 * tests need, so the address stands in for the entry's key.
 */
function stubNavigation(): void {
  Object.defineProperty(window, 'navigation', {
    configurable: true,
    value: {
      get currentEntry() {
        return { key: `entry:${location.pathname}` };
      },
    },
  });
}

function overlay(): ShadowRoot | null {
  return shadowRootOf(document.querySelector<HTMLElement>(`[${XF_ATTR.overlayHost}]`));
}

function clickFolderInTree(): void {
  const tree = shadowRootOf(document.querySelector<HTMLElement>(`[${XF_ATTR.sidebarHost}]`));
  const button = Array.from(tree?.querySelectorAll('button') ?? []).find(
    (candidate) => candidate.textContent === 'AI',
  );
  if (button === undefined) throw new Error('folder not in the tree');
  button.click();
}

describe('returning to a folder list', () => {
  let runtime: XRuntime | undefined;

  async function start(): Promise<void> {
    runtime = new XRuntime();
    runtime.start();
    await settle();
  }

  beforeEach(() => {
    resetChromeStub();
    loadFixture('x-home');
    history.pushState({}, '', '/home');
    stubNavigation();
    rpcMock.mockReset().mockImplementation(async (method) => {
      switch (method) {
        case 'folders.list':
          return { ok: true, data: { folders: [FOLDER], recentFolderIds: [] } };
        case 'memberships.listFolderTweets':
          return { ok: true, data: { items: SAVED, nextCursor: null } };
        default:
          return { ok: true, data: {} };
      }
    });
  });

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
    delete (window as unknown as { navigation?: unknown }).navigation;
    history.pushState({}, '', '/home');
  });

  it('remembers the list when a card is opened and brings it back on "back", once', async () => {
    await start();
    clickFolderInTree();
    await settle();
    expect(overlay()?.querySelectorAll('.xf-fv-row')).toHaveLength(2);

    overlay()?.querySelector<HTMLElement>('.xf-tc-name')?.click();
    await settle();
    expect(location.pathname).toBe(FIRST_POST_PATH);
    expect(overlay()).toBeNull();
    const remembered = chromeSessionSnapshot().get(RETURN_STATE_KEY) as
      | Record<string, { folderId: string }>
      | undefined;
    expect(remembered?.[HOME_ENTRY]?.folderId).toBe('f1');

    await goBack();
    expect(location.pathname).toBe('/home');
    expect(overlay()?.querySelector('.xf-fv-name')?.textContent).toBe('AI');
    expect(overlay()?.querySelectorAll('.xf-fv-row')).toHaveLength(2);

    // Once: the entry is used up, so forward-and-back does not repeat it.
    history.forward();
    await pause(30);
    await settle();
    expect(overlay()).toBeNull();
    await goBack();
    expect(overlay()).toBeNull();
  });

  it('comes back after a full page load, in a brand-new content script', async () => {
    await chrome.storage.session.set({
      [RETURN_STATE_KEY]: { [HOME_ENTRY]: { folderId: 'f1', anchorId: null, offset: 0, count: 2, at: 1 } },
    });
    await start();
    expect(overlay()?.querySelector('.xf-fv-name')?.textContent).toBe('AI');
    expect(chromeSessionSnapshot().get(RETURN_STATE_KEY)).toEqual({});
  });

  it('does not bring the list back after leaving through one of X’s own links', async () => {
    await start();
    clickFolderInTree();
    await settle();
    expect(overlay()).not.toBeNull();

    // X's router: the address changes without a card having been opened.
    history.pushState({}, '', '/notifications');
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    await settle();
    expect(overlay()).toBeNull();

    await goBack();
    expect(location.pathname).toBe('/home');
    expect(overlay()).toBeNull();
  });
});
```

`tests/unit/folder-view.test.tsx`：

把第一行关于 `FolderViewMount` 的 import 改成：

```ts
import { FolderViewMount, type LeftForPost } from '@/hosts/x/FolderViewMount';
```

变量声明里 `let navigations: string[] = [];` 后面加：

```ts
let departures: LeftForPost[] = [];
```

`beforeEach` 里 `navigations = [];` 后面加 `departures = [];`，并在构造 `FolderViewMount` 的参数里、`navigate` 之前加：

```ts
      onLeaveForPost: (left) => {
        departures.push(left);
      },
```

在 `it('just closes when the page is already showing that post', …)` 里，`expect(mount.isOpen()).toBe(false);` 后面加一行：

```ts
      expect(departures).toEqual([]);
```

在它后面再加一个用例：

```ts
  it('reports the folder and the list position just before leaving for a post', async () => {
    seed(2);
    await store.refresh();
    await open();
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const name = rows()[0]?.querySelector<HTMLElement>('.xf-tc-name');

    // A new tab leaves nothing behind: this tab stays where it is.
    name?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    expect(departures).toEqual([]);

    name?.click();
    // jsdom lays nothing out, so no row counts as "in view"; see view-position.test.ts.
    expect(departures).toEqual([
      { folderId: FOLDER_ID, position: { anchorId: null, offset: 0, count: 2 } },
    ]);
    expect(navigations).toHaveLength(1);
    opened.mockRestore();
  });
```

- [ ] **Step 2：运行，确认失败**

Run: `pnpm vitest run tests/unit/return-restore.test.ts tests/unit/folder-view.test.tsx`
Expected: FAIL：`return-restore` 的前两个用例里列表没有回来（第三个现在就能过，它守住的是「不该恢复的时候不恢复」）；`folder-view` 的新用例里 `departures` 是空的。

- [ ] **Step 3：收藏列表离开前上报位置，打开时可带位置**

`src/hosts/x/FolderViewMount.tsx`，五处：

① import 区加一行：

```ts
import type { ViewPosition } from '@/ui/folder-view/viewPosition';
```

② 在 `export interface FolderViewDeps {` 前面加：

```ts
/** A list being left for a post: enough to bring it back when the reader returns. */
export interface LeftForPost {
  folderId: string;
  position: ViewPosition;
}
```

并在 `FolderViewDeps` 里、`navigate?` 之前加：

```ts
  /** Called just before this tab leaves the list for a post (never for a new tab). */
  onLeaveForPost: (left: LeftForPost) => void;
```

③ 把 `open` 方法替换为：

```ts
  /**
   * `restore` puts the list back where the reader left it. It only counts when
   * the view is not open yet: an open list is already where the reader put it.
   */
  open(folderId: string, restore?: ViewPosition): void {
    this.#folderId = folderId;
    // Keeps the sidebar's highlighted row and the open view in agreement, no
    // matter which of the two initiated the change.
    this.deps.store.setActiveFolder(folderId);
    if (this.#handle === null) this.#handle = this.#createHost();
    this.#render(folderId, restore);
    this.ensure();
    log.debug('opened', folderId);
  }
```

④ 把 `#render` 方法替换为：

```tsx
  #render(folderId: string, restore?: ViewPosition): void {
    const handle = this.#handle;
    if (handle === null) return;
    render(
      <FolderViewApp
        store={this.deps.store}
        folderId={folderId}
        restore={restore}
        onClose={() => this.close()}
        onMembershipChanged={this.deps.onMembershipChanged}
        onOpenInSidePanel={() => this.#openInSidePanel()}
        onOpenPost={(url, options, position) => this.#openPost(url, options, position)}
      />,
      handle.mount,
    );
  }
```

⑤ 把 `#openPost` 方法替换为：

```ts
  /**
   * A click on a card: X switches to the post in place, as it does for its own
   * links, and the route change closes this view. ⌘/Ctrl-click opens a new tab
   * instead. Only x.com permalinks are followed.
   */
  #openPost(url: string, options: OpenOptions, position: ViewPosition): void {
    if (!isSafeXUrl(url)) return;
    if (options.newTab) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    const post = parseStatusUrl(url);
    // Already on that post's page: the list only has to get out of the way.
    if (post !== null && onPostPage(post.tweetId)) {
      this.close();
      return;
    }
    const folderId = this.#folderId;
    if (folderId !== null) this.deps.onLeaveForPost({ folderId, position });
    if (this.deps.navigate !== undefined) this.deps.navigate(url);
    else navigateInPage(url, { registry: this.deps.registry });
  }
```

- [ ] **Step 4：内容脚本记下位置，返回时恢复**

`src/hosts/x/XRuntime.ts`，四处：

① import 区：在 `import { HealthMonitor } from './HealthMonitor';` 后面加

```ts
import { currentEntryKey } from './historyEntry';
```

在 `import { RouteObserver } from './RouteObserver';` 前面加

```ts
import { rememberReturn, takeReturn } from './ReturnState';
```

② 构造函数里，把创建 `FolderViewMount` 和 `RouteObserver` 的两段替换为：

```ts
    this.#folderView = new FolderViewMount({
      store: this.#store,
      theme: this.#theme,
      registry: this.#registry,
      onMembershipChanged: (tweetId, count) => this.#applyCount(tweetId, count),
      onLeaveForPost: ({ folderId, position }) => {
        // Read now, before the address changes: this is the history entry
        // "back" will return to.
        const key = currentEntryKey();
        if (key !== null) void rememberReturn(key, { folderId, ...position, at: Date.now() });
      },
    });

    this.#route = new RouteObserver({
      registry: this.#registry,
      onEnsure: () => void this.#reinitialize(),
      onRouteChange: () => {
        // Leaving the route the overlay was opened from closes it, but the
        // stores keep their data: a navigation is not a reason to refetch.
        this.#folderView.close();
        this.#popover.close();
        // Unless this is "back" to where a list was left for a post.
        void this.#restoreAfterReturn();
      },
    });
```

③ `start()` 里，在 `void this.#reinitialize();` 后面加一行：

```ts
    void this.#restoreAfterReturn();
```

④ 在 `#applyCount` 方法后面加：

```ts
  /**
   * Brings the folder list back when the browser returns to the history entry
   * it was left from (work order 2.3). Runs at start-up as well: opening the
   * post may have been a full page load, and then this is a brand-new content
   * script with nothing in memory.
   */
  async #restoreAfterReturn(): Promise<void> {
    const key = currentEntryKey();
    if (key === null) return;
    const state = await takeReturn(key);
    if (state === null || this.#registry.disposed) return;
    // Storage answered late and the reader has moved again, or a list is
    // already open: leave things as they are.
    if (currentEntryKey() !== key || this.#folderView.isOpen()) return;
    this.#folderView.open(state.folderId, {
      anchorId: state.anchorId,
      offset: state.offset,
      count: state.count,
    });
  }
```

- [ ] **Step 5：运行，确认通过**

Run: `pnpm vitest run tests/unit/return-restore.test.ts tests/unit/folder-view.test.tsx tests/unit/xruntime-scan.test.ts tests/unit/spa-resilience.test.ts`
Expected: PASS（后两个文件是回归：内容脚本的扫描和自愈不受影响）。

- [ ] **Step 6：全量检查（含端到端）并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e
```

Expected: 全部成功；单元测试 `Tests  328 passed`（324 + 4）；端到端 `13 passed`。

```bash
git add src/hosts/x/FolderViewMount.tsx src/hosts/x/XRuntime.ts tests/unit/return-restore.test.ts tests/unit/folder-view.test.tsx
git commit -m "看完原帖按返回，收藏列表回到原来的文件夹和位置"
git push origin main
```

---

### Task 7：侧边栏与 X 页面之间的交接消息

**Files:**
- Modify: `src/messaging/sidePanelProtocol.ts`
- Create: `src/hosts/x/PanelBridge.ts`
- Create: `src/sidepanel/activeTab.ts`
- Modify: `src/sidepanel/openPost.ts`
- Modify: `src/hosts/x/XRuntime.ts`
- Test: `tests/unit/panel-bridge.test.ts`
- Test: `tests/unit/active-tab.test.ts`

切换时「带上当前的文件夹」（工单 2.3）靠两条新消息，方向都是「侧边栏 → 旁边那个标签页的内容脚本」：

| 消息 | 什么时候发 | 内容脚本怎么答 |
|---|---|---|
| `xf:hand-over` | 侧边栏刚打开，**还没**把模式写成「侧边栏」时 | 回答页面覆盖层正在显示的文件夹（没开就是 `null`） |
| `xf:open-folder` | 侧边栏点了「切换到页面内」，**还没**把模式写回「页面内」时 | 在页面里打开这个文件夹的收藏列表 |

先问后切的原因：写模式这一步会关掉页面覆盖层（或关掉侧边栏自己），问晚了就问不到了。向「当前窗口的活动标签页」发消息不需要 `tabs` 权限，也读不到那个标签页的地址（工单 3.4）。

- [ ] **Step 1：写失败的测试**

新建 `tests/unit/panel-bridge.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listenForPanelRequests } from '@/hosts/x/PanelBridge';
import {
  HAND_OVER,
  OPEN_FOLDER,
  type HandOverResponse,
  type SimpleResponse,
} from '@/messaging/sidePanelProtocol';
import { CleanupRegistry } from '@/utils/cleanup';

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: HandOverResponse | SimpleResponse) => void,
) => boolean;

const FOLDER = '0b6f3c1e-7f55-4a57-9a43-0d2a5f1c9e10';

describe('requests from the side panel', () => {
  const openFolder = vi.fn<(folderId: string) => void>();
  let current: string | null;
  let registry: CleanupRegistry;
  let listener: Listener;

  beforeEach(() => {
    current = null;
    openFolder.mockReset();
    vi.mocked(chrome.runtime.onMessage.addListener).mockClear();
    vi.mocked(chrome.runtime.onMessage.removeListener).mockClear();
    registry = new CleanupRegistry();
    listenForPanelRequests(registry, { currentFolder: () => current, openFolder });
    listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0]?.[0] as unknown as Listener;
  });

  it('tells the panel which folder the overlay is showing', () => {
    const sendResponse = vi.fn();
    listener({ kind: HAND_OVER }, {}, sendResponse);
    expect(sendResponse).toHaveBeenLastCalledWith({ ok: true, folderId: null });

    current = FOLDER;
    listener({ kind: HAND_OVER }, {}, sendResponse);
    expect(sendResponse).toHaveBeenLastCalledWith({ ok: true, folderId: FOLDER });
  });

  it('opens the folder the panel hands back', () => {
    const sendResponse = vi.fn();
    listener({ kind: OPEN_FOLDER, folderId: FOLDER }, {}, sendResponse);
    expect(openFolder).toHaveBeenCalledExactlyOnceWith(FOLDER);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it('takes "no folder" as a switch with nothing to open', () => {
    const sendResponse = vi.fn();
    listener({ kind: OPEN_FOLDER, folderId: null }, {}, sendResponse);
    expect(openFolder).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it('does not answer a folder id that cannot be one', () => {
    for (const folderId of [7, '', 'x'.repeat(65), undefined]) {
      const sendResponse = vi.fn();
      expect(listener({ kind: OPEN_FOLDER, folderId }, {}, sendResponse)).toBe(false);
      expect(sendResponse).not.toHaveBeenCalled();
    }
    expect(openFolder).not.toHaveBeenCalled();
  });

  it('ignores other messages', () => {
    const sendResponse = vi.fn();
    expect(
      listener({ kind: 'xf:navigate', url: 'https://x.com/a/status/1' }, {}, sendResponse),
    ).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('stops listening when the content script is disposed', () => {
    registry.dispose();
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(listener);
  });
});
```

新建 `tests/unit/active-tab.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showFolderInPage, takeOverFolder } from '@/sidepanel/activeTab';

const FOLDER = '0b6f3c1e-7f55-4a57-9a43-0d2a5f1c9e10';

function setLastError(value: { message: string } | undefined): void {
  if (value === undefined) delete (chrome.runtime as { lastError?: { message: string } }).lastError;
  else (chrome.runtime as { lastError?: { message: string } }).lastError = value;
}

describe('talking to the tab beside the side panel', () => {
  const query = vi.fn<(info: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>>();
  const sendMessage =
    vi.fn<(tabId: number, message: unknown, callback: (response: unknown) => void) => void>();

  /** What Chrome does when the tab has no content script of ours. */
  const nobodyAnswers = (): void => {
    sendMessage.mockImplementation((_tabId, _message, callback) => {
      setLastError({ message: 'Could not establish connection. Receiving end does not exist.' });
      callback(undefined);
      setLastError(undefined);
    });
  };

  beforeEach(() => {
    query.mockReset().mockResolvedValue([{ id: 42 } as chrome.tabs.Tab]);
    sendMessage.mockReset();
    setLastError(undefined);
    Object.assign(chrome, { tabs: { query, sendMessage } });
  });

  it('takes over the folder the X tab is showing', async () => {
    sendMessage.mockImplementation((_tabId, _message, callback) =>
      callback({ ok: true, folderId: FOLDER }),
    );
    await expect(takeOverFolder()).resolves.toBe(FOLDER);
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(sendMessage).toHaveBeenCalledWith(42, { kind: 'xf:hand-over' }, expect.any(Function));
  });

  it('takes over nothing from a tab that is not X', async () => {
    nobodyAnswers();
    await expect(takeOverFolder()).resolves.toBeNull();
  });

  it('takes over nothing from an answer it cannot read', async () => {
    sendMessage.mockImplementation((_tabId, _message, callback) => callback({ ok: true, folderId: 7 }));
    await expect(takeOverFolder()).resolves.toBeNull();
  });

  it('takes over nothing when there is no tab to ask', async () => {
    query.mockResolvedValue([]);
    await expect(takeOverFolder()).resolves.toBeNull();
    query.mockRejectedValue(new Error('no window'));
    await expect(takeOverFolder()).resolves.toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('hands a folder to the X tab and reports that it was taken', async () => {
    sendMessage.mockImplementation((_tabId, _message, callback) => callback({ ok: true }));
    await expect(showFolderInPage(FOLDER)).resolves.toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(
      42,
      { kind: 'xf:open-folder', folderId: FOLDER },
      expect.any(Function),
    );
  });

  it('reports that nobody took the folder', async () => {
    nobodyAnswers();
    await expect(showFolderInPage(null)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2：运行，确认失败**

Run: `pnpm vitest run tests/unit/panel-bridge.test.ts tests/unit/active-tab.test.ts`
Expected: FAIL，报找不到 `@/hosts/x/PanelBridge`、`@/sidepanel/activeTab`。

- [ ] **Step 3：写协议和两端的实现**

把 `src/messaging/sidePanelProtocol.ts` 整个替换为：

```ts
/**
 * Messages that deliberately live outside the RPC table, because each has a
 * constraint the generic RPC path would hide:
 *  - opening the side panel must happen synchronously inside the background
 *    listener, while the user's click still counts as a gesture;
 *  - the other three go *to* a content script, which RPC never does: they are
 *    the side panel talking to the X tab beside it.
 */

export const OPEN_SIDE_PANEL = 'xf:open-side-panel';
export const NAVIGATE_TO_POST = 'xf:navigate';
export const HAND_OVER = 'xf:hand-over';
export const OPEN_FOLDER = 'xf:open-folder';

/** Folder ids are UUIDs, 36 characters; anything much longer is not one. */
const FOLDER_ID_MAX = 64;

export interface OpenSidePanelRequest {
  kind: typeof OPEN_SIDE_PANEL;
}

export interface NavigateRequest {
  kind: typeof NAVIGATE_TO_POST;
  url: string;
}

/** Side panel → X tab: "which folder is your overlay showing?" */
export interface HandOverRequest {
  kind: typeof HAND_OVER;
}

export interface HandOverResponse {
  ok: true;
  folderId: string | null;
}

/** Side panel → X tab: "show this folder in the page"; null when the panel had none open. */
export interface OpenFolderRequest {
  kind: typeof OPEN_FOLDER;
  folderId: string | null;
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

function isFolderId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= FOLDER_ID_MAX;
}

export function isOpenSidePanelRequest(value: unknown): value is OpenSidePanelRequest {
  return kindOf(value) === OPEN_SIDE_PANEL;
}

export function isNavigateRequest(value: unknown): value is NavigateRequest {
  return (
    kindOf(value) === NAVIGATE_TO_POST && typeof (value as { url?: unknown }).url === 'string'
  );
}

export function isHandOverRequest(value: unknown): value is HandOverRequest {
  return kindOf(value) === HAND_OVER;
}

export function isOpenFolderRequest(value: unknown): value is OpenFolderRequest {
  if (kindOf(value) !== OPEN_FOLDER) return false;
  const folderId = (value as { folderId?: unknown }).folderId;
  return folderId === null || isFolderId(folderId);
}

export function isSimpleResponse(value: unknown): value is SimpleResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  );
}

export function isHandOverResponse(value: unknown): value is HandOverResponse {
  if (typeof value !== 'object' || value === null) return false;
  const { ok, folderId } = value as { ok?: unknown; folderId?: unknown };
  return ok === true && (folderId === null || isFolderId(folderId));
}
```

新建 `src/hosts/x/PanelBridge.ts`：

```ts
import {
  isHandOverRequest,
  isOpenFolderRequest,
  type HandOverResponse,
  type SimpleResponse,
} from '@/messaging/sidePanelProtocol';
import type { CleanupRegistry } from '@/utils/cleanup';

export interface PanelRequestHandlers {
  /** The folder the page overlay is showing, or null when it is closed. */
  currentFolder: () => string | null;
  /** Shows a folder in the page overlay. */
  openFolder: (folderId: string) => void;
}

/**
 * The page's half of switching reading modes with the folder kept (work order
 * 2.3). The side panel asks the tab beside it:
 *  - on opening, "which folder are you showing?" — asked *before* the panel
 *    switches the mode, because the switch is what closes the overlay;
 *  - on switching back, "show this folder".
 * Only the extension's own pages can reach this listener. The folder id is
 * merely looked up in the store, and an unknown one closes the view again.
 */
export function listenForPanelRequests(
  registry: CleanupRegistry,
  handlers: PanelRequestHandlers,
): void {
  const listener = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: HandOverResponse | SimpleResponse) => void,
  ): boolean => {
    if (isHandOverRequest(message)) {
      sendResponse({ ok: true, folderId: handlers.currentFolder() });
      return false;
    }
    if (isOpenFolderRequest(message)) {
      if (message.folderId !== null) handlers.openFolder(message.folderId);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  registry.add(() => chrome.runtime.onMessage.removeListener(listener));
}
```

新建 `src/sidepanel/activeTab.ts`：

```ts
import {
  HAND_OVER,
  OPEN_FOLDER,
  isHandOverResponse,
  isSimpleResponse,
  type HandOverRequest,
  type OpenFolderRequest,
} from '@/messaging/sidePanelProtocol';

/**
 * Asks the content script of the tab beside the panel. Null when there is
 * nobody to answer: the active tab is not an X tab, or its content script is
 * from before an extension update.
 *
 * Messaging the active tab of the panel's own window needs no `tabs`
 * permission and never reveals which page that tab is on (work order 3.4).
 */
export async function askActiveTab(message: unknown): Promise<unknown> {
  let tabId: number | undefined;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  } catch {
    return null;
  }
  if (tabId === undefined) return null;
  const target = tabId;
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(target, message, (response: unknown) => {
        // Reading lastError is what marks "no content script there" as handled.
        if (chrome.runtime.lastError !== undefined) {
          resolve(null);
          return;
        }
        resolve(response ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** The folder the page overlay beside the panel is showing, if any. */
export async function takeOverFolder(): Promise<string | null> {
  const request: HandOverRequest = { kind: HAND_OVER };
  const response = await askActiveTab(request);
  return isHandOverResponse(response) ? response.folderId : null;
}

/** Asks the X tab beside the panel to show a folder in the page. False when nobody answered. */
export async function showFolderInPage(folderId: string | null): Promise<boolean> {
  const request: OpenFolderRequest = { kind: OPEN_FOLDER, folderId };
  const response = await askActiveTab(request);
  return isSimpleResponse(response) && response.ok;
}
```

把 `src/sidepanel/openPost.ts` 整个替换为（改用上面的 `askActiveTab`，行为不变）：

```ts
import {
  NAVIGATE_TO_POST,
  isSimpleResponse,
  type NavigateRequest,
} from '@/messaging/sidePanelProtocol';
import { isSafeXUrl } from '@/utils/url';
import { askActiveTab } from './activeTab';

export interface OpenPostOptions {
  /** ⌘/Ctrl-click: always a new tab. */
  newTab: boolean;
}

/**
 * Opens a saved post from the side panel.
 *
 * The panel is an extension page: following the link itself would navigate
 * the panel, not the page beside it. The active tab is asked first — if it is
 * an X tab, our content script answers and switches to the post itself, which
 * needs no `tabs` permission. Anything else (a non-X tab, no answer) gets a
 * new tab.
 */
export async function openPost(url: string, options: OpenPostOptions): Promise<void> {
  if (!isSafeXUrl(url)) return;
  if (!options.newTab) {
    const request: NavigateRequest = { kind: NAVIGATE_TO_POST, url };
    const answer = await askActiveTab(request);
    if (isSimpleResponse(answer) && answer.ok) return;
  }
  await chrome.tabs.create({ url });
}
```

- [ ] **Step 4：运行，确认通过**

Run: `pnpm vitest run tests/unit/panel-bridge.test.ts tests/unit/active-tab.test.ts tests/unit/open-post.test.ts tests/unit/side-panel.test.ts tests/unit/navigate-handler.test.ts`
Expected: PASS（后三个文件是回归：侧边栏点卡片、从页面打开侧边栏、内容脚本响应打开原帖，行为都不变）。

- [ ] **Step 5：内容脚本接上这两条消息**

`src/hosts/x/XRuntime.ts`：import 区，在 `import { listenForNavigateRequests } from './NavigateHandler';` 后面加：

```ts
import { listenForPanelRequests } from './PanelBridge';
```

`start()` 里，在 `listenForNavigateRequests(this.#registry);` 后面加：

```ts
    listenForPanelRequests(this.#registry, {
      currentFolder: () => this.#folderView.activeFolderId(),
      openFolder: (folderId) => this.#folderView.open(folderId),
    });
```

- [ ] **Step 6：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全部成功；`Tests  340 passed`（328 + 12）。

```bash
git add src/messaging/sidePanelProtocol.ts src/hosts/x/PanelBridge.ts src/sidepanel/activeTab.ts src/sidepanel/openPost.ts src/hosts/x/XRuntime.ts tests/unit/panel-bridge.test.ts tests/unit/active-tab.test.ts
git commit -m "侧边栏与 X 页面之间的交接消息：接管文件夹、交还文件夹"
git push origin main
```

---

### Task 8：X 页面跟随阅读模式

**Files:**
- Create: `src/hosts/x/openPanelFromPage.ts`
- Create: `src/ui/sidebar/PanelEntry.tsx`
- Modify: `src/hosts/x/selectors.ts`
- Modify: `src/ui/sidebar/sidebar.css.ts`
- Modify: `src/hosts/x/SidebarMount.tsx`
- Modify: `src/ui/folder-view/FolderViewApp.tsx`
- Modify: `src/ui/folder-view/folderView.css.ts`
- Modify: `src/hosts/x/FolderViewMount.tsx`
- Modify: `src/hosts/x/XRuntime.ts`
- Test: `tests/unit/open-in-side-panel.test.tsx` → 改名为 `tests/unit/switch-mode-button.test.tsx`
- Test: `tests/unit/sidebar-reading-mode.test.tsx`
- Test: `tests/unit/sidebar-budget.test.tsx`（修改）
- Test: `tests/unit/return-restore.test.ts`（修改）
- Test: `tests/e2e/minimal-loop.spec.ts`（修改）

X 页面这一侧在两种模式下的样子：

| | 页面内模式 | 侧边栏模式 |
|---|---|---|
| X 左栏 | 「我的收藏」文件夹树 | 只有一个「我的收藏」入口，点它打开侧边栏 |
| 收藏列表覆盖层 | 点文件夹打开；顶部有「切换到侧边栏」 | 关闭；按「返回」也不恢复 |
| 帖子上的文件夹按钮、保存弹层 | 一样 | 一样 |

页面这一侧**不写**阅读模式：「切换到侧边栏」和左栏入口都只是打开侧边栏，侧边栏加载后自己把模式写成「侧边栏」（Task 9），页面听到变化再关覆盖层、换左栏。这样工具栏图标这条页面管不到的入口，结果也完全一样。

- [ ] **Step 1：改写「切换按钮」的测试**

```bash
git mv tests/unit/open-in-side-panel.test.tsx tests/unit/switch-mode-button.test.tsx
```

把 `tests/unit/switch-mode-button.test.tsx` 整个替换为：

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

describe('the overlay’s reading-mode switch', () => {
  let container: HTMLElement;

  const switchButton = (): HTMLButtonElement | undefined =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '切换到侧边栏',
    );

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
    const onSwitchMode = vi.fn();
    render(
      <FolderViewApp
        store={new FolderStore()}
        folderId="f1"
        onClose={() => {}}
        onMembershipChanged={() => {}}
        onOpenPost={() => {}}
        onSwitchMode={onSwitchMode}
      />,
      container,
    );
    await flush();
    const button = switchButton();
    expect(button).toBeDefined();
    expect(button?.title).toContain('切换阅读模式');
    button?.click();
    expect(onSwitchMode).toHaveBeenCalledTimes(1);
  });

  it('is not offered inside the side panel, which has its own', async () => {
    render(
      <FolderViewApp
        store={new FolderStore()}
        folderId="f1"
        onClose={() => {}}
        onMembershipChanged={() => {}}
        onOpenPost={() => {}}
      />,
      container,
    );
    await flush();
    expect(switchButton()).toBeUndefined();
  });
});
```

- [ ] **Step 2：写「左栏跟随阅读模式」的失败测试**

新建 `tests/unit/sidebar-reading-mode.test.tsx`：

```tsx
import { options } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { READING_MODE_KEY } from '@/core/constants';
import { ThemeAdapter } from '@/hosts/x/ThemeAdapter';
import { FolderStore } from '@/state/FolderStore';
import { ReadingModeStore } from '@/state/ReadingModeStore';
import { shadowRootOf } from '@/ui/shared/ShadowHost';
import { toasts } from '@/ui/shared/toastStore';
import { CleanupRegistry } from '@/utils/cleanup';
import { resetChromeStub } from '../setup';

const { rpcMock, openPanelMock } = vi.hoisted(() => ({
  rpcMock: vi.fn<(method: string, payload: unknown) => Promise<unknown>>(),
  openPanelMock: vi.fn<() => Promise<{ ok: boolean; message?: string }>>(),
}));
vi.mock('@/messaging/RpcClient', () => ({ rpc: rpcMock, rpcOrNull: vi.fn() }));
vi.mock('@/messaging/sidePanelClient', () => ({ requestOpenSidePanel: openPanelMock }));

import { SidebarMount } from '@/hosts/x/SidebarMount';

options.requestAnimationFrame = (callback: () => void): void => callback();

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** jsdom does no layout, so X's measurements are pinned onto the nodes. */
function pin(id: string, sizes: Record<string, number>): void {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing #${id}`);
  for (const [key, value] of Object.entries(sizes)) {
    Object.defineProperty(element, key, { configurable: true, value });
  }
}

function host(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-xf-sidebar-host]');
}

/** Every button our host shows inside X's navigation column. */
function buttons(): HTMLButtonElement[] {
  return Array.from(shadowRootOf(host())?.querySelectorAll('button') ?? []);
}

describe('X’s left column follows the reading mode', () => {
  let registry: CleanupRegistry;
  let reading: ReadingModeStore;
  let mount: SidebarMount;

  beforeEach(() => {
    resetChromeStub();
    rpcMock.mockReset().mockResolvedValue({ ok: true, data: { folders: [], recentFolderIds: [] } });
    openPanelMock.mockReset().mockResolvedValue({ ok: true });
    registry = new CleanupRegistry();
    reading = new ReadingModeStore();
    reading.attach(registry);
    document.body.innerHTML = `
      <header role="banner"><div id="col">
        <div id="top"><nav><a data-testid="AppTabBar_Home_Link"></a></nav></div>
        <div id="bottom"><div data-testid="SideNav_AccountSwitcher_Button"></div></div>
      </div></header>`;
    mount = new SidebarMount({
      store: new FolderStore(),
      theme: new ThemeAdapter(),
      registry,
      onOpenFolder: () => {},
      reading,
    });
  });

  afterEach(() => {
    registry.dispose();
    toasts.reset();
    document.body.innerHTML = '';
  });

  it('waits for the stored choice before putting anything in X’s navigation', async () => {
    expect(mount.ensure()).toBe(false);
    expect(host()).toBeNull();

    await reading.load();
    expect(mount.ensure()).toBe(true);
    expect(host()).not.toBeNull();
  });

  it('shows the folder tree in page mode', async () => {
    await reading.load();
    mount.ensure();
    await settle();
    expect(host()?.getAttribute('data-xf-reading')).toBe('page');
    expect(buttons().map((button) => button.getAttribute('aria-label'))).toContain('新建文件夹');
  });

  it('shows only the way into the side panel in panel mode', async () => {
    await chrome.storage.local.set({ [READING_MODE_KEY]: 'panel' });
    await reading.load();
    mount.ensure();
    await settle();
    expect(host()?.getAttribute('data-xf-reading')).toBe('panel');
    expect(buttons()).toHaveLength(1);
    expect(buttons()[0]?.getAttribute('aria-label')).toBe('我的收藏');
    expect(buttons()[0]?.textContent).toBe('我的收藏');
  });

  it('keeps to the icon when X’s navigation is narrow', async () => {
    pin('col', { clientWidth: 88, clientHeight: 1000 });
    await reading.set('panel');
    mount.ensure();
    await settle();
    expect(host()?.getAttribute('data-xf-mode')).toBe('narrow');
    expect(buttons()).toHaveLength(1);
    expect(buttons()[0]?.className).toBe('xf-narrow-button');
    expect(buttons()[0]?.textContent).toBe('');
  });

  it('swaps the tree for the entry, and back, when the mode changes', async () => {
    await reading.load();
    mount.ensure();
    await reading.set('panel');
    mount.ensure();
    await settle();
    expect(document.querySelectorAll('[data-xf-sidebar-host]')).toHaveLength(1);
    expect(buttons()).toHaveLength(1);

    await reading.set('page');
    mount.ensure();
    await settle();
    expect(host()?.getAttribute('data-xf-reading')).toBe('page');
    expect(buttons().map((button) => button.getAttribute('aria-label'))).toContain('新建文件夹');
  });

  it('opens the side panel straight from the click on the entry', async () => {
    await reading.set('panel');
    mount.ensure();
    await settle();
    buttons()[0]?.click();
    expect(openPanelMock).toHaveBeenCalledTimes(1);
    await settle();
    expect(toasts.toasts).toHaveLength(0);
  });

  it('says so when the browser refuses to open the panel', async () => {
    openPanelMock.mockResolvedValue({ ok: false, message: 'no gesture' });
    await reading.set('panel');
    mount.ensure();
    await settle();
    buttons()[0]?.click();
    await settle();
    expect(toasts.toasts.map((toast) => toast.message)).toEqual([
      '无法从页面打开侧边栏，请点浏览器工具栏上的扩展图标。',
    ]);
  });
});
```

- [ ] **Step 3：让两份现有测试跟上新的依赖**

`tests/unit/sidebar-budget.test.tsx`：import 区加一行

```ts
import { ReadingModeStore } from '@/state/ReadingModeStore';
```

在 `describe('SidebarMount', () => {` 里，`let registry: CleanupRegistry;` 后面加 `let reading: ReadingModeStore;`；把这个 `describe` 里的 `beforeEach(() => {` 改成 `beforeEach(async () => {`，并在它的末尾（`pin('bottom', { offsetHeight: 66 });` 之后）加：

```ts
      // The mount waits for the stored reading mode before it shows anything.
      reading = new ReadingModeStore();
      await reading.load();
```

把 `mountWithColumnHeight` 里构造 `SidebarMount` 的参数加上 `reading`：

```ts
      const mount = new SidebarMount({
        store: new FolderStore(),
        theme: new ThemeAdapter(),
        registry,
        onOpenFolder: () => {},
        reading,
      });
```

`tests/unit/return-restore.test.ts`：把 `import { RETURN_STATE_KEY } from '@/core/constants';` 改成

```ts
import { READING_MODE_KEY, RETURN_STATE_KEY } from '@/core/constants';
```

并在最后一个用例后面加两个用例：

```ts
  it('does not bring the list back in panel mode', async () => {
    await chrome.storage.local.set({ [READING_MODE_KEY]: 'panel' });
    await chrome.storage.session.set({
      [RETURN_STATE_KEY]: { [HOME_ENTRY]: { folderId: 'f1', anchorId: null, offset: 0, count: 2, at: 1 } },
    });
    await start();
    expect(overlay()).toBeNull();
  });

  it('closes the list and swaps the tree for the entry when reading moves to the side panel', async () => {
    await start();
    clickFolderInTree();
    await settle();
    expect(overlay()).not.toBeNull();

    // What the side panel does once it has loaded.
    await chrome.storage.local.set({ [READING_MODE_KEY]: 'panel' });
    await settle();
    expect(overlay()).toBeNull();
    expect(
      document.querySelector(`[${XF_ATTR.sidebarHost}]`)?.getAttribute(XF_ATTR.readingMode),
    ).toBe('panel');
  });
```

- [ ] **Step 4：运行，确认失败**

Run: `pnpm vitest run tests/unit/switch-mode-button.test.tsx tests/unit/sidebar-reading-mode.test.tsx tests/unit/return-restore.test.ts`
Expected: FAIL：找不到「切换到侧边栏」按钮；`SidebarMount` 不认识 `reading`、没有 `data-xf-reading`；侧边栏模式下覆盖层照样恢复 / 没有关闭。（`pnpm typecheck` 此时报 `onSwitchMode`、`reading`、`XF_ATTR.readingMode` 不存在。）

- [ ] **Step 5：从页面打开侧边栏（两处共用）**

新建 `src/hosts/x/openPanelFromPage.ts`：

```ts
import { requestOpenSidePanel } from '@/messaging/sidePanelClient';
import { toasts } from '@/ui/shared/toastStore';

/**
 * Opens the browser's side panel from a click inside x.com. Call it straight
 * from the click handler: the browser only lets the background open the panel
 * while the click still counts as a gesture (verified on real Chrome in M1).
 *
 * Nothing here writes the reading mode. The panel does that itself once it has
 * loaded, so this path and the toolbar icon end up in exactly the same state.
 */
export function openPanelFromPage(): void {
  void requestOpenSidePanel().then((result) => {
    if (!result.ok) {
      toasts.show('无法从页面打开侧边栏，请点浏览器工具栏上的扩展图标。', { tone: 'danger' });
    }
  });
}
```

- [ ] **Step 6：左栏的入口**

`src/hosts/x/selectors.ts`：在 `XF_ATTR` 里，`sidebarLayerHost` 那一项后面加：

```ts
  /** On the sidebar host: the reading mode it is drawn for, 'page' or 'panel'. */
  readingMode: 'data-xf-reading',
```

新建 `src/ui/sidebar/PanelEntry.tsx`：

```tsx
import { createPortal } from 'preact/compat';
import { Icon } from '@/ui/shared/Icon';
import { ToastHost } from '@/ui/shared/Toast';

export interface PanelEntryProps {
  /** Wide: icon and label, like one of X's own navigation items. Narrow: the icon alone. */
  layout: 'wide' | 'narrow';
  onOpen: () => void;
  /** Where the toast renders: the same page-level layer the folder tree uses. */
  layerRoot?: HTMLElement;
}

/**
 * What X's navigation shows in panel reading mode (work order 2.3): no folder
 * tree, only the way into the side panel.
 */
export function PanelEntry(props: PanelEntryProps): preact.JSX.Element {
  const toast = <ToastHost />;
  return (
    <div class="xf-sidebar">
      <button
        type="button"
        class={props.layout === 'narrow' ? 'xf-narrow-button' : 'xf-entry-button'}
        aria-label="我的收藏"
        title="在侧边栏中打开我的收藏"
        onClick={props.onOpen}
      >
        <Icon name="folderOutline" size={26} />
        {props.layout === 'wide' && <span>我的收藏</span>}
      </button>
      {props.layerRoot === undefined ? toast : createPortal(toast, props.layerRoot)}
    </div>
  );
}
```

`src/ui/sidebar/sidebar.css.ts`：在最后的 `` `; `` 之前加：

```css

/* Panel reading mode: the tree lives in the side panel and the column keeps
   only the way in, shaped like one of X's own navigation items. */
:host([data-xf-reading="panel"]) .xf-sidebar { padding: 2px 0; border-top: 0; }
.xf-entry-button {
  display: flex;
  align-items: center;
  gap: 20px;
  height: 50px;
  margin: 2px 0;
  padding: 0 24px 0 12px;
  border-radius: 9999px;
  font-size: 20px;
  color: var(--xf-text);
}
.xf-entry-button:hover { background: var(--xf-hover); }
```

把 `src/hosts/x/SidebarMount.tsx` 整个替换为：

```tsx
import { render } from 'preact';
import type { ReadingMode } from '@/core/readingMode';
import type { CleanupRegistry } from '@/utils/cleanup';
import { createLogger } from '@/utils/logger';
import { createShadowHost, dedupeHosts, type ShadowHostHandle } from '@/ui/shared/ShadowHost';
import { BASE_CSS, FEEDBACK_CSS } from '@/ui/shared/theme.css';
import { PanelEntry } from '@/ui/sidebar/PanelEntry';
import { SIDEBAR_CSS } from '@/ui/sidebar/sidebar.css';
import { SidebarApp } from '@/ui/sidebar/SidebarApp';
import type { FolderStore } from '@/state/FolderStore';
import type { ReadingModeStore } from '@/state/ReadingModeStore';
import { openPanelFromPage } from './openPanelFromPage';
import type { ThemeAdapter } from './ThemeAdapter';
import { locateSidebar, measureBudget, type SidebarAnchor } from './SidebarLocator';
import { XF_ATTR } from './selectors';

const log = createLogger('sidebar-mount');

export interface SidebarMountDeps {
  store: FolderStore;
  theme: ThemeAdapter;
  registry: CleanupRegistry;
  onOpenFolder: (folderId: string) => void;
  /** Decides what the column shows: the folder tree, or the way into the side panel. */
  reading: ReadingModeStore;
}

export interface MountHandle {
  readonly element: HTMLElement;
  isConnected(): boolean;
  update(): void;
  dispose(): void;
}

/**
 * Idempotent sidebar mounting.
 *
 * `ensure()` may be called as often as the observers fire: it no-ops when the
 * host is already in the right place, re-mounts when React replaced the column
 * or the reading mode changed, converges to a single host when duplicates
 * appear, and never becomes permanently dead just because one call could not
 * find an anchor.
 */
export class SidebarMount implements MountHandle {
  #handle: ShadowHostHandle | null = null;
  #layer: ShadowHostHandle | null = null;
  #anchor: SidebarAnchor | null = null;
  #stopResize: (() => void) | null = null;

  constructor(private readonly deps: SidebarMountDeps) {}

  get element(): HTMLElement {
    if (this.#handle === null) throw new Error('sidebar not mounted');
    return this.#handle.host;
  }

  isConnected(): boolean {
    return this.#handle?.isConnected() ?? false;
  }

  ensure(): boolean {
    // What the column shows depends on the stored reading mode. Mounting on the
    // default would flash the folder tree at a reader who is in panel mode.
    if (!this.deps.reading.loaded) return false;
    const reading = this.deps.reading.mode;

    const anchor = locateSidebar();
    if (anchor === null) {
      // Transient during a route change; the watchdog retries.
      log.debug('no sidebar anchor');
      return false;
    }

    // Converge first: a cloned subtree can leave a second host behind.
    const survivor = dedupeHosts(XF_ATTR.sidebarHost);
    if (
      this.#handle !== null &&
      survivor === this.#handle.host &&
      this.#handle.host.parentElement === anchor.column &&
      this.#handle.host.getAttribute('data-xf-mode') === anchor.mode &&
      this.#handle.host.getAttribute(XF_ATTR.readingMode) === reading &&
      this.#layer?.isConnected() === true
    ) {
      this.#anchor = anchor;
      this.update();
      return true;
    }

    // Anything else — moved, replaced, layout or reading mode flipped, or a
    // foreign leftover host — is rebuilt from scratch so no stale listener or
    // Preact root survives.
    if (survivor !== null && survivor !== this.#handle?.host) survivor.remove();
    this.#teardownHandle();
    this.#mount(anchor, reading);
    return true;
  }

  #mount(anchor: SidebarAnchor, reading: ReadingMode): void {
    const handle = createShadowHost({
      marker: XF_ATTR.sidebarHost,
      css: `${BASE_CSS}${FEEDBACK_CSS}${SIDEBAR_CSS}`,
      theme: this.deps.theme,
      registry: this.deps.registry,
    });
    handle.host.setAttribute('data-xf-mode', anchor.mode);
    handle.host.setAttribute(XF_ATTR.readingMode, reading);
    handle.host.style.display = 'block';
    handle.host.style.width = '100%';
    // Clips to the budget set in update(). Our panels, menus and dialogs are
    // position: fixed, so they are not cut off by this.
    handle.host.style.overflow = 'hidden';

    if (anchor.before !== null) anchor.column.insertBefore(handle.host, anchor.before);
    else anchor.column.appendChild(handle.host);

    // The floating pieces — narrow panel, context menu, delete dialog, toasts —
    // render into a page-level layer, not in here: on real X the navigation
    // sits in a z-index 0 stacking context, so nothing mounted inside it can
    // rise above the folder-view overlay (seen on 2026-09-29).
    dedupeHosts(XF_ATTR.sidebarLayerHost)?.remove();
    const layer = createShadowHost({
      marker: XF_ATTR.sidebarLayerHost,
      css: `${BASE_CSS}${FEEDBACK_CSS}${SIDEBAR_CSS}`,
      theme: this.deps.theme,
      registry: this.deps.registry,
    });
    Object.assign(layer.host.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      zIndex: '9999',
    });
    document.body.appendChild(layer.host);
    this.#layer = layer;

    render(
      reading === 'panel' ? (
        <PanelEntry layout={anchor.mode} onOpen={openPanelFromPage} layerRoot={layer.mount} />
      ) : (
        <SidebarApp
          store={this.deps.store}
          mode={anchor.mode}
          onOpenFolder={this.deps.onOpenFolder}
          layerRoot={layer.mount}
        />
      ),
      handle.mount,
    );

    this.#handle = handle;
    this.#anchor = anchor;
    this.#observeSize(anchor, handle);
    this.update();
    log.debug('sidebar mounted', anchor.mode, reading, 'via', anchor.via);
  }

  #observeSize(anchor: SidebarAnchor, handle: ShadowHostHandle): void {
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => this.update());
    observer.observe(anchor.column);
    // Hold the registry handle so a re-mount takes the old observer back off the
    // registry. The shadow host next to it already self-removes, which is
    // exactly what made this one easy to miss.
    this.#stopResize = this.deps.registry.addObserver(observer);
    void handle;
  }

  /**
   * Recomputes the height budget. It caps the whole host, header included, so
   * whatever X leaves free is all we take and the account switcher can never
   * be pushed off screen; the tree scrolls inside what is left.
   */
  update(): void {
    if (this.#handle === null || this.#anchor === null) return;
    const budget = measureBudget(this.#anchor.column);
    const { host, mount } = this.#handle;
    if (budget === null) {
      host.style.maxHeight = '';
      mount.style.removeProperty('--xf-sidebar-max-height');
      return;
    }
    host.style.maxHeight = `${budget}px`;
    mount.style.setProperty('--xf-sidebar-max-height', `${budget}px`);
  }

  #teardownHandle(): void {
    if (this.#handle !== null) {
      // Unmounting the app also unmounts whatever it portalled into the layer.
      render(null, this.#handle.mount);
      this.#handle.dispose();
      this.#handle = null;
    }
    this.#layer?.dispose();
    this.#layer = null;
    this.#stopResize?.();
    this.#stopResize = null;
  }

  dispose(): void {
    this.#teardownHandle();
    this.#anchor = null;
  }
}
```

- [ ] **Step 7：收藏列表顶部的「切换到侧边栏」**

`src/ui/folder-view/FolderViewApp.tsx`，四处：

① import 区，在 `import { createIcon } from '@/ui/shared/icons';` 前面加：

```ts
import { Icon } from '@/ui/shared/Icon';
```

② 删除整个 `SidePanelIcon` 函数（`function SidePanelIcon(): preact.JSX.Element { … }`）。

③ `FolderViewAppProps` 里，把

```ts
  /** Present only on the page overlay: hands the reading over to the side panel. */
  onOpenInSidePanel?: () => void;
```

改成

```ts
  /** Present only on the page overlay: switches reading over to the side panel. */
  onSwitchMode?: () => void;
```

④ 头部里，把

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

改成

```tsx
        {props.onSwitchMode !== undefined && (
          <button
            type="button"
            class="xf-fv-switch"
            title="切换阅读模式：改用浏览器侧边栏"
            onClick={props.onSwitchMode}
          >
            <Icon name="sidePanel" size={16} />
            <span>切换到侧边栏</span>
          </button>
        )}
```

`src/ui/folder-view/folderView.css.ts`：把 `.xf-fv-side-panel { margin-left: auto; }` 这一行替换为：

```css
/* The reading-mode switch: here "to the side panel", in the panel "to the page". */
.xf-fv-switch {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 5px 12px;
  border: 1px solid var(--xf-border);
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 700;
  color: var(--xf-accent);
  white-space: nowrap;
}
.xf-fv-switch:hover { background: var(--xf-hover); }
```

`src/hosts/x/FolderViewMount.tsx`，三处：

① import 区：删除这两行

```ts
import { requestOpenSidePanel } from '@/messaging/sidePanelClient';
import { toasts } from '@/ui/shared/toastStore';
```

并在 `import { navigateInPage, onPostPage } from './navigateInPage';` 后面加：

```ts
import { openPanelFromPage } from './openPanelFromPage';
```

② `#render` 里把 `onOpenInSidePanel={() => this.#openInSidePanel()}` 改成：

```tsx
        onSwitchMode={openPanelFromPage}
```

③ 删除整个 `#openInSidePanel` 方法（连同它上面的注释）。

- [ ] **Step 8：内容脚本接上阅读模式**

`src/hosts/x/XRuntime.ts`，五处：

① import 区，在 `import { FolderStore } from '@/state/FolderStore';` 后面加：

```ts
import { ReadingModeStore } from '@/state/ReadingModeStore';
```

② 字段：在 `readonly #refresher = new SnapshotRefresher();` 后面加：

```ts
  readonly #reading = new ReadingModeStore();
  /** Settles once the stored reading mode is known. */
  #readingReady: Promise<void> = Promise.resolve();
```

③ 构造函数里创建 `SidebarMount` 的参数加上 `reading`：

```ts
    this.#sidebar = new SidebarMount({
      store: this.#store,
      theme: this.#theme,
      registry: this.#registry,
      onOpenFolder: (folderId) => this.#folderView.open(folderId),
      reading: this.#reading,
    });
```

④ `start()` 里，在 `this.#refresher.attach(this.#registry);` 后面加：

```ts
    this.#reading.attach(this.#registry);
    this.#reading.subscribe((mode) => {
      // In panel mode the list lives in the side panel: the overlay goes, and
      // the left column swaps the folder tree for the way into the panel.
      if (mode === 'panel') this.#folderView.close();
      this.#sidebar.ensure();
    });
    this.#readingReady = this.#reading.load().then(() => {
      // The left column was waiting for this.
      if (!this.#registry.disposed) this.#sidebar.ensure();
    });
```

⑤ 把 `#restoreAfterReturn` 方法替换为（多了「只在页面内模式恢复」）：

```ts
  /**
   * Brings the folder list back when the browser returns to the history entry
   * it was left from (work order 2.3). Runs at start-up as well: opening the
   * post may have been a full page load, and then this is a brand-new content
   * script with nothing in memory.
   */
  async #restoreAfterReturn(): Promise<void> {
    const key = currentEntryKey();
    if (key === null) return;
    const state = await takeReturn(key);
    if (state === null) return;
    await this.#readingReady;
    if (this.#registry.disposed || this.#reading.mode !== 'page') return;
    // Storage answered late and the reader has moved again, or a list is
    // already open: leave things as they are.
    if (currentEntryKey() !== key || this.#folderView.isOpen()) return;
    this.#folderView.open(state.folderId, {
      anchorId: state.anchorId,
      offset: state.offset,
      count: state.count,
    });
  }
```

- [ ] **Step 9：运行，确认通过**

Run: `pnpm vitest run tests/unit/switch-mode-button.test.tsx tests/unit/sidebar-reading-mode.test.tsx tests/unit/sidebar-budget.test.tsx tests/unit/return-restore.test.ts tests/unit/folder-view.test.tsx tests/unit/xruntime-scan.test.ts tests/unit/spa-resilience.test.ts`
Expected: PASS。

- [ ] **Step 10：端到端测试里的按钮名**

`tests/e2e/minimal-loop.spec.ts`：把

```ts
  await expect(overlay.getByRole('button', { name: '在侧边栏中打开' })).toBeVisible();
```

改成

```ts
  await expect(overlay.getByRole('button', { name: '切换到侧边栏' })).toBeVisible();
```

- [ ] **Step 11：全量检查（含端到端）并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e
```

Expected: 全部成功；单元测试 `Tests  349 passed`（340 + 9）；端到端 `13 passed`。

```bash
git add src/hosts/x/openPanelFromPage.ts src/ui/sidebar/PanelEntry.tsx src/hosts/x/selectors.ts src/ui/sidebar/sidebar.css.ts src/hosts/x/SidebarMount.tsx src/ui/folder-view/FolderViewApp.tsx src/ui/folder-view/folderView.css.ts src/hosts/x/FolderViewMount.tsx src/hosts/x/XRuntime.ts tests/unit/switch-mode-button.test.tsx tests/unit/sidebar-reading-mode.test.tsx tests/unit/sidebar-budget.test.tsx tests/unit/return-restore.test.ts tests/e2e/minimal-loop.spec.ts
git status --short
git commit -m "X 页面跟随阅读模式：收藏列表顶部「切换到侧边栏」，侧边栏模式下左栏只留入口"
git push origin main
```

（`git status --short` 在提交前应只显示已暂存的改动：9 个源文件、4 个单元测试文件——其中 `open-in-side-panel` 改名为 `switch-mode-button`——和 1 个端到端测试文件。）

---

### Task 9：侧边栏完整版

**Files:**
- Modify: `src/sidepanel/SidePanelApp.tsx`
- Modify: `src/sidepanel/styles.ts`
- Modify: `src/entrypoints/sidepanel/main.tsx`
- Modify: `src/ui/folder-view/FolderViewApp.tsx`
- Modify: `src/ui/folder-view/SavedTweetCard.tsx`
- Modify: `src/ui/folder-view/folderView.css.ts`
- Test: `tests/unit/side-panel-app.test.tsx`（重写）

侧边栏这一侧要做的事：

1. **打开即进入侧边栏模式**：侧边栏页面加载后，先问旁边的 X 标签页「你正在看哪个文件夹」，接过来显示；再把模式写成「侧边栏」。无论是点工具栏图标、点 X 左栏入口，还是点收藏列表顶部的「切换到侧边栏」，走的都是这一条路。
2. **顶栏**：左边是名称「帖子文件夹」，右边是「切换到页面内」。点它：先请旁边的 X 标签页打开当前文件夹，再把模式写回「页面内」，然后关掉侧边栏。
3. **别处切回页面内时自己关闭**：比如另一个窗口的侧边栏点了「切换到页面内」。
4. **刚点开的卡片高亮**（效果图）：侧边栏不动，一眼能看出刚才点的是哪条。
5. 用侧边栏自带的 × 关掉后仍是侧边栏模式——什么都不用做：关闭时不写模式。

- [ ] **Step 1：重写侧边栏的测试**

把 `tests/unit/side-panel-app.test.tsx` 整个替换为：

```tsx
import { options, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { READING_MODE_KEY } from '@/core/constants';
import type { FolderWithCount } from '@/core/domain/folder';
import { FolderStore } from '@/state/FolderStore';
import { ReadingModeStore } from '@/state/ReadingModeStore';
import { CleanupRegistry } from '@/utils/cleanup';
import { chromeStorageSnapshot, resetChromeStub } from '../setup';

const { rpcMock, openPostMock, takeOverMock, showInPageMock } = vi.hoisted(() => ({
  rpcMock: vi.fn<(method: string, payload: unknown) => Promise<unknown>>(),
  openPostMock: vi.fn<(url: string, options: { newTab: boolean }) => Promise<void>>(),
  takeOverMock: vi.fn<() => Promise<string | null>>(),
  showInPageMock: vi.fn<(folderId: string | null) => Promise<boolean>>(),
}));

vi.mock('@/messaging/RpcClient', () => ({ rpc: rpcMock, rpcOrNull: vi.fn() }));
vi.mock('@/sidepanel/openPost', () => ({ openPost: openPostMock }));
vi.mock('@/sidepanel/activeTab', () => ({
  takeOverFolder: takeOverMock,
  showFolderInPage: showInPageMock,
}));

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
  let registry: CleanupRegistry;
  let reading: ReadingModeStore;
  const onLeave = vi.fn<() => void>();

  const buttonNamed = (name: string): HTMLButtonElement | undefined =>
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === name);

  const postLink = (): HTMLAnchorElement | null =>
    container.querySelector<HTMLAnchorElement>(`a[href="${POST}"]`);

  async function openPanel(): Promise<void> {
    render(<SidePanelApp store={new FolderStore()} reading={reading} onLeave={onLeave} />, container);
    await flush();
  }

  beforeEach(() => {
    resetChromeStub();
    onLeave.mockReset();
    openPostMock.mockReset().mockResolvedValue(undefined);
    takeOverMock.mockReset().mockResolvedValue(null);
    showInPageMock.mockReset().mockResolvedValue(true);
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
                  segments: [{ kind: 'text', text: '一条收藏' }],
                  avatarUrl: null,
                  verified: false,
                  postedAt: null,
                  media: [],
                  quote: null,
                  card: null,
                  truncated: false,
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
    registry = new CleanupRegistry();
    reading = new ReadingModeStore();
    reading.attach(registry);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    registry.dispose();
  });

  it('lists a folder’s posts and routes a click to openPost instead of navigating the panel', async () => {
    const before = location.href;
    await openPanel();
    buttonNamed('AI')?.click();
    await flush();

    expect(postLink()).not.toBeNull();
    postLink()?.click();
    expect(openPostMock).toHaveBeenCalledWith(POST, { newTab: false });
    expect(location.href).toBe(before);
  });

  it('marks the post that was just opened', async () => {
    await openPanel();
    buttonNamed('AI')?.click();
    await flush();
    const row = (): Element | null => container.querySelector('[data-xf-tweet-id]');
    expect(row()?.getAttribute('data-opened')).toBe('false');

    postLink()?.click();
    await flush();
    expect(row()?.getAttribute('data-opened')).toBe('true');
  });

  it('chooses panel mode on opening, after asking the page which folder it shows', async () => {
    let modeWhenAsked: string | undefined;
    takeOverMock.mockImplementation(async () => {
      modeWhenAsked = reading.mode;
      return null;
    });
    await openPanel();

    // Asked first: switching the mode is what closes the page's overlay.
    expect(modeWhenAsked).toBe('page');
    expect(reading.mode).toBe('panel');
    expect(chromeStorageSnapshot().get(READING_MODE_KEY)).toBe('panel');
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('takes over the folder the page was showing', async () => {
    takeOverMock.mockResolvedValue('f1');
    await openPanel();
    // No click on the tree: the list is there because the page handed it over.
    expect(postLink()).not.toBeNull();
  });

  it('switches back: hands its folder to the page, then writes the mode and closes', async () => {
    let modeWhenHanded: string | undefined;
    showInPageMock.mockImplementation(async () => {
      modeWhenHanded = reading.mode;
      return true;
    });
    await openPanel();
    buttonNamed('AI')?.click();
    await flush();

    buttonNamed('切换到页面内')?.click();
    await flush();
    expect(showInPageMock).toHaveBeenCalledExactlyOnceWith('f1');
    expect(modeWhenHanded).toBe('panel');
    expect(reading.mode).toBe('page');
    expect(chromeStorageSnapshot().get(READING_MODE_KEY)).toBe('page');
    expect(onLeave).toHaveBeenCalled();
  });

  it('closes when reading is switched back to the page somewhere else', async () => {
    await openPanel();
    await chrome.storage.local.set({ [READING_MODE_KEY]: 'page' });
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2：运行，确认失败**

Run: `pnpm vitest run tests/unit/side-panel-app.test.tsx`
Expected: FAIL：`SidePanelApp` 不认识 `reading` / `onLeave`，没有 `data-opened`，没有「切换到页面内」按钮，模式没有被写入。

- [ ] **Step 3：收藏列表高亮刚点开的卡片**

`src/ui/folder-view/SavedTweetCard.tsx`：`SavedTweetCardProps` 里，`removing: boolean;` 后面加：

```ts
  /** The reader opened this post last; in the side panel it stays marked. */
  opened: boolean;
```

并在外层 `<div class="xf-fv-row" …>` 上，`data-removing=…` 后面加一个属性：

```tsx
      data-opened={props.opened ? 'true' : 'false'}
```

`src/ui/folder-view/folderView.css.ts`：在 `.xf-fv-row[data-removing="true"] { opacity: .5; }` 后面加：

```css
/* The post just opened (side panel): the list stays, and this is where the reader was. */
.xf-fv-row[data-opened="true"] { background: var(--xf-accent-soft); box-shadow: inset 4px 0 0 var(--xf-accent); }
```

`src/ui/folder-view/FolderViewApp.tsx`，四处：

① 在 `const [menu, setMenu] = useState<…>(null);` 后面加：

```ts
  const [openedId, setOpenedId] = useState<TweetId | null>(null);
```

② 在切换文件夹时重置状态的那个 `useEffect` 里，`setMenu(null);` 后面加：

```ts
    setOpenedId(null);
```

③ 把 `openPost` 替换为：

```ts
  const openPost = (tweetId: TweetId, url: string, options: OpenOptions): void => {
    // In the side panel the list stays put, so the card just opened is marked.
    // (On the page the list closes, and the mark goes with it.)
    if (!options.newTab) setOpenedId(tweetId);
    const list = listRef.current;
    props.onOpenPost(url, options, list === null ? TOP_OF_LIST : readViewPosition(list));
  };
```

④ 把 `<SavedTweetCard … />` 替换为：

```tsx
          <SavedTweetCard
            key={item.tweet.tweetId}
            item={item}
            now={now}
            removing={removing === item.tweet.tweetId}
            opened={openedId === item.tweet.tweetId}
            onOpen={(url, options) => openPost(item.tweet.tweetId, url, options)}
            onMenu={(tweetId, x, y) => setMenu({ tweetId, x, y })}
          />
```

并把「⋯」菜单里的

```ts
            if (action === 'open') openPost(menuTarget.tweet.canonicalUrl, { newTab: true });
```

改成

```ts
            if (action === 'open') {
              openPost(menuTarget.tweet.tweetId, menuTarget.tweet.canonicalUrl, { newTab: true });
            }
```

- [ ] **Step 4：侧边栏的顶栏、进入与切回**

把 `src/sidepanel/SidePanelApp.tsx` 整个替换为：

```tsx
import { useEffect, useState } from 'preact/hooks';
import type { FolderId } from '@/core/domain/folder';
import type { FolderStore } from '@/state/FolderStore';
import type { ReadingModeStore } from '@/state/ReadingModeStore';
import { FolderViewApp } from '@/ui/folder-view/FolderViewApp';
import { Icon } from '@/ui/shared/Icon';
import { SidebarApp } from '@/ui/sidebar/SidebarApp';
import { showFolderInPage, takeOverFolder } from './activeTab';
import { openPost } from './openPost';

export interface SidePanelAppProps {
  store: FolderStore;
  reading: ReadingModeStore;
  /** Closes the panel. The page passes `window.close`; tests pass a spy. */
  onLeave: () => void;
}

/**
 * The side panel: the same folder tree and folder list the page uses, stacked
 * under a bar with the way back to the page (work order 2.3).
 *
 * Opening the panel *is* choosing panel mode — the toolbar icon, the entry in
 * X's navigation and the overlay's switch all just open it — so the panel
 * writes the mode itself. Closing it with the browser's own × writes nothing:
 * the mode stays "panel". Opening a post is routed to the X tab beside the
 * panel (see openPost).
 */
export function SidePanelApp(props: SidePanelAppProps): preact.JSX.Element {
  const { store, reading, onLeave } = props;
  const [folderId, setFolderId] = useState<FolderId | null>(null);

  useEffect(() => {
    void store.refresh();
  }, [store]);

  useEffect(() => {
    let alive = true;
    let stopListening: (() => void) | undefined;
    void (async () => {
      // Ask first: switching the mode is what closes the page's overlay.
      const handed = await takeOverFolder();
      if (!alive) return;
      if (handed !== null) {
        // The folder the page was showing — unless the reader already picked one here.
        setFolderId((current) => current ?? handed);
        if (store.state.activeFolderId === null) store.setActiveFolder(handed);
      }
      await reading.set('panel');
      if (!alive) return;
      // From here on, "page" can only mean someone switched back.
      stopListening = reading.subscribe((mode) => {
        if (mode === 'page') onLeave();
      });
    })();
    return () => {
      alive = false;
      stopListening?.();
    };
  }, [store, reading, onLeave]);

  const switchToPage = async (): Promise<void> => {
    // Hand the folder over first: writing the mode is what closes this panel.
    await showFolderInPage(folderId);
    await reading.set('page');
    onLeave();
  };

  return (
    <div class="xf-root xf-sp">
      <header class="xf-sp-head">
        <span class="xf-sp-title">帖子文件夹</span>
        <button
          type="button"
          class="xf-fv-switch"
          title="切换阅读模式：回到 X 页面内"
          onClick={() => void switchToPage()}
        >
          <Icon name="sidePanel" size={16} />
          <span>切换到页面内</span>
        </button>
      </header>
      <div class="xf-sp-tree">
        <SidebarApp store={store} mode="wide" onOpenFolder={setFolderId} />
      </div>
      <div class="xf-sp-view">
        {folderId === null ? (
          <div class="xf-fv-state">选择一个文件夹查看收藏。</div>
        ) : (
          <FolderViewApp
            store={store}
            folderId={folderId}
            onClose={() => setFolderId(null)}
            onMembershipChanged={() => {}}
            onOpenPost={(url, options) => void openPost(url, options)}
          />
        )}
      </div>
    </div>
  );
}
```

`src/sidepanel/styles.ts`：在样式字符串里 `.xf-sp { display: flex; flex-direction: column; height: 100%; }` 这一行后面加两行：

```css
.xf-sp-head { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 6px 12px; border-bottom: 1px solid var(--xf-border); }
.xf-sp-title { min-width: 0; font-size: 15px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

把 `src/entrypoints/sidepanel/main.tsx` 整个替换为：

```tsx
import { render } from 'preact';
import { SidePanelApp } from '@/sidepanel/SidePanelApp';
import { mountSidePanelStyles } from '@/sidepanel/styles';
import { FolderStore } from '@/state/FolderStore';
import { ReadingModeStore } from '@/state/ReadingModeStore';
import { CleanupRegistry } from '@/utils/cleanup';
import { applyStoredLogLevel } from '@/utils/logger';

void applyStoredLogLevel();

const registry = new CleanupRegistry();
const store = new FolderStore();
// Same change channel the content scripts use, so a save in any X tab shows
// up here without a refresh.
store.attach(registry);
const reading = new ReadingModeStore();
// So this panel hears a switch back to the page made in another window.
reading.attach(registry);
mountSidePanelStyles(document);

const app = document.getElementById('app');
if (app !== null) {
  render(<SidePanelApp store={store} reading={reading} onLeave={() => window.close()} />, app);
}

window.addEventListener('pagehide', () => registry.dispose());
```

- [ ] **Step 5：运行，确认通过**

Run: `pnpm vitest run tests/unit/side-panel-app.test.tsx tests/unit/folder-view.test.tsx tests/unit/folder-view-restore.test.tsx tests/unit/switch-mode-button.test.tsx`
Expected: PASS。

- [ ] **Step 6：全量检查（含端到端）并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e
```

Expected: 全部成功；单元测试 `Tests  354 passed`（349 + 5）；端到端 `13 passed`——现有用例里把侧边栏页面当标签页打开的那几条不受影响（它们在打开之前就已经检查完页面内的列表）。

```bash
git add src/sidepanel/SidePanelApp.tsx src/sidepanel/styles.ts src/entrypoints/sidepanel/main.tsx src/ui/folder-view/FolderViewApp.tsx src/ui/folder-view/SavedTweetCard.tsx src/ui/folder-view/folderView.css.ts tests/unit/side-panel-app.test.tsx
git commit -m "侧边栏完整版：打开即进入侧边栏模式并接管文件夹，顶栏「切换到页面内」，高亮刚点开的卡片"
git push origin main
```

---

### Task 10：端到端测试

**Files:**
- Create: `tests/e2e/actions.ts`
- Create: `tests/e2e/reading-modes.spec.ts`
- Modify: `tests/e2e/rich-card.spec.ts`

真正的侧边栏是浏览器界面，Playwright 进不去；但 2026-10-01 实测：点页面里的按钮，侧边栏**真的会打开**并运行，从后台能看到它在不在。所以「页面 → 侧边栏」这一段用真侧边栏测；侧边栏里的按钮，用「把同一个页面当普通标签页打开」来点。

- [ ] **Step 1：把端到端测试共用的操作抽出来**

新建 `tests/e2e/actions.ts`（五个函数原样来自 `rich-card.spec.ts`）：

```ts
import type { Locator, Page } from '@playwright/test';
import { expect } from './harness';

/** Waits until the content script has put its buttons on the page's posts. */
export async function ready(page: Page): Promise<void> {
  await expect
    .poll(() => page.locator('[data-xf-action-host]').count(), { timeout: 3_000 })
    .toBeGreaterThan(0);
}

/** Creates a root folder from the tree in X's navigation. */
export async function createFolder(page: Page, name: string): Promise<void> {
  const sidebar = page.locator('[data-xf-sidebar-host]');
  await sidebar.getByRole('button', { name: '新建文件夹' }).click();
  const input = sidebar.getByPlaceholder('文件夹名称');
  await input.fill(name);
  await input.press('Enter');
  await expect(sidebar.getByRole('button', { name, exact: true })).toBeVisible();
}

/** The id of the first post whose article contains `selector`. */
export async function postWith(
  page: Page,
  selector: string,
  options: { ownOnly?: boolean } = {},
): Promise<string> {
  // ownOnly: the post itself has it, not merely the post it quotes.
  const noQuote = options.ownOnly === true ? ':not(:has(div[role="link"][tabindex="0"]))' : '';
  const host = page
    .locator(`article[data-testid="tweet"]:has(${selector})${noQuote} [data-xf-action-host]`)
    .first();
  await expect(host).toHaveCount(1);
  const id = await host.getAttribute('data-xf-tweet-id');
  if (id === null) throw new Error(`no post with ${selector}`);
  return id;
}

/** Saves a post into a folder through its own button and the popover. */
export async function saveInto(page: Page, tweetId: string, folder: string): Promise<void> {
  await page.locator(`[data-xf-action-host][data-xf-tweet-id="${tweetId}"] button`).click();
  const popover = page.locator('[data-xf-popover-host]');
  await popover.getByRole('menuitemcheckbox', { name: folder, exact: true }).first().click();
  await expect(popover).toHaveCount(0);
}

/** Opens a folder from the tree and returns the overlay's host. */
export async function openFolder(page: Page, folder: string): Promise<Locator> {
  await page.locator('[data-xf-sidebar-host]').getByRole('button', { name: folder, exact: true }).click();
  return page.locator('[data-xf-overlay-host]');
}
```

`tests/e2e/rich-card.spec.ts`：删除文件里这五个函数的本地定义（`ready`、`createFolder`、`postWith`、`saveInto`、`openFolder`），并把文件开头的

```ts
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './harness';
```

改成

```ts
import { createFolder, openFolder, postWith, ready, saveInto } from './actions';
import { expect, test } from './harness';
```

Run: `pnpm build:e2e && pnpm exec playwright test tests/e2e/rich-card.spec.ts`
Expected: `5 passed`（只是搬家，行为不变）。

- [ ] **Step 2：写阅读模式的端到端测试**

新建 `tests/e2e/reading-modes.spec.ts`：

```ts
import type { Locator, Page } from '@playwright/test';
import { createFolder, openFolder, postWith, ready, saveInto } from './actions';
import { expect, test, type Harness } from './harness';

const RICH = '/home?fixture=home-rich';
const MODE_KEY = 'xf:reading-mode';

/** How many side panels the browser has open for the extension. */
function openPanels(harness: Harness): Promise<number> {
  return harness.worker.evaluate(async () => {
    const contexts = await chrome.runtime.getContexts({});
    return contexts.filter((context) => String(context.contextType) === 'SIDE_PANEL').length;
  });
}

function storedMode(harness: Harness): Promise<unknown> {
  return harness.worker.evaluate(async (key) => (await chrome.storage.local.get(key))[key], MODE_KEY);
}

/** Sends `message` to the active tab's content script, as the side panel does. */
function askActiveTab(harness: Harness, message: unknown): Promise<unknown> {
  return harness.worker.evaluate(async (payload) => {
    const [tab] = await chrome.tabs.query({ active: true });
    return tab?.id === undefined ? null : chrome.tabs.sendMessage(tab.id, payload);
  }, message);
}

/** How far below the list's top edge a row starts (negative: it has scrolled past). */
function rowOffset(overlay: Locator, tweetId: string): Promise<number | null> {
  return overlay.evaluate((host, id) => {
    const list = host.shadowRoot?.querySelector('.xf-fv-list');
    const row = host.shadowRoot?.querySelector(`[data-xf-tweet-id="${id}"]`);
    if (!list || !row) return null;
    return Math.round(row.getBoundingClientRect().top - list.getBoundingClientRect().top);
  }, tweetId);
}

/** True when the row starts 10px below the list's top edge, give or take a rounded pixel. */
async function atTenPixels(overlay: Locator, tweetId: string): Promise<boolean> {
  const offset = await rowOffset(overlay, tweetId);
  return offset !== null && Math.abs(offset - 10) <= 1;
}

/**
 * Six posts saved into one folder, the folder open, and its list scrolled so
 * that the third row starts 10px below the list's top edge.
 */
async function scrolledList(page: Page): Promise<{ overlay: Locator; third: string }> {
  await page.setViewportSize({ width: 1280, height: 600 });
  await ready(page);
  await createFolder(page, '返回');
  const ids = await page
    .locator('[data-xf-action-host]')
    .evaluateAll((hosts) => hosts.slice(0, 6).map((host) => host.getAttribute('data-xf-tweet-id') ?? ''));
  for (const id of ids) await saveInto(page, id, '返回');

  const overlay = await openFolder(page, '返回');
  await expect(overlay.locator('.xf-fv-row')).toHaveCount(6);
  const third = await overlay.locator('.xf-fv-row').nth(2).getAttribute('data-xf-tweet-id');
  if (third === null) throw new Error('row without a post id');
  await overlay.evaluate((host, id) => {
    const list = host.shadowRoot?.querySelector('.xf-fv-list');
    const row = host.shadowRoot?.querySelector(`[data-xf-tweet-id="${id}"]`);
    if (!list || !row) throw new Error('list not rendered');
    list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - 10;
  }, third);
  expect(await atTenPixels(overlay, third)).toBe(true);
  return { overlay, third };
}

/** Puts a mark on the page that only a full page load can remove. */
async function markPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __xfSamePage?: boolean }).__xfSamePage = true;
  });
}

function stillSamePage(page: Page): Promise<boolean> {
  return (
    page
      .evaluate(() => (window as unknown as { __xfSamePage?: boolean }).__xfSamePage === true)
      // A destroyed execution context means the page is being replaced.
      .catch(() => false)
  );
}

async function expectListBack(page: Page, third: string): Promise<void> {
  const overlay = page.locator('[data-xf-overlay-host]');
  await expect(overlay.locator('.xf-fv-name')).toHaveText('返回');
  await expect(overlay.locator('.xf-fv-row')).toHaveCount(6);
  await expect.poll(() => atTenPixels(overlay, third)).toBe(true);
}

test('switching to the side panel moves reading there; switching back restores the page', async ({
  harness,
}) => {
  const page = await harness.openX(RICH);
  await ready(page);
  await createFolder(page, 'AI');
  await saveInto(page, await postWith(page, '[data-testid="tweetText"]'), 'AI');
  const overlay = await openFolder(page, 'AI');
  await expect(overlay.locator('.xf-fv-row')).toHaveCount(1);
  expect(await storedMode(harness)).toBeUndefined();

  // A real click, so the browser really opens its side panel.
  await overlay.getByRole('button', { name: '切换到侧边栏' }).click();
  await expect.poll(() => openPanels(harness)).toBe(1);

  // The panel took over: the overlay is gone, and the tree gave way to one entry.
  const sidebar = page.locator('[data-xf-sidebar-host]');
  await expect(page.locator('[data-xf-overlay-host]')).toHaveCount(0);
  await expect(sidebar).toHaveAttribute('data-xf-reading', 'panel');
  await expect(sidebar).toHaveCount(1);
  await expect(sidebar.getByRole('button', { name: '我的收藏' })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'AI', exact: true })).toHaveCount(0);
  expect(await storedMode(harness)).toBe('panel');

  // Playwright cannot reach inside the real panel; the same page in a tab can be driven.
  const panel = await harness.context.newPage();
  await panel.goto(`chrome-extension://${harness.extensionId}/sidepanel.html`);
  await panel
    .getByRole('button', { name: '切换到页面内' })
    .click()
    .catch((error: unknown) => {
      // The click closes this page, which Playwright may report as the click failing.
      if (!panel.isClosed()) throw error;
    });

  await expect(sidebar).toHaveAttribute('data-xf-reading', 'page');
  await expect(sidebar.getByRole('button', { name: 'AI', exact: true })).toBeVisible();
  expect(await storedMode(harness)).toBe('page');
  // The real panel heard the switch and closed itself.
  await expect.poll(() => openPanels(harness)).toBe(0);
});

test('in panel mode, the entry in X’s navigation opens the side panel', async ({ harness }) => {
  const page = await harness.openX('/home');
  const sidebar = page.locator('[data-xf-sidebar-host]');
  await expect(sidebar).toHaveAttribute('data-xf-reading', 'page');

  // As after closing the panel with its own ×: the mode stays, the panel is gone.
  await harness.worker.evaluate((key) => chrome.storage.local.set({ [key]: 'panel' }), MODE_KEY);
  await expect(sidebar).toHaveAttribute('data-xf-reading', 'panel');
  expect(await openPanels(harness)).toBe(0);

  await sidebar.getByRole('button', { name: '我的收藏' }).click();
  await expect.poll(() => openPanels(harness)).toBe(1);
  await expect(sidebar).toHaveCount(1);
  expect(await storedMode(harness)).toBe('panel');
});

test('the page hands its folder to the panel, and opens the one the panel hands back', async ({
  harness,
}) => {
  const page = await harness.openX(RICH);
  await ready(page);
  await createFolder(page, 'AI');
  const overlay = await openFolder(page, 'AI');
  await expect(overlay).toHaveCount(1);

  const handed = (await askActiveTab(harness, { kind: 'xf:hand-over' })) as {
    ok: boolean;
    folderId: string | null;
  };
  expect(handed.ok).toBe(true);
  expect(handed.folderId).toEqual(expect.any(String));

  await overlay.getByRole('button', { name: '关闭文件夹' }).click();
  await expect(page.locator('[data-xf-overlay-host]')).toHaveCount(0);
  expect(await askActiveTab(harness, { kind: 'xf:hand-over' })).toEqual({ ok: true, folderId: null });

  expect(
    await askActiveTab(harness, { kind: 'xf:open-folder', folderId: handed.folderId }),
  ).toEqual({ ok: true });
  await expect(page.locator('[data-xf-overlay-host] .xf-fv-name')).toHaveText('AI');
});

test('back brings the list back where it was, when the page was switched in place', async ({
  harness,
}) => {
  const page = await harness.openX(RICH);
  const { overlay, third } = await scrolledList(page);
  await markPage(page);

  await overlay.locator(`[data-xf-tweet-id="${third}"] .xf-tc-name`).first().click();
  await expect(page).toHaveURL(new RegExp(`/status/${third}$`));
  await expect(page.locator('[data-xf-overlay-host]')).toHaveCount(0);

  // Well inside the 3s the fallback waits: this is "back" after an in-page switch.
  await page.goBack();
  await expect(page).toHaveURL(/\/home/);
  expect(await stillSamePage(page)).toBe(true);
  await expectListBack(page, third);
});

test('back brings the list back after the post was loaded as a full page', async ({ harness }) => {
  const page = await harness.openX(RICH);
  const { overlay, third } = await scrolledList(page);
  await markPage(page);

  await overlay.locator(`[data-xf-tweet-id="${third}"] .xf-tc-name`).first().click();
  // The sample page has no router to answer the switch, so after 3s the
  // address is loaded in full — the fallback, and a brand-new content script.
  await expect.poll(() => stillSamePage(page), { timeout: 10_000 }).toBe(false);
  await expect(page).toHaveURL(new RegExp(`/status/${third}$`));

  await page.goBack();
  await expect(page).toHaveURL(/\/home/);
  await expectListBack(page, third);
});
```

- [ ] **Step 3：运行**

Run: `pnpm typecheck && pnpm lint && pnpm test:e2e`
Expected: 全部成功；端到端 `18 passed`（原 13 + 新 5）。

任何一条不过：按 superpowers:systematic-debugging 找根因。产品代码的缺陷先补一条能复现它的单元测试再修；测试自身的问题（等待条件、选择器）改测试。不许为了让测试变绿而放宽断言。（2026-10-01 演练时这 18 条在本机全部通过，包括「真侧边栏听到切换后自己关闭」。）

- [ ] **Step 4：提交**

```bash
git add tests/e2e/actions.ts tests/e2e/reading-modes.spec.ts tests/e2e/rich-card.spec.ts
git commit -m "端到端测试：阅读模式切换、交接文件夹、返回恢复"
git push origin main
```

---

### Task 11：真实 X 检查（需要你配合）

真侧边栏里的点击、浏览器工具栏图标、侧边栏的 ×，Claude in Chrome 都碰不到——这几步需要你动手，我在旁边看 X 页面的反应。整个检查大约 10–15 分钟。

- [ ] **Step 1：构建并请你重新加载扩展**

```bash
pnpm build
```

请你：在 `chrome://extensions` 里点 X Folders 的「重新加载」（不要卸载）；如果侧边栏开着，先关掉；然后把测试用的 X 标签页刷新一次，并让它所在的 Chrome 窗口显示在最前面。

- [ ] **Step 2：征得同意后逐项检查**

只点插件自己的界面和帖子卡片；不点赞、不转帖、不书签、不发帖、不改设置。用上次留下的「M2 测试」文件夹（5 条：带图、视频、引用、链接卡片、长帖）。

| # | 检查 | 谁动手 | 通过标准 |
|---|---|---|---|
| 1 | **页面内切换**（最关键） | 我 | 先把列表滚到中间，在页面上放一个只有整页加载才会消失的标记，再点一张卡片：X 换到原帖页，标记还在（没有整页刷新）。同时记下从点击到原帖主帖出现用了多久，至少 3 次 |
| 2 | 返回恢复 | 我 | 按浏览器「返回」：收藏列表自动回来，同一个文件夹，刚才最上面那条帖子还在原位 |
| 3 | 通过 X 自己的链接离开 | 我 | 列表开着时点 X 左栏的「探索」，再按「返回」：列表不恢复 |
| 4 | ⌘ 点卡片 | 我 | 新标签页打开原帖，原标签页的列表不动 |
| 5 | 长帖折叠 / 展开 | 我 | 那条已补全的长帖在卡片里是折叠的，末尾「…显示更多」；点它在卡片内展开，地址不变、列表不关 |
| 6 | 切换到侧边栏 | 我点按钮，你看侧边栏 | 点列表顶部「切换到侧边栏」：侧边栏打开并显示**同一个文件夹**（你确认）；页面上的列表关闭；X 左栏的文件夹树变成一个「我的收藏」入口 |
| 7 | 侧边栏里点卡片 | 你点，我看页面 | X 标签页换到原帖（标记还在，没有整页刷新）；侧边栏不动，刚点的卡片高亮；接着点下一条也一样 |
| 8 | 侧边栏模式下保存 | 我点帖子上的按钮，你看侧边栏 | 保存弹层和以前一样；存进正在看的文件夹后，侧边栏列表很快多出这一条 |
| 9 | × 关闭后仍是侧边栏模式 | 你点 ×，我看页面 | X 左栏仍是入口；我点入口，侧边栏重新打开 |
| 10 | 工具栏图标 | 你 | 侧边栏关着时点浏览器工具栏上的扩展图标：侧边栏打开 |
| 11 | 切换到页面内 | 你点，我看页面 | 侧边栏点「切换到页面内」：侧边栏关闭；X 页面打开**同一个文件夹**的列表；左栏的文件夹树回来 |
| 12 | 页面内模式下点工具栏图标 | 你点，我看页面 | 侧边栏打开，页面自动变成侧边栏模式（列表关闭、左栏变入口） |
| 13 | 记住选择 | 我 | 侧边栏模式下刷新 X 页面：左栏仍是入口。切回页面内后再刷新：左栏是文件夹树 |
| 14 | 不是 X 的标签页 | 你 | 侧边栏模式下切到一个不是 X 的标签页，在侧边栏里点卡片：新标签页打开原帖 |

检查结束后问你想停在哪种模式，并切到那种模式。

**第 1 项不通过时（标记消失，说明 3 秒后走了整页加载）：停下来。** 不改代码，先把现象如实告诉你，并说明备选方案：把「改地址、发信号」这两行放进一小段运行在页面里的脚本，由内容脚本通知它执行（不需要新权限，但页面里会多一段我们的代码）。你同意后才做，并补一个任务。

- [ ] **Step 3：如实记录**

`docs/manual-qa.md` 末尾追加一节 `## M3 两种阅读模式（执行日期，真实登录态 x.com，Chrome 版本号，macOS）`，结构同 M1、M2：

- 执行方式（哪些步骤由你操作并确认）；
- 检查表：上面 14 项，每项的结果只写「通过」「未通过（现象）」或「未验证（原因）」，附证据 / 备注；
- 实测数据：第 1 项记录的耗时；
- 发现的缺陷与修复提交、复验结果；
- 尚未验证的项目。

- [ ] **Step 4：缺陷处理**

每个缺陷：先写能复现它的自动化测试（单元或端到端）→ 修复 → 全量检查 → 单独提交 → 请你重新加载后复验，结果补进 manual-qa。

如果实测耗时显示 3 秒的兜底时间不合适（X 正常换页也经常超过 2 秒），调整 `src/hosts/x/navigateInPage.ts` 里的 `IN_PAGE_TIMEOUT_MS`，在注释里写上实测依据，作为一次单独的提交。

- [ ] **Step 5：提交记录**

```bash
git add docs/manual-qa.md
git commit -m "记录 M3 真实 X 检查结果"
git push origin main
```

---

### Task 12：M3 收尾

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/privacy.md`
- Modify: `docs/architecture.md`
- Modify: `docs/selector-playbook.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-28-folders-for-x-v0.2-design.md`
- Modify: `docs/manual-qa.md`

下面的文字按「Task 11 全部通过」来写。**动笔前逐条对照 Task 11 的实际结果：没有做到的不写，做到一半的如实写。**

- [ ] **Step 1：更新日志**

`CHANGELOG.md` 的 `## [未发布]`：

把「新增」里的这两条

```markdown
- Chrome 侧边栏：文件夹树与收藏列表；点帖子在旁边的 X 标签页打开。
- 收藏列表标题栏「在侧边栏中打开」按钮。
```

替换为

```markdown
- 两种阅读模式：页面内（默认）与 Chrome 侧边栏。侧边栏里是同一套文件夹树和收藏列表；点帖子在旁边的 X 标签页打开，侧边栏不动，刚点开的卡片会高亮。
- 一键切换阅读模式并记住选择：收藏列表顶部「切换到侧边栏」，侧边栏顶部「切换到页面内」，切换时带上正在看的文件夹；点浏览器工具栏图标打开侧边栏，也等于切到侧边栏模式。
- 侧边栏模式下 X 左栏只保留「我的收藏」入口，点它重新打开侧边栏；用侧边栏自带的 × 关闭后仍是侧边栏模式。
```

在「新增」的末尾追加

```markdown
- 页面内模式：点卡片看完原帖后按浏览器「返回」，收藏列表自动回来，还是原来的文件夹和位置。
- 已补全的长帖在卡片里先折叠，点「显示更多」就地展开，不跳转。
```

在「新增」和「安全」之间加一个小节

```markdown
### 变更

- 点卡片打开原帖改为 X 页面内切换，和点 X 自己的链接一样，不再整页重新加载；X 在 3 秒内没有换页时自动整页加载。
```

- [ ] **Step 2：隐私说明**

`docs/privacy.md`：

① 在 `### meta（主键 key）` 那一段之后、`## 不存什么` 之前，加一节：

```markdown
### 数据库以外的两条小记录

- **阅读模式**：`chrome.storage.local` 的 `xf:reading-mode`，值是 `page`（页面内）或 `panel`（侧边栏）。只记你选了
  哪种模式。
- **返回位置**：页面内模式下点卡片去看原帖时，记下「刚才在哪个文件夹、列表最上面是哪条帖子、它滚出去多少、
  当时加载了多少条」，供按浏览器「返回」时把收藏列表放回原处。它存在 `chrome.storage.session` 的 `xf:return`
  里：只在内存中，关闭浏览器即清除；最多保留最近 20 条；恢复一次后即删除。内容只有文件夹 id、帖子 id 和几个
  数字，没有正文、作者或文件夹名。x.com 页面上的脚本读不到它（没有使用页面自己的 sessionStorage）。
```

② `## 权限说明` 里 `storage` 那一条的末尾（「见 `src/background/services/ChangeBroadcaster.ts` 的说明）。」之后）加一句：

```markdown
  上面「数据库以外的两条小记录」也用这项权限。`chrome.storage.session` 默认不对内容脚本开放，后台启动时把它开放
  给本扩展自己的内容脚本（`src/background/sessionStorage.ts`）；这不是一项新权限，也不会让其他扩展或网页读到它。
```

③ `## 如何删除数据` 的第一条末尾加一句：

```markdown
  阅读模式的选择也在其中；返回位置只在内存里，关闭浏览器就没有了。
```

④ 把 `## 变更` 下面的第一段替换为：

```markdown
本文件描述的是 **v0.2 开发中的版本（M3：两种阅读模式，执行日期）**。与 v0.1.0 相比：帖子记录从「只有正文」变为
上面的快照（多了头像、认证、发帖时间、正文片段、媒体地址、引用帖、链接卡片、截断标记）；收藏列表会显示来自 X
图片服务器的图片；新增 `sidePanel` 权限与侧边栏页面；新增阅读模式与返回位置两条小记录（见「存了什么」）。行为
变化时本文件会随之更新。
```

（「执行日期」换成当天日期。）

- [ ] **Step 3：架构说明**

`docs/architecture.md`：

① 第 7 节「路由」小节的末尾加一段：

```markdown
打开一条收藏的原帖也不进入主世界：内容脚本自己调用 `history.pushState`，再向 `window` 发一个 `popstate` 事件，X 的
路由就在页面内换页（`navigateInPage.ts`）。3 秒内目标帖没有出现，就整页加载兜底。
```

② 把 `## 9. 清理` 改成 `## 10. 清理`，并在它前面插入新的第 9 节：

```markdown
## 9. 两种阅读模式

| 事情 | 做法 | 为什么 |
|---|---|---|
| 记住选了哪种模式 | `chrome.storage.local` 的 `xf:reading-mode`；`ReadingModeStore` 读写并监听 `storage.onChanged` | 后台不留状态；任何一处切换，各 X 标签页和侧边栏立即跟上 |
| 进入侧边栏模式 | 侧边栏页面一加载就把模式写成 `panel` | 工具栏图标、X 左栏入口、收藏列表的切换按钮三个入口，结果必须一样；页面这一侧只负责「打开侧边栏」 |
| 回到页面内模式 | 侧边栏顶部按钮写回 `page`；每个侧边栏听到后关闭自己 | 工单 2.3：这是唯一的切回方式 |
| 切换时带上文件夹 | 侧边栏给当前标签页的内容脚本发消息：`xf:hand-over`（接管）、`xf:open-folder`（交还），都在写模式**之前** | 写模式会关掉覆盖层（或侧边栏自己），问晚了就问不到；给当前窗口的活动标签页发消息不需要 `tabs` 权限 |
| X 页面跟随模式 | 侧边栏模式：关闭覆盖层，左栏的文件夹树换成一个入口（`SidebarMount` 按模式重建） | 模式存储是唯一事实来源，页面只听它 |
| 返回恢复 | 点卡片离开前，把「文件夹 + 最上面那条帖子 + 偏移」按历史条目（`navigation.currentEntry.key`）记在 `chrome.storage.session`；回到该条目时取出、恢复一次 | 条目标识在整页加载后不变，所以不依赖内容脚本的内存；会话存储只在内存里，X 的脚本读不到 |

---
```

- [ ] **Step 4：选择器手册、README、工单**

`docs/selector-playbook.md` 末尾追加：

```markdown
## 6. 页面内切换与返回恢复（M3）

- **没有新增选择器。** 判断「X 是否已经换到目标帖」用的是 `focusedTweet`（`article[tabindex="-1"]`）里那条带
  `<time>` 的永久链接，沿用 2.4 的统一规则（`navigateInPage.ts` 的 `showsPost`）。
- 换页信号是 `history.pushState` + 一个 `popstate` 事件，从内容脚本发出即可（实测日期与耗时见
  `docs/manual-qa.md` 的 M3 一节）。
- **X 改版后的症状**：点卡片后地址变了、页面不动，约 3 秒后整页加载。打开 debug 日志能看到
  `X did not switch pages; loading in full`。先确认 `focusedTweet` 和永久链接的结构有没有变（跑
  `tests/unit/navigate-in-page.test.ts` 与详情页样本的提取测试），再看 X 的路由是否还响应 `popstate`。
```

`README.md` 的「特性」列表：在 `- Folder View 覆盖主内容列，按保存时间倒序分页浏览（每页 50 条）` 后面加两条：

```markdown
- 两种阅读模式：页面内（默认）与 Chrome 侧边栏，一键切换并记住选择
- 点卡片像点 X 自己的链接一样打开原帖；看完按浏览器「返回」，收藏列表回到原处
```

工单 `docs/superpowers/specs/2026-09-28-folders-for-x-v0.2-design.md`：

① 第 7 节修订说明的表格末尾加一行：

```markdown
| 18 | （M3 实现时）2.3 只写了「『切换阅读模式』按钮」，没有规定按钮上的字，也没有规定侧边栏模式下左栏入口的位置 | 按钮上的字用效果图的「切换到侧边栏 / 切换到页面内」，悬停提示写「切换阅读模式」；入口放在原文件夹树的位置。切换时「带上搜索词」随搜索在 M4 实现 |
```

② 附录 A 第 14 条的末尾补一句（按 Task 11 第 1 项的实际结果写）：

```markdown
从内容脚本（隔离世界）发出同样有效，不需要往页面里注入脚本（M3 实测，日期见 manual-qa）。
```

③ 附录 B 的末尾加三条：

```markdown
8. `chrome.storage.session` 默认不对内容脚本开放（报错「Access to storage is not allowed from this context.」）；后台调用一次 `setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })` 之后可以读写（2026-10-01 实测）。
9. 内容脚本能读 `navigation.currentEntry.key`；同一个历史条目，页面内返回和整页加载后再返回，标识都不变（2026-10-01 实测）。
10. 侧边栏页面给「当前窗口的活动标签页」发 `tabs.sendMessage` 不需要 `tabs` 权限；侧边栏用 `window.close()` 关闭自己。用 Playwright 点页面里的按钮能真的打开侧边栏，`chrome.runtime.getContexts` 里看得到（2026-10-01 实测）。
```

- [ ] **Step 5：手工验收记录补「尚未验证」**

在 `docs/manual-qa.md` 的 M3 一节末尾，「尚未验证」里至少列出（已在 Task 11 里验证过的不列）：

```markdown
- 暗淡 / 熄灯主题下切换按钮、左栏入口、高亮卡片的配色；
- 两个浏览器窗口各开一个侧边栏时的切换；
- 整页加载兜底之后的返回恢复（只由端到端测试在样本页面上覆盖）；
- Microsoft Edge。
```

- [ ] **Step 6：最终全量检查**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm build && pnpm zip
```

Expected: 全部成功；单元测试 `Tests  354 passed`（如果 Task 11 修过缺陷，会更多）；端到端 `18 passed`；`dist/chrome-mv3/manifest.json` 的 `permissions` 仍然只有 `storage`、`unlimitedStorage`、`sidePanel`：

```bash
node -e "console.log(require('./dist/chrome-mv3/manifest.json').permissions)"
```

Expected: `[ 'storage', 'unlimitedStorage', 'sidePanel' ]`（顺序可能不同，项目必须只有这三个）。

- [ ] **Step 7：提交**

```bash
git add CHANGELOG.md README.md docs/privacy.md docs/architecture.md docs/selector-playbook.md docs/manual-qa.md docs/superpowers/specs/2026-09-28-folders-for-x-v0.2-design.md
git commit -m "M3 收尾：更新日志、隐私说明、架构说明、选择器手册与工单附录"
git push origin main
```

- [ ] **Step 8：向你报告**

按工单 4.3 的结构写 M3 的小结：做了什么、四层验证各自的结果（命令、通过数）、真实 X 上验证了什么、只在样本上验证了什么、没验证什么及原因、已知限制。然后说明下一步是 M4（搜索，含「切换与返回时带上搜索词」），照旧先写计划给你看。

---

## 自查记录

**工单覆盖：**

| 工单条目 | 落在哪 |
|---|---|
| 2.3 页面内：左栏文件夹树、窄屏图标、覆盖层、每页 50 条 | M1 已有，本计划不动 |
| 2.3 页面内：顶部「切换阅读模式」按钮 | Task 8 |
| 2.3 页面内：点卡片用 X 页面内切换，不整页加载 | Task 2；真实 X 上由 Task 11 第 1 项确认 |
| 2.3 页面内：按「返回」恢复文件夹和滚动位置 | Task 4、5、6；端到端 Task 10 |
| 2.3 页面内：通过 X 自己的导航离开，不恢复 | Task 6（测试用例）；Task 11 第 3 项 |
| 2.3 侧边栏：树和列表在侧边栏、点卡片侧边栏不动、非 X 标签页新开 | M1 已有；点卡片改用页面内切换见 Task 2 |
| 2.3 侧边栏：顶部「切换阅读模式」按钮 | Task 9 |
| 2.3 侧边栏：X 左栏只留入口，点它打开侧边栏；工具栏图标也能打开 | Task 8（入口）；工具栏图标 M1 已有 |
| 2.3 侧边栏：× 关闭后仍是侧边栏模式 | Task 9（关闭时不写模式）；Task 10 第 2 个用例 |
| 2.3 切换：两个按钮是切回页面内的唯一方式 | Task 8、9 |
| 2.3 切换：页面内模式下点工具栏图标 = 切到侧边栏 | Task 9（侧边栏打开即写模式）；Task 11 第 12 项 |
| 2.3 切换：带上当前文件夹 | Task 7、9 |
| 2.3 切换：记住选择，默认页面内 | Task 1 |
| 2.4 已补全的长帖折叠 / 就地展开；未补全的打开原帖 | Task 3 |
| 3.1 阅读模式偏好存在扩展存储，一处切换各处生效 | Task 1、8、9 |
| 3.4 返回状态只存在浏览器会话里，不依赖内容脚本内存 | Task 4、6；Task 10 第 5 个用例（整页加载后返回） |
| 3.4 侧边栏点卡片不依赖敏感权限 | Task 7（沿用向活动标签页发消息） |
| 3.5 权限不变 | Task 12 Step 6 检查 |
| 搜索框、带上搜索词（2.3、2.5） | 不在本里程碑：M4 |
| 「⋯」菜单里的导出 / 导入入口（2.3） | 不在本里程碑：M5 |

**没有占位：** 每个改代码的步骤都给出了完整代码；Task 11、12 里需要按实际结果填写的地方（检查结果、实测耗时、日期）都写明了填什么、从哪来。

**名称一致性：** `ReadingModeStore`（`mode` / `loaded` / `subscribe` / `attach` / `load` / `set`）、`navigateInPage` / `onPostPage` / `showsPost`、`collapseSegments` / `weightedLength`、`currentEntryKey`、`rememberReturn` / `takeReturn` / `ReturnState`、`ViewPosition` / `readViewPosition` / `applyViewPosition` / `TOP_OF_LIST`、`LeftForPost` / `onLeaveForPost`、`listenForPanelRequests`、`askActiveTab` / `takeOverFolder` / `showFolderInPage`、`openPanelFromPage`、`PanelEntry`、`XF_ATTR.readingMode`、`onSwitchMode`、`SidePanelAppProps { store, reading, onLeave }` —— 定义处与使用处已逐一核对。

**单元测试数量的推算**（以执行时的实际输出为准）：272 → 281（Task 1）→ 294（Task 2）→ 304（Task 3）→ 313（Task 4）→ 324（Task 5）→ 328（Task 6）→ 340（Task 7）→ 349（Task 8）→ 354（Task 9）。端到端：13 → 18（Task 10）。

---

## 执行方式

按我们一直以来的约定：在本会话里内联执行（superpowers:executing-plans），一次一个任务，每个任务跑通检查后提交并推送，不使用子代理。Task 11 需要你在场。
