# M2 帖子快照与富卡片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保存帖子时记下卡片需要的全部内容（头像、认证、发帖时间、结构化正文、图片 / 视频 / GIF 封面、引用帖、链接卡片、是否被截断）；后台逐字段校验，图片只放行 X 的图片服务器、链接只放行 http(s)；数据库升级到第 2 版并自动迁移旧数据；已保存的帖子再次出现在页面上时补全快照（长帖在详情页看到全文后自动替换）；收藏列表改用尽量还原 X 的富卡片，页面内与侧边栏共用一套组件。同时修掉审查缺陷 3、4，并重新抓取、脱敏一批覆盖媒体与长帖的页面样本。

**Architecture:** 内容脚本的提取按「作者 / 正文 / 媒体与卡片 / 引用」拆成四个小模块，由 `TweetExtractor` 汇总成快照。后台用 `sanitizeSnapshot` 逐字段校验（身份字段不合格就拒绝，其余字段不合格就丢弃该字段），用 `mergeSnapshot` 合并新旧快照（只补全、不退化）。内容脚本新增 `SnapshotRefresher`，把已保存帖子的新快照批量发给新的 `tweets.refresh` 方法。界面新增 `src/ui/tweet-card/` 一套富卡片组件，收藏列表只负责外层（⋯ 菜单、保存日期、打开方式）。

**Tech Stack:** WXT 0.21、TypeScript（严格模式）、Preact、Dexie 4、Vitest + jsdom、Playwright、pnpm。

**依据：**
- 工单 `docs/superpowers/specs/2026-09-28-folders-for-x-v0.2-design.md` 2.4（帖子卡片）、3.2（数据）、3.3 第 2 条（先抓真实页面）
- 审查 `docs/superpowers/reviews/2026-09-28-v0.1.0-code-review.md` 缺陷 3、4
- M1 计划末尾的里程碑表

**全局约定（每个任务都适用）：**
- 所有提交直接在 `main` 上，提交信息用中文，**不加任何 Claude / Anthropic 署名**。每个任务结束时 `git push origin main`。
- 每个任务结束前必须跑通：`pnpm typecheck`、`pnpm lint`、`pnpm test`。
- 需要你配合的步骤（Task 14 抓样本、Task 16 真实 X 检查）先征得同意；下载任何文件前说明文件名、来源和大小。
- 任何测试失败：先用 superpowers:systematic-debugging 找根因，不许猜着改。
- 所有 X 选择器只写在 `src/hosts/x/selectors.ts`。

---

## 2026-09-29 真实页面实测（只读，作为提取代码的依据）

经你同意，在你的 x.com 上只读统计了首页 11 条帖子和 1 个详情页的元素结构。用户名、帖子 ID、正文都没有记录，也没有写进仓库。

| 内容 | 实测结构 |
|---|---|
| 认证标记 | `svg[data-testid="icon-verified"]`，在 `User-Name` 的第一个链接（显示名链接）里；引用块同样在它自己的 `User-Name` 里 |
| 作者行 | `User-Name` = 显示名链接（`a[href="/用户名"]`，内含显示名与认证标记）+ `@用户名` 链接 + `·` + 时间链接（`a[href="/用户名/status/ID"] > time[datetime]`） |
| 头像 | `Tweet-User-Avatar > UserAvatar-Container-用户名 > … a[href="/用户名"]`。图片**懒加载**：后台标签页里还没有 `img`，所以保存那一刻要重新读一次 |
| 视频 | `tweetPhoto > placementTracking > videoPlayer > videoComponent > video[poster]`。封面形如 `https://pbs.twimg.com/amplify_video_thumb/{数字}/img/{文件}.jpg`；`src` 是 `blob:`；同一格里还有 `img[src=封面]` 和同一张图的 `background-image` |
| 引用块 | `div[role="link"][tabindex="0"]`。它的 `User-Name` 里**没有任何链接**：`@用户名` 在 `div[tabindex="-1"]` 里，时间在 `div > time` 里。**引用块里拿不到引用帖的链接**，与 09-03 的记录不同（工单附录 A 第 2 条要更正） |
| 引用块媒体 | `testCondensedMedia > tweetPhoto`（正文左边的小图）；敏感内容被 `previewInterstitial` 遮住时没有图片 |
| 正文 | `tweetText` 里是 `span` 文本和 `a[href="/hashtag/…"]`；旧样本里 `@提及` 是 `a[href="/用户名"]`，表情是 `img[alt]`，换行是 `br` |
| 显示更多 | 旧样本：`button[data-testid="tweet-text-show-more-link"]`，是 `tweetText` 的**兄弟**而不是子元素 |
| 链接卡片 | 旧样本：`card.wrapper` 里有 `card.layoutLarge.media` 或 `card.layoutSmall.media`；今天首页没遇到，内部文字结构由 Task 14 的新样本确认 |
| 详情页主帖 | `article[tabindex="-1"]`；作者行里没有时间，时间在正文下方的永久链接行（与 M1 一致） |

后台标签页不渲染图片，所以头像和图片的实际 `src`、GIF、链接卡片内部、长帖这几项没测到。提取代码按上表写；Task 14 在前台重新抓样本时补齐，并用新样本回归。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `tests/setup.ts` | 修改 | chrome 模拟补 `runtime.getManifest` |
| `src/background/rpc/handlers.ts` | 修改 | 版本号读清单（缺陷 3）；接入 `tweets.refresh` |
| `src/core/domain/folder.ts` | 修改 | 深度按遍历计算，环形脏数据不丢（缺陷 4） |
| `src/background/repositories/FolderRepository.ts` | 修改 | 子孙递归收集（缺陷 4） |
| `src/core/domain/tweet.ts` | 修改 | 快照类型 |
| `src/core/domain/snapshot.ts` | 新建 | 正文拼接、合并规则、旧数据升级、内容比较 |
| `src/utils/url.ts` | 修改 | 图片 / 链接白名单；图片地址规范化与取尺寸 |
| `src/messaging/sanitizeSnapshot.ts` | 新建 | 后台逐字段校验快照 |
| `src/messaging/validate.ts` | 修改 | 保存、刷新改用上一项 |
| `src/background/db/schema.ts`、`migrations.ts`、`XFoldersDatabase.ts` | 修改 / 新建 / 修改 | 数据库第 2 版与迁移 |
| `src/background/repositories/TweetRepository.ts` | 修改 | 合并写入；刷新只改已存在的行 |
| `src/hosts/x/selectors.ts` | 修改 | 头像、认证、显示更多、媒体、卡片、引用媒体的选择器 |
| `src/hosts/x/extractAuthor.ts` | 新建 | 显示名、@用户名、认证、头像、时间 |
| `src/hosts/x/extractText.ts` | 新建 | 正文 → 结构化片段 |
| `src/hosts/x/extractMedia.ts` | 新建 | 图片 / 视频 / GIF；链接卡片 |
| `src/hosts/x/extractQuote.ts` | 新建 | 引用帖 |
| `src/hosts/x/TweetExtractor.ts` | 修改 | 汇总成快照 |
| `src/hosts/x/TweetEnhancer.ts` | 修改 | 保存时重新读取；已保存帖子出现时交给刷新器 |
| `src/hosts/x/SnapshotRefresher.ts` | 新建 | 批量把已保存帖子的新快照发回后台 |
| `src/hosts/x/XRuntime.ts` | 修改 | 接线 |
| `src/core/constants.ts` | 修改 | 刷新批量上限 |
| `src/messaging/protocol.ts`、`RpcClient.ts` | 修改 | `tweets.refresh` 方法与重试白名单 |
| `src/background/services/TweetSaveService.ts` | 修改 | `refresh()` |
| `src/ui/shared/Icon.tsx`、`icons.ts` | 新建 / 修改 | 通用图标组件；播放图标 |
| `src/ui/tweet-card/`（`format.ts`、`SafeImage.tsx`、`Avatar.tsx`、`VerifiedBadge.tsx`、`TweetText.tsx`、`MediaGrid.tsx`、`QuoteBlock.tsx`、`LinkCardView.tsx`、`TweetCard.tsx`、`tweetCard.css.ts`） | 新建 | 富卡片 |
| `src/ui/folder-view/SavedTweetCard.tsx`、`FolderViewApp.tsx`、`folderView.css.ts` | 修改 | 改用富卡片；⋯ 菜单；打开方式由外部传入 |
| `src/hosts/x/FolderViewMount.tsx` | 修改 | 页面内打开帖子；注入卡片样式 |
| `src/sidepanel/SidePanelApp.tsx`、`styles.ts` | 修改 | 侧边栏打开帖子；注入卡片样式 |
| `tools/capture-fixture.js`、`eslint.config.js` | 新建 / 修改 | 浏览器内采集并脱敏页面样本；给它配 lint |
| `tests/fixtures/x-home-rich.html`、`x-status-long.html`、`x-bookmarks.html` | 新建 | 新样本（Task 14 抓取） |
| `tests/helpers/postDom.ts` | 新建 | 按实测结构手写的帖子 DOM |
| `tests/helpers/db.ts`、`fixtures.ts` | 修改 | 快照字段；新样本名 |
| `tests/e2e/harness.ts`、`rich-card.spec.ts` | 修改 / 新建 | 新样本路由、图片应答；富卡片端到端 |
| `tests/unit/*.test.ts(x)` | 新建 / 修改 | 各任务的单元测试 |
| `docs/privacy.md`、`docs/selector-playbook.md`、工单附录 A、`docs/manual-qa.md`、`CHANGELOG.md` | 修改 | 文档 |

---

### Task 1：后台版本号改读清单（审查缺陷 3）

**Files:**
- Modify: `tests/setup.ts:5-24`
- Create: `tests/unit/health-ping.test.ts`
- Modify: `src/background/rpc/handlers.ts:27`

- [ ] **Step 1：给测试环境的 chrome 模拟加上清单**

`tests/setup.ts` 的 `chromeStub.runtime` 里，在 `sendMessage: vi.fn(),` 下面加一行：

```ts
    getManifest: vi.fn(() => ({ manifest_version: 3, name: 'X Folders (test)', version: '0.0.0-test' })),
```

并把文件开头注释的第一句改为：

```ts
 * Minimal `chrome` stub. The extension only touches `storage.local`,
 * `storage.onChanged`, `runtime.sendMessage` and `runtime.getManifest`; anything
 * else is intentionally absent so an accidental new API dependency fails loudly
 * in tests.
```

- [ ] **Step 2：写失败测试**

`tests/unit/health-ping.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { createHandlers } from '@/background/rpc/handlers';

describe('health.ping', () => {
  it('reports the version the manifest declares, not a hard-coded one', async () => {
    const reply = await createHandlers()['health.ping'](undefined);
    expect(reply).toEqual({ ok: true, version: '0.0.0-test' });
  });
});
```

- [ ] **Step 3：运行，确认失败**

Run: `pnpm vitest run tests/unit/health-ping.test.ts`
Expected: FAIL，`expected { ok: true, version: '0.1.0' } to deeply equal { ok: true, version: '0.0.0-test' }`

- [ ] **Step 4：实现**

`src/background/rpc/handlers.ts` 第 27 行改为：

```ts
    // Read from the built manifest, which WXT fills in from package.json.
    'health.ping': async () => ({ ok: true as const, version: chrome.runtime.getManifest().version }),
```

- [ ] **Step 5：运行，确认通过**

Run: `pnpm vitest run tests/unit/health-ping.test.ts`
Expected: PASS

- [ ] **Step 6：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add tests/setup.ts tests/unit/health-ping.test.ts src/background/rpc/handlers.ts
git commit -m "修复后台自报版本号写死为 0.1.0，改读扩展清单"
git push origin main
```

---

### Task 2：文件夹层级不再写死为两层（审查缺陷 4）

**Files:**
- Create: `tests/unit/folder-depth.test.ts`
- Modify: `src/core/domain/folder.ts:27-56`
- Modify: `src/background/repositories/FolderRepository.ts`（`subtreeIds`）

- [ ] **Step 1：写失败测试**

`tests/unit/folder-depth.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { FolderRepository } from '@/background/repositories/FolderRepository';
import { buildFolderTree, flattenTree, type Folder, type FolderWithCount } from '@/core/domain/folder';
import { freshDatabase } from '../helpers/db';

function folder(id: string, parentId: string | null): Folder {
  return { id, name: id, parentId, position: 1000, collapsed: false, createdAt: 1, updatedAt: 1 };
}

function withCount(row: Folder): FolderWithCount {
  return { ...row, tweetCount: 0 };
}

describe('folder depth is not hard-wired to two levels (review defect 4)', () => {
  it('computes each depth by walking down from the roots', () => {
    const tree = buildFolderTree([folder('a', null), folder('b', 'a'), folder('c', 'b')].map(withCount));
    expect(flattenTree(tree).map((node) => [node.id, node.depth])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });

  it('keeps every folder of a corrupted parent cycle', () => {
    const tree = buildFolderTree([folder('r', null), folder('x', 'y'), folder('y', 'x')].map(withCount));
    expect(flattenTree(tree).map((node) => node.id).sort()).toEqual(['r', 'x', 'y']);
  });

  it('collects descendants at any depth and survives a cycle', async () => {
    const db = await freshDatabase();
    await db.folders.bulkAdd([
      folder('a', null),
      folder('b', 'a'),
      folder('c', 'b'),
      folder('z', null),
      folder('p', 'q'),
      folder('q', 'p'),
    ]);
    const repository = new FolderRepository(db);
    expect((await repository.subtreeIds('a')).sort()).toEqual(['a', 'b', 'c']);
    expect((await repository.subtreeIds('p')).sort()).toEqual(['p', 'q']);
    db.close();
  });
});
```

- [ ] **Step 2：运行，确认失败**

Run: `pnpm vitest run tests/unit/folder-depth.test.ts`
Expected: 3 个 FAIL —— `c` 的深度是 1；环里的 `x`、`y` 从树里消失；`subtreeIds('a')` 漏掉 `c`

- [ ] **Step 3：改 `buildFolderTree`**

`src/core/domain/folder.ts` 中把 `buildFolderTree` 整个函数（含上方注释）替换为：

```ts
/**
 * Builds the sibling-ordered tree. Folders whose `parentId` points at a missing
 * folder are treated as roots rather than dropped, so a partially corrupted
 * table still renders instead of silently losing rows.
 *
 * Depth comes from walking down from the roots, not from "has a parent": the
 * tree is not hard-wired to two levels (review defect 4). A parent cycle —
 * possible only in a corrupted table — has no path from any root, so its
 * members would vanish; the cycle is cut and they become roots, like orphans.
 */
export function buildFolderTree(folders: readonly FolderWithCount[]): FolderTreeNode[] {
  const byId = new Map<FolderId, FolderTreeNode>();
  for (const folder of folders) {
    byId.set(folder.id, { ...folder, children: [], depth: 0 });
  }

  const roots: FolderTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId === null ? undefined : byId.get(node.parentId);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }

  const bySortOrder = (a: FolderTreeNode, b: FolderTreeNode): number =>
    a.position - b.position || a.createdAt - b.createdAt || a.id.localeCompare(b.id);

  const placed = new Set<FolderId>();
  const place = (nodes: FolderTreeNode[], depth: number): void => {
    nodes.sort(bySortOrder);
    for (const node of nodes) {
      placed.add(node.id);
      node.depth = depth;
      place(node.children, depth + 1);
    }
  };
  place(roots, 0);

  for (const node of byId.values()) {
    if (placed.has(node.id)) continue;
    const parent = node.parentId === null ? undefined : byId.get(node.parentId);
    if (parent !== undefined) parent.children = parent.children.filter((child) => child !== node);
    roots.push(node);
    place([node], 0);
  }
  roots.sort(bySortOrder);
  return roots;
}
```

- [ ] **Step 4：改 `subtreeIds`**

`src/background/repositories/FolderRepository.ts` 中把 `subtreeIds` 整个方法替换为：

```ts
  /**
   * The folder and all of its descendants, at any depth (review defect 4).
   * A corrupted parent cycle cannot loop: each id is taken once.
   */
  async subtreeIds(folderId: FolderId): Promise<FolderId[]> {
    const all = await this.listAll();
    const childrenOf = new Map<FolderId, FolderId[]>();
    for (const folder of all) {
      if (folder.parentId === null) continue;
      const siblings = childrenOf.get(folder.parentId);
      if (siblings === undefined) childrenOf.set(folder.parentId, [folder.id]);
      else siblings.push(folder.id);
    }

    const ids: FolderId[] = [];
    const seen = new Set<FolderId>();
    const queue: FolderId[] = [folderId];
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index];
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      queue.push(...(childrenOf.get(id) ?? []));
    }
    return ids;
  }
```

- [ ] **Step 5：运行，确认通过**

Run: `pnpm vitest run tests/unit/folder-depth.test.ts tests/unit/folder-crud.test.ts tests/unit/domain-fuzz.test.ts`
Expected: 全部 PASS（后两个确认删除、排序等原有行为没变）

- [ ] **Step 6：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add tests/unit/folder-depth.test.ts src/core/domain/folder.ts src/background/repositories/FolderRepository.ts
git commit -m "修复文件夹深度与子孙计算写死为两层，改为递归并防环"
git push origin main
```

---
### Task 3：快照类型、合并规则与图片 / 链接白名单

**Files:**
- Modify: `src/core/domain/tweet.ts`（整个替换）
- Create: `src/core/domain/snapshot.ts`
- Modify: `src/utils/url.ts`（末尾追加）
- Modify: `tests/helpers/db.ts`（`tweetFixture`）
- Modify: `src/hosts/x/TweetExtractor.ts:158-169`、`src/messaging/validate.ts:68-91`（临时补字段，Task 4、6 会替换）
- Modify: `tests/unit/folder-view.test.tsx:60-80`、`tests/unit/side-panel-app.test.tsx:48-58`、`tests/unit/save-popover.test.tsx:27-35`（测试数据补字段）
- Create: `tests/unit/snapshot.test.ts`、`tests/unit/snapshot-urls.test.ts`

- [ ] **Step 1：写失败测试（合并规则）**

`tests/unit/snapshot.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { mergeSnapshot, sameSnapshot, segmentsToText, upgradeV1Row } from '@/core/domain/snapshot';
import type { MediaItem, QuotedPost, TweetRecord } from '@/core/domain/tweet';
import { tweetFixture } from '../helpers/db';

const PHOTO: MediaItem = { kind: 'photo', url: 'https://pbs.twimg.com/media/A?format=jpg&name=small', alt: null };

function cutShort(text: string): TweetRecord {
  return { ...tweetFixture('1', { text }), truncated: true };
}

describe('segmentsToText', () => {
  it('joins every kind of segment in order', () => {
    expect(
      segmentsToText([
        { kind: 'text', text: 'hi ' },
        { kind: 'mention', text: '@bob', username: 'bob' },
        { kind: 'text', text: ' ' },
        { kind: 'hashtag', text: '#AI', tag: 'AI' },
        { kind: 'emoji', text: '🎉' },
        { kind: 'link', text: 'example.com', url: 'https://t.co/x' },
      ]),
    ).toBe('hi @bob #AI🎉example.com');
  });
});

describe('upgradeV1Row', () => {
  it('fills the snapshot fields of a v1 row and keeps its text as one segment', () => {
    expect(
      upgradeV1Row({
        tweetId: '1',
        canonicalUrl: 'https://x.com/a/status/1',
        username: 'a',
        authorName: 'A',
        text: 'x\ny',
        capturedAt: 1,
        updatedAt: 2,
      }),
    ).toEqual({
      tweetId: '1',
      canonicalUrl: 'https://x.com/a/status/1',
      username: 'a',
      authorName: 'A',
      avatarUrl: null,
      verified: false,
      postedAt: null,
      text: 'x\ny',
      segments: [{ kind: 'text', text: 'x\ny' }],
      media: [],
      quote: null,
      card: null,
      truncated: false,
      capturedAt: 1,
      updatedAt: 2,
    });
  });

  it('changes nothing on a row that is already v2', () => {
    const row: TweetRecord = { ...tweetFixture('1'), media: [PHOTO], truncated: true };
    expect(upgradeV1Row(row)).toEqual(row);
  });
});

describe('mergeSnapshot', () => {
  it('replaces truncated text with the full text', () => {
    const merged = mergeSnapshot(cutShort('short'), tweetFixture('1', { text: 'short and then the rest' }));
    expect(merged.text).toBe('short and then the rest');
    expect(merged.truncated).toBe(false);
  });

  it('never trades full text for a truncated capture', () => {
    const merged = mergeSnapshot(tweetFixture('1', { text: 'the whole post' }), cutShort('the whole'));
    expect(merged.text).toBe('the whole post');
    expect(merged.truncated).toBe(false);
  });

  it('never wipes stored text with an empty capture', () => {
    expect(mergeSnapshot(tweetFixture('1', { text: 'kept' }), tweetFixture('1', { text: '' })).text).toBe('kept');
  });

  it('keeps pictures the newer capture has not loaded yet', () => {
    expect(mergeSnapshot({ ...tweetFixture('1'), media: [PHOTO] }, tweetFixture('1')).media).toEqual([PHOTO]);
  });

  it('takes the newest avatar and keeps the first capture time', () => {
    const existing: TweetRecord = {
      ...tweetFixture('1', { capturedAt: 5 }),
      avatarUrl: 'https://pbs.twimg.com/profile_images/1/old_normal.jpg',
    };
    const incoming: TweetRecord = {
      ...tweetFixture('1', { capturedAt: 9 }),
      avatarUrl: 'https://pbs.twimg.com/profile_images/1/new_normal.jpg',
      updatedAt: 10,
    };
    const merged = mergeSnapshot(existing, incoming);
    expect(merged.avatarUrl).toBe(incoming.avatarUrl);
    expect(merged.capturedAt).toBe(5);
    expect(merged.updatedAt).toBe(10);
  });

  it('keeps a quote link the newer capture could not see', () => {
    const quote: QuotedPost = {
      authorName: 'Q',
      username: 'q',
      verified: false,
      avatarUrl: null,
      postedAt: null,
      text: 'quoted',
      media: null,
      url: 'https://x.com/q/status/2',
    };
    const merged = mergeSnapshot({ ...tweetFixture('1'), quote }, { ...tweetFixture('1'), quote: { ...quote, url: null } });
    expect(merged.quote?.url).toBe('https://x.com/q/status/2');
  });
});

describe('sameSnapshot', () => {
  it('ignores updatedAt but sees any visible change', () => {
    const a = tweetFixture('1');
    expect(sameSnapshot(a, { ...a, updatedAt: a.updatedAt + 1 })).toBe(true);
    expect(sameSnapshot(a, { ...a, media: [PHOTO] })).toBe(false);
  });
});
```

- [ ] **Step 2：写失败测试（地址白名单与规范化）**

`tests/unit/snapshot-urls.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  avatarUrlForDisplay,
  imageUrlForSize,
  isAllowedImageUrl,
  isAllowedLinkUrl,
  normalizeImageUrl,
} from '@/utils/url';

describe('image allow-list (work order 3.2)', () => {
  it('accepts only https://pbs.twimg.com', () => {
    expect(isAllowedImageUrl('https://pbs.twimg.com/media/A?format=jpg&name=small')).toBe(true);
    expect(isAllowedImageUrl('http://pbs.twimg.com/media/A')).toBe(false);
    expect(isAllowedImageUrl('https://pbs.twimg.com.evil.example/media/A')).toBe(false);
    expect(isAllowedImageUrl('https://evil.example/pbs.twimg.com/media/A')).toBe(false);
    expect(isAllowedImageUrl('https://user@pbs.twimg.com/media/A')).toBe(false);
    expect(isAllowedImageUrl('https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png')).toBe(false);
    expect(isAllowedImageUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isAllowedImageUrl('not a url')).toBe(false);
  });
});

describe('link allow-list (work order 3.2)', () => {
  it('accepts http and https only', () => {
    expect(isAllowedLinkUrl('https://t.co/abc')).toBe(true);
    expect(isAllowedLinkUrl('http://example.com/')).toBe(true);
    expect(isAllowedLinkUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedLinkUrl('data:text/html,hi')).toBe(false);
    expect(isAllowedLinkUrl('blob:https://x.com/1')).toBe(false);
  });
});

describe('image URL shapes', () => {
  it('stores one URL per photo whatever size the page asked for', () => {
    expect(normalizeImageUrl('https://pbs.twimg.com/media/AbC?format=jpg&name=900x900')).toBe(
      'https://pbs.twimg.com/media/AbC?format=jpg&name=small',
    );
    expect(normalizeImageUrl('https://pbs.twimg.com/media/AbC?name=large&format=png')).toBe(
      'https://pbs.twimg.com/media/AbC?format=png&name=small',
    );
  });

  it('stores the 48px avatar rendition', () => {
    expect(normalizeImageUrl('https://pbs.twimg.com/profile_images/1/a_400x400.jpg')).toBe(
      'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
    );
  });

  it('leaves video posters and card images alone', () => {
    const poster = 'https://pbs.twimg.com/amplify_video_thumb/1/img/abc.jpg';
    const card = 'https://pbs.twimg.com/card_img/1/abc?format=jpg&name=800x419';
    expect(normalizeImageUrl(poster)).toBe(poster);
    expect(normalizeImageUrl(card)).toBe(card);
  });

  it('asks for a display size only where X supports one', () => {
    expect(imageUrlForSize('https://pbs.twimg.com/media/AbC?format=jpg&name=small', 'medium')).toBe(
      'https://pbs.twimg.com/media/AbC?format=jpg&name=medium',
    );
    const poster = 'https://pbs.twimg.com/amplify_video_thumb/1/img/abc.jpg';
    expect(imageUrlForSize(poster, 'medium')).toBe(poster);
    expect(avatarUrlForDisplay('https://pbs.twimg.com/profile_images/1/a_normal.jpg')).toBe(
      'https://pbs.twimg.com/profile_images/1/a_bigger.jpg',
    );
  });
});
```

- [ ] **Step 3：运行，确认失败**

Run: `pnpm vitest run tests/unit/snapshot.test.ts tests/unit/snapshot-urls.test.ts`
Expected: FAIL，`Failed to resolve import "@/core/domain/snapshot"`，以及 `isAllowedImageUrl is not a function`

- [ ] **Step 4：快照类型**

`src/core/domain/tweet.ts` 整个替换为：

```ts
export type TweetId = string;

/**
 * One run of post text. Stored instead of HTML, so nothing X rendered is ever
 * parsed again; the card rebuilds links from these fields alone.
 */
export type TextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; url: string }
  | { kind: 'mention'; text: string; username: string }
  | { kind: 'hashtag'; text: string; tag: string }
  | { kind: 'emoji'; text: string };

export type MediaKind = 'photo' | 'video' | 'gif';

export interface MediaItem {
  kind: MediaKind;
  /** The picture, or the poster frame of a video or GIF. pbs.twimg.com only. */
  url: string;
  alt: string | null;
}

export interface QuotedPost {
  authorName: string | null;
  /** From the quote's visible @handle: X renders the quote block without a profile link. */
  username: string | null;
  verified: boolean;
  avatarUrl: string | null;
  postedAt: number | null;
  text: string;
  /** The first picture only — enough to recognise the quote. */
  media: MediaItem | null;
  /** Only when the page exposes it; on 2026-09-29 the quote block carried no link. */
  url: string | null;
}

export interface LinkCard {
  url: string;
  layout: 'large' | 'small';
  title: string | null;
  domain: string | null;
  imageUrl: string | null;
}

/** A saved post: identity plus everything its card shows (work order 3.2). */
export interface TweetRecord {
  tweetId: TweetId;
  /** Always `https://x.com/{username}/status/{tweetId}`. */
  canonicalUrl: string;
  username: string;
  authorName: string | null;
  avatarUrl: string | null;
  verified: boolean;
  /** From the post's own `<time datetime>`; null when the page had not rendered it. */
  postedAt: number | null;
  /** Plain text for search — always the concatenation of `segments`. */
  text: string;
  segments: TextSegment[];
  media: MediaItem[];
  quote: QuotedPost | null;
  card: LinkCard | null;
  /** The timeline cut the text short ("Show more"); a later full view replaces it. */
  truncated: boolean;
  capturedAt: number;
  updatedAt: number;
}
```

- [ ] **Step 5：合并规则**

`src/core/domain/snapshot.ts`：

```ts
import type { QuotedPost, TextSegment, TweetId, TweetRecord } from './tweet';

/** A version-1 row: identity and plain text only. */
export interface TweetRecordV1 {
  tweetId: TweetId;
  canonicalUrl: string;
  authorName: string | null;
  username: string;
  text: string;
  capturedAt: number;
  updatedAt: number;
}

/** Plain text for search is always derived from the segments, never sent separately. */
export function segmentsToText(segments: readonly TextSegment[]): string {
  return segments.map((segment) => segment.text).join('');
}

/**
 * Completes a row written before snapshots existed. Fields already present
 * are kept, so running it twice — or on a row that is already v2 — changes
 * nothing.
 */
export function upgradeV1Row(row: TweetRecordV1 & Partial<TweetRecord>): TweetRecord {
  return {
    tweetId: row.tweetId,
    canonicalUrl: row.canonicalUrl,
    username: row.username,
    authorName: row.authorName,
    avatarUrl: row.avatarUrl ?? null,
    verified: row.verified ?? false,
    postedAt: row.postedAt ?? null,
    text: row.text,
    segments: row.segments ?? (row.text.length > 0 ? [{ kind: 'text', text: row.text }] : []),
    media: row.media ?? [],
    quote: row.quote ?? null,
    card: row.card ?? null,
    truncated: row.truncated ?? false,
    capturedAt: row.capturedAt,
    updatedAt: row.updatedAt,
  };
}

function mergeQuote(existing: QuotedPost | null, incoming: QuotedPost | null): QuotedPost | null {
  if (incoming === null) return existing;
  if (existing === null) return incoming;
  return {
    ...incoming,
    avatarUrl: incoming.avatarUrl ?? existing.avatarUrl,
    postedAt: incoming.postedAt ?? existing.postedAt,
    media: incoming.media ?? existing.media,
    url: incoming.url ?? existing.url,
  };
}

/**
 * Folds a fresh capture into the stored snapshot.
 *
 * The page never shows everything at once — the timeline cuts long posts
 * short, pictures and avatars load lazily, a half-rendered row has no header
 * yet — so a newer capture is not automatically a better one. Each field keeps
 * the more complete value:
 *  - text: a full capture replaces a truncated one, never the reverse, and an
 *    empty capture never wipes stored text;
 *  - author: the newest non-empty value (avatars move to new URLs);
 *  - media: the newer list unless it has fewer items (not loaded yet);
 *  - quote, card: the newest when present, otherwise kept.
 * `capturedAt` is the first capture and never moves.
 */
export function mergeSnapshot(existing: TweetRecord, incoming: TweetRecord): TweetRecord {
  const keepText =
    (incoming.truncated && !existing.truncated) ||
    (incoming.segments.length === 0 && existing.segments.length > 0);
  const headerRendered = incoming.authorName !== null;
  return {
    ...existing,
    canonicalUrl: incoming.canonicalUrl,
    username: incoming.username,
    authorName: incoming.authorName ?? existing.authorName,
    avatarUrl: incoming.avatarUrl ?? existing.avatarUrl,
    verified: headerRendered ? incoming.verified : existing.verified,
    postedAt: incoming.postedAt ?? existing.postedAt,
    text: keepText ? existing.text : incoming.text,
    segments: keepText ? existing.segments : incoming.segments,
    truncated: keepText ? existing.truncated : incoming.truncated,
    media: incoming.media.length >= existing.media.length ? incoming.media : existing.media,
    quote: mergeQuote(existing.quote, incoming.quote),
    card: incoming.card ?? existing.card,
    capturedAt: existing.capturedAt,
    updatedAt: incoming.updatedAt,
  };
}

/** True when two snapshots would render the same; `updatedAt` is ignored. */
export function sameSnapshot(a: TweetRecord, b: TweetRecord): boolean {
  return JSON.stringify(contentOf(a)) === JSON.stringify(contentOf(b));
}

/**
 * Nested objects are compared by serialisation. Every one of them is built by
 * sanitizeSnapshot in a fixed key order and survives IndexedDB's structured
 * clone unchanged, so equal content always serialises identically.
 */
function contentOf(record: TweetRecord): unknown[] {
  return [
    record.canonicalUrl,
    record.authorName,
    record.avatarUrl,
    record.verified,
    record.postedAt,
    record.segments,
    record.media,
    record.quote,
    record.card,
    record.truncated,
  ];
}
```

- [ ] **Step 6：图片 / 链接白名单**

`src/utils/url.ts` 末尾追加：

```ts
const IMAGE_HOST = 'pbs.twimg.com';

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Pictures are only ever loaded from X's image server (work order 3.2). */
export function isAllowedImageUrl(raw: string): boolean {
  const url = parseUrl(raw);
  return (
    url !== null &&
    url.protocol === 'https:' &&
    url.hostname === IMAGE_HOST &&
    url.port === '' &&
    url.username === '' &&
    url.password === ''
  );
}

/** Links a post or card may carry: http(s) only, so never javascript:, data: or blob:. */
export function isAllowedLinkUrl(raw: string): boolean {
  const url = parseUrl(raw);
  return url !== null && (url.protocol === 'https:' || url.protocol === 'http:');
}

const AVATAR_SIZE = /_(?:normal|bigger|mini|x96|200x200|400x400)(\.\w+)$/;

/**
 * One stable URL per picture. The timeline asks for `name=small`, a post's own
 * page for `medium` or `large`; without this every page change would look like
 * new media and cause a pointless rewrite. Expects an allowed URL.
 */
export function normalizeImageUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = '';
  if (url.pathname.startsWith('/media/')) {
    const format = url.searchParams.get('format');
    url.search = '';
    if (format !== null) url.searchParams.set('format', format);
    url.searchParams.set('name', 'small');
  } else if (url.pathname.startsWith('/profile_images/')) {
    url.pathname = url.pathname.replace(AVATAR_SIZE, '_normal$1');
  }
  return url.toString();
}

/** A photo at the size a card needs; other kinds of picture come back unchanged. */
export function imageUrlForSize(raw: string, size: 'small' | 'medium'): string {
  const url = parseUrl(raw);
  if (url === null || !url.pathname.startsWith('/media/')) return raw;
  url.searchParams.set('name', size);
  return url.toString();
}

/** `_normal` is 48px and blurry at 40px on a 2x screen; `_bigger` is 73px. */
export function avatarUrlForDisplay(raw: string): string {
  return raw.replace(AVATAR_SIZE, '_bigger$1');
}
```

- [ ] **Step 7：测试数据工厂补上快照字段**

`tests/helpers/db.ts` 中把 `tweetFixture` 替换为：

```ts
export function tweetFixture(id: string, overrides: TweetOverrides = {}): TweetRecord {
  const username = overrides.username ?? 'alice';
  const text = overrides.text ?? 'hello';
  return {
    tweetId: id,
    canonicalUrl: `https://x.com/${username}/status/${id}`,
    username,
    authorName: overrides.authorName === undefined ? 'Alice' : overrides.authorName,
    avatarUrl: null,
    verified: false,
    postedAt: null,
    text,
    segments: text.length > 0 ? [{ kind: 'text', text }] : [],
    media: [],
    quote: null,
    card: null,
    truncated: false,
    capturedAt: overrides.capturedAt ?? 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}
```

- [ ] **Step 8：提取器与校验临时补字段（保持可编译，Task 4、6 会整体替换）**

`src/hosts/x/TweetExtractor.ts` 顶部加 `import { upgradeV1Row } from '@/core/domain/snapshot';`，末尾 `return` 里的 `record: { … }` 改为：

```ts
    record: upgradeV1Row({
      tweetId,
      canonicalUrl,
      username,
      authorName: outerAuthorName(root, quotes, username),
      text: outerText(root, quotes),
      capturedAt: context.now,
      updatedAt: context.now,
    }),
```

`src/messaging/validate.ts` 顶部加 `import { upgradeV1Row } from '@/core/domain/snapshot';`，`validateTweetRecord` 里的 `return { … };` 改为 `return upgradeV1Row({ … });`（花括号里的内容不变）。

- [ ] **Step 9：三个测试文件的帖子数据补字段**

`tests/unit/folder-view.test.tsx` 中把 `savedView` 替换为：

```ts
function savedView(
  index: number,
  overrides: { url?: string; text?: string; savedAt?: number } = {},
): SavedTweetView {
  const tweetId = String(1_000_000_000_000_000_000n + BigInt(index));
  const username = `user${index}`;
  const text = overrides.text ?? `第 ${index} 条收藏`;
  return {
    savedAt: overrides.savedAt ?? BASE_TIME - index * 1000,
    tweet: {
      tweetId,
      canonicalUrl: overrides.url ?? `https://x.com/${username}/status/${tweetId}`,
      authorName: `作者${index}`,
      username,
      avatarUrl: null,
      verified: false,
      postedAt: null,
      text,
      segments: [{ kind: 'text', text }],
      media: [],
      quote: null,
      card: null,
      truncated: false,
      capturedAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
  };
}
```

`tests/unit/side-panel-app.test.tsx` 的 `tweet: { … }` 里，在 `text: '一条收藏',` 下面加：

```ts
                  segments: [{ kind: 'text', text: '一条收藏' }],
                  avatarUrl: null,
                  verified: false,
                  postedAt: null,
                  media: [],
                  quote: null,
                  card: null,
                  truncated: false,
```

`tests/unit/save-popover.test.tsx` 的 `TWEET` 里，在 `text: 'hello',` 下面加：

```ts
  segments: [{ kind: 'text', text: 'hello' }],
  avatarUrl: null,
  verified: false,
  postedAt: null,
  media: [],
  quote: null,
  card: null,
  truncated: false,
```

- [ ] **Step 10：运行，确认通过**

Run: `pnpm vitest run tests/unit/snapshot.test.ts tests/unit/snapshot-urls.test.ts`
Expected: PASS

- [ ] **Step 11：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add src/core/domain/tweet.ts src/core/domain/snapshot.ts src/utils/url.ts tests/helpers/db.ts \
  src/hosts/x/TweetExtractor.ts src/messaging/validate.ts \
  tests/unit/folder-view.test.tsx tests/unit/side-panel-app.test.tsx tests/unit/save-popover.test.tsx \
  tests/unit/snapshot.test.ts tests/unit/snapshot-urls.test.ts
git commit -m "新增帖子快照类型、合并规则与图片链接白名单"
git push origin main
```

---

### Task 4：后台逐字段校验快照

**Files:**
- Create: `src/messaging/sanitizeSnapshot.ts`
- Modify: `src/messaging/validate.ts`（删掉 `validateTweetRecord`，保存改用新函数）
- Create: `tests/unit/sanitize-snapshot.test.ts`

规则：身份字段（ID、永久链接）不合格就拒绝整个请求——存错了键以后没法修；其余字段不合格只丢弃该字段（白名单外的地址、坏片段、超长字符串），一张奇怪的图片不应该让整条帖子存不进去。

- [ ] **Step 1：写失败测试**

`tests/unit/sanitize-snapshot.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { TWEET_TEXT_MAX } from '@/core/constants';
import { DomainError } from '@/core/errors/DomainError';
import { sanitizeSnapshot } from '@/messaging/sanitizeSnapshot';

const NOW = Date.UTC(2026, 8, 29);
const PHOTO = 'https://pbs.twimg.com/media/AbC?format=jpg&name=large';

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tweetId: '1234567890',
    canonicalUrl: 'https://twitter.com/alice/status/1234567890/photo/1',
    username: 'ignored',
    authorName: 'Alice',
    avatarUrl: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
    verified: true,
    postedAt: Date.UTC(2026, 8, 28),
    text: 'ignored — rebuilt from the segments',
    segments: [
      { kind: 'text', text: 'hi ' },
      { kind: 'mention', text: '@bob', username: 'bob' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'example.com/a', url: 'https://t.co/abc' },
      { kind: 'hashtag', text: '#AI', tag: 'AI' },
    ],
    media: [{ kind: 'photo', url: PHOTO, alt: '图像' }],
    quote: null,
    card: null,
    truncated: true,
    capturedAt: 5,
    ...overrides,
  };
}

describe('sanitizeSnapshot', () => {
  it('keeps a well-formed snapshot and rebuilds identity and text itself', () => {
    const record = sanitizeSnapshot(raw(), NOW);
    expect(record.canonicalUrl).toBe('https://x.com/alice/status/1234567890');
    expect(record.username).toBe('alice');
    expect(record.text).toBe('hi @bob example.com/a#AI');
    expect(record.media).toEqual([
      { kind: 'photo', url: 'https://pbs.twimg.com/media/AbC?format=jpg&name=small', alt: '图像' },
    ]);
    expect(record.verified).toBe(true);
    expect(record.truncated).toBe(true);
    expect(record.capturedAt).toBe(5);
    expect(record.updatedAt).toBe(NOW);
  });

  it('still rejects a record whose id and permalink disagree', () => {
    expect(() => sanitizeSnapshot(raw({ tweetId: '999' }), NOW)).toThrow(DomainError);
  });

  it('drops pictures from anywhere but pbs.twimg.com', () => {
    const poster = 'https://pbs.twimg.com/amplify_video_thumb/1/img/v.jpg';
    const record = sanitizeSnapshot(
      raw({
        avatarUrl: 'https://evil.example/a.jpg',
        media: [
          { kind: 'photo', url: 'https://evil.example/b.jpg', alt: null },
          { kind: 'video', url: poster, alt: null },
        ],
      }),
      NOW,
    );
    expect(record.avatarUrl).toBeNull();
    expect(record.media).toEqual([{ kind: 'video', url: poster, alt: null }]);
  });

  it('turns unsafe links and bad mentions into plain text instead of losing the words', () => {
    const record = sanitizeSnapshot(
      raw({
        segments: [
          { kind: 'link', text: 'click', url: 'javascript:alert(1)' },
          { kind: 'mention', text: '@not valid', username: 'not valid' },
          { kind: 'bogus', text: 'gone' },
        ],
      }),
      NOW,
    );
    expect(record.segments).toEqual([
      { kind: 'text', text: 'click' },
      { kind: 'text', text: '@not valid' },
    ]);
  });

  it('caps text, media and strings', () => {
    const record = sanitizeSnapshot(
      raw({
        authorName: 'n'.repeat(500),
        segments: [
          { kind: 'text', text: 'a'.repeat(TWEET_TEXT_MAX) },
          { kind: 'text', text: 'overflow' },
        ],
        media: Array.from({ length: 9 }, () => ({ kind: 'photo', url: PHOTO, alt: null })),
      }),
      NOW,
    );
    expect(record.authorName).toHaveLength(128);
    expect(record.text).toHaveLength(TWEET_TEXT_MAX);
    expect(record.media).toHaveLength(4);
  });

  it('drops an impossible post time', () => {
    expect(sanitizeSnapshot(raw({ postedAt: Date.UTC(2001, 0, 1) }), NOW).postedAt).toBeNull();
    expect(sanitizeSnapshot(raw({ postedAt: NOW + 7 * 86_400_000 }), NOW).postedAt).toBeNull();
    expect(sanitizeSnapshot(raw({ postedAt: 'yesterday' }), NOW).postedAt).toBeNull();
  });

  it('keeps a quote with a checked link and drops an empty one', () => {
    const quote = {
      authorName: 'Q',
      username: 'q_user',
      verified: false,
      avatarUrl: null,
      postedAt: null,
      text: 'quoted',
      media: null,
      url: 'https://x.com/q_user/status/42',
    };
    expect(sanitizeSnapshot(raw({ quote }), NOW).quote).toEqual(quote);
    expect(sanitizeSnapshot(raw({ quote: { ...quote, url: 'https://evil.example/q' } }), NOW).quote?.url).toBeNull();
    expect(
      sanitizeSnapshot(raw({ quote: { authorName: null, username: null, text: '', media: null } }), NOW).quote,
    ).toBeNull();
  });

  it('keeps a link card only with an http(s) link', () => {
    const card = {
      url: 'https://t.co/card',
      layout: 'small',
      title: 'A title',
      domain: 'example.com',
      imageUrl: 'https://pbs.twimg.com/card_img/1/c?format=jpg&name=small',
    };
    expect(sanitizeSnapshot(raw({ card }), NOW).card).toEqual(card);
    expect(sanitizeSnapshot(raw({ card: { ...card, url: 'javascript:void 0' } }), NOW).card).toBeNull();
    expect(
      sanitizeSnapshot(raw({ card: { ...card, imageUrl: 'https://evil.example/c.jpg' } }), NOW).card?.imageUrl,
    ).toBeNull();
  });
});
```

- [ ] **Step 2：运行，确认失败**

Run: `pnpm vitest run tests/unit/sanitize-snapshot.test.ts`
Expected: FAIL，`Failed to resolve import "@/messaging/sanitizeSnapshot"`

- [ ] **Step 3：实现**

`src/messaging/sanitizeSnapshot.ts`：

```ts
import { TWEET_TEXT_MAX } from '@/core/constants';
import { segmentsToText } from '@/core/domain/snapshot';
import type { LinkCard, MediaItem, MediaKind, QuotedPost, TextSegment, TweetRecord } from '@/core/domain/tweet';
import { DomainError } from '@/core/errors/DomainError';
import {
  isAllowedImageUrl,
  isAllowedLinkUrl,
  isNumericTweetId,
  normalizeImageUrl,
  parseStatusUrl,
  requireStatusUrl,
} from '@/utils/url';

/** Generous for real posts, small enough that a hostile page cannot bloat the database. */
export const SNAPSHOT_LIMITS = {
  name: 128,
  url: 2048,
  alt: 1000,
  cardTitle: 300,
  domain: 253,
  tag: 140,
  segments: 2000,
  media: 4,
} as const;

/** X launched on 2006-03-21; anything earlier, or more than a day ahead, is not a post time. */
const EARLIEST_POST = Date.UTC(2006, 2, 21);
const DAY_MS = 86_400_000;
const USERNAME = /^[A-Za-z0-9_]{1,15}$/;
const MEDIA_KINDS: ReadonlySet<string> = new Set<MediaKind>(['photo', 'video', 'gif']);

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function capped(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function imageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > SNAPSHOT_LIMITS.url) return null;
  return isAllowedImageUrl(value) ? normalizeImageUrl(value) : null;
}

function linkUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > SNAPSHOT_LIMITS.url) return null;
  return isAllowedLinkUrl(value) ? value : null;
}

function username(value: unknown): string | null {
  return typeof value === 'string' && USERNAME.test(value) ? value : null;
}

function postTime(value: unknown, now: number): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= EARLIEST_POST &&
    value <= now + DAY_MS
    ? Math.trunc(value)
    : null;
}

/** Unknown kinds are dropped; a link or mention that fails its check keeps its words as text. */
function segment(value: unknown): TextSegment | null {
  if (!isRecord(value) || typeof value.text !== 'string') return null;
  const text = value.text;
  switch (value.kind) {
    case 'text':
      return { kind: 'text', text };
    case 'emoji':
      return { kind: 'emoji', text };
    case 'link': {
      const url = linkUrl(value.url);
      return url === null ? { kind: 'text', text } : { kind: 'link', text, url };
    }
    case 'mention': {
      const name = username(value.username);
      return name === null ? { kind: 'text', text } : { kind: 'mention', text, username: name };
    }
    case 'hashtag': {
      const tag = capped(value.tag, SNAPSHOT_LIMITS.tag);
      return tag === null || tag.length === 0 ? { kind: 'text', text } : { kind: 'hashtag', text, tag };
    }
    default:
      return null;
  }
}

/** The total text is capped at TWEET_TEXT_MAX by cutting the segment that crosses it. */
function segments(value: unknown): TextSegment[] {
  if (!Array.isArray(value)) return [];
  const out: TextSegment[] = [];
  let budget = TWEET_TEXT_MAX;
  for (const item of value.slice(0, SNAPSHOT_LIMITS.segments)) {
    if (budget <= 0) break;
    const next = segment(item);
    if (next === null || next.text.length === 0) continue;
    const text = next.text.length > budget ? next.text.slice(0, budget) : next.text;
    budget -= text.length;
    out.push({ ...next, text });
  }
  return out;
}

function mediaItem(value: unknown): MediaItem | null {
  if (!isRecord(value) || typeof value.kind !== 'string' || !MEDIA_KINDS.has(value.kind)) return null;
  const url = imageUrl(value.url);
  if (url === null) return null;
  return { kind: value.kind as MediaKind, url, alt: capped(value.alt, SNAPSHOT_LIMITS.alt) };
}

function mediaList(value: unknown): MediaItem[] {
  if (!Array.isArray(value)) return [];
  const out: MediaItem[] = [];
  for (const item of value.slice(0, SNAPSHOT_LIMITS.media * 4)) {
    const media = mediaItem(item);
    if (media !== null) out.push(media);
    if (out.length === SNAPSHOT_LIMITS.media) break;
  }
  return out;
}

function quote(value: unknown, now: number): QuotedPost | null {
  if (!isRecord(value)) return null;
  const parsed = typeof value.url === 'string' ? parseStatusUrl(value.url) : null;
  const result: QuotedPost = {
    authorName: capped(value.authorName, SNAPSHOT_LIMITS.name),
    username: username(value.username),
    verified: value.verified === true,
    avatarUrl: imageUrl(value.avatarUrl),
    postedAt: postTime(value.postedAt, now),
    text: (capped(value.text, TWEET_TEXT_MAX) ?? '').trim(),
    media: mediaItem(value.media),
    url: parsed === null ? null : parsed.canonicalUrl,
  };
  const empty =
    result.authorName === null && result.username === null && result.text.length === 0 && result.media === null;
  return empty ? null : result;
}

function card(value: unknown): LinkCard | null {
  if (!isRecord(value)) return null;
  const url = linkUrl(value.url);
  if (url === null) return null;
  return {
    url,
    layout: value.layout === 'small' ? 'small' : 'large',
    title: capped(value.title, SNAPSHOT_LIMITS.cardTitle),
    domain: capped(value.domain, SNAPSHOT_LIMITS.domain),
    imageUrl: imageUrl(value.imageUrl),
  };
}

/**
 * Turns an untrusted snapshot from a content script into a storable record.
 *
 * Identity is strict: a bad id or permalink rejects the request, because a
 * record under the wrong key cannot be repaired later. Everything else is
 * forgiving: a field that fails its check is dropped, so one odd picture never
 * stops a save. `username` comes from the permalink and `text` from the
 * segments; neither is taken from the payload.
 */
export function sanitizeSnapshot(value: unknown, now: number): TweetRecord {
  if (!isRecord(value)) throw new DomainError('INVALID_REQUEST', '请求参数不合法：tweet');
  if (typeof value.tweetId !== 'string' || !isNumericTweetId(value.tweetId)) {
    throw new DomainError('INVALID_TWEET_ID', 'Tweet ID 必须是数字字符串。');
  }
  if (typeof value.canonicalUrl !== 'string') {
    throw new DomainError('INVALID_REQUEST', '请求参数不合法：tweet.canonicalUrl');
  }
  const parsed = requireStatusUrl(value.canonicalUrl);
  if (parsed.tweetId !== value.tweetId) {
    throw new DomainError('INVALID_TWEET_URL', 'Tweet ID 与链接不一致。');
  }

  const text = segments(value.segments);
  return {
    tweetId: parsed.tweetId,
    canonicalUrl: parsed.canonicalUrl,
    username: parsed.username,
    authorName: capped(value.authorName, SNAPSHOT_LIMITS.name),
    avatarUrl: imageUrl(value.avatarUrl),
    verified: value.verified === true,
    postedAt: postTime(value.postedAt, now),
    text: segmentsToText(text),
    segments: text,
    media: mediaList(value.media),
    quote: quote(value.quote, now),
    card: card(value.card),
    truncated: value.truncated === true,
    capturedAt:
      typeof value.capturedAt === 'number' && Number.isFinite(value.capturedAt) ? value.capturedAt : now,
    updatedAt: now,
  };
}
```

- [ ] **Step 4：保存请求改用它**

`src/messaging/validate.ts`：
1. 删除整个 `validateTweetRecord` 函数，以及 Task 3 加的 `upgradeV1Row` 导入；
2. 删除不再使用的导入：`TWEET_TEXT_MAX`、`type TweetRecord`、`requireStatusUrl`、`trimTweetText`（`isNumericTweetId` 仍被 `asTweetId` 使用，保留）；
3. 加 `import { sanitizeSnapshot } from './sanitizeSnapshot';`；
4. `'memberships.saveTweet'` 改为：

```ts
  'memberships.saveTweet': (payload): SaveTweetPayload => {
    const raw = asRecord(payload, 'payload');
    return {
      folderId: asFolderId(raw.folderId, 'folderId'),
      tweet: sanitizeSnapshot(raw.tweet, Date.now()),
    };
  },
```

- [ ] **Step 5：运行，确认通过**

Run: `pnpm vitest run tests/unit/sanitize-snapshot.test.ts tests/unit/rpc-contract.test.ts tests/unit/membership.test.ts`
Expected: PASS

- [ ] **Step 6：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add src/messaging/sanitizeSnapshot.ts src/messaging/validate.ts tests/unit/sanitize-snapshot.test.ts
git commit -m "后台逐字段校验帖子快照：身份严格，其余不合格字段丢弃"
git push origin main
```

---

### Task 5：数据库第 2 版、迁移与合并写入

**Files:**
- Modify: `src/background/db/schema.ts`（加 `SCHEMA_V2`）
- Create: `src/background/db/migrations.ts`
- Modify: `src/background/db/XFoldersDatabase.ts:5,15-18`
- Modify: `src/background/repositories/TweetRepository.ts`（`upsert` 改合并，新增 `refresh`）
- Create: `tests/unit/db-migration.test.ts`、`tests/unit/tweet-repository.test.ts`

- [ ] **Step 1：写失败测试（迁移）**

`tests/unit/db-migration.test.ts`：

```ts
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { SCHEMA_V1 } from '@/background/db/schema';
import { XFoldersDatabase } from '@/background/db/XFoldersDatabase';

describe('database v1 → v2', () => {
  it('upgrades stored posts in place and leaves folders and memberships alone', async () => {
    const name = `x-folders-migration-${Math.random().toString(36).slice(2)}`;
    const v1 = new Dexie(name);
    v1.version(1).stores(SCHEMA_V1);
    await v1.table('folders').add({
      id: 'f1',
      name: 'AI',
      parentId: null,
      position: 1000,
      collapsed: false,
      createdAt: 1,
      updatedAt: 1,
    });
    await v1.table('tweets').bulkAdd([
      {
        tweetId: '1',
        canonicalUrl: 'https://x.com/alice/status/1',
        username: 'alice',
        authorName: 'Alice',
        text: 'hello\nworld',
        capturedAt: 5,
        updatedAt: 6,
      },
      {
        tweetId: '2',
        canonicalUrl: 'https://x.com/bob/status/2',
        username: 'bob',
        authorName: null,
        text: '',
        capturedAt: 7,
        updatedAt: 7,
      },
    ]);
    await v1.table('folderTweets').add({ folderId: 'f1', tweetId: '1', savedAt: 9 });
    v1.close();

    const db = new XFoldersDatabase(name);
    await db.open();
    expect(db.verno).toBe(2);
    expect(await db.tweets.get('1')).toEqual({
      tweetId: '1',
      canonicalUrl: 'https://x.com/alice/status/1',
      username: 'alice',
      authorName: 'Alice',
      avatarUrl: null,
      verified: false,
      postedAt: null,
      text: 'hello\nworld',
      segments: [{ kind: 'text', text: 'hello\nworld' }],
      media: [],
      quote: null,
      card: null,
      truncated: false,
      capturedAt: 5,
      updatedAt: 6,
    });
    expect((await db.tweets.get('2'))?.segments).toEqual([]);
    expect(await db.folders.count()).toBe(1);
    expect(await db.folderTweets.get(['f1', '1'])).toEqual({ folderId: 'f1', tweetId: '1', savedAt: 9 });
    db.close();
  });
});
```

- [ ] **Step 2：写失败测试（合并写入）**

`tests/unit/tweet-repository.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { TweetRepository } from '@/background/repositories/TweetRepository';
import { freshDatabase, tweetFixture } from '../helpers/db';

describe('TweetRepository snapshots', () => {
  it('completes a truncated post on re-save and never degrades it back', async () => {
    const db = await freshDatabase();
    const repository = new TweetRepository(db);
    await repository.upsert({ ...tweetFixture('1', { text: 'the start' }), truncated: true });
    await repository.upsert(tweetFixture('1', { text: 'the start and the end' }));
    await repository.upsert({ ...tweetFixture('1', { text: 'the start' }), truncated: true });
    const stored = await repository.get('1');
    expect(stored?.text).toBe('the start and the end');
    expect(stored?.truncated).toBe(false);
    db.close();
  });

  it('refresh never creates a row and skips writes that change nothing', async () => {
    const db = await freshDatabase();
    const repository = new TweetRepository(db);
    expect(await repository.refresh(tweetFixture('1'))).toBeNull();
    expect(await repository.get('1')).toBeUndefined();

    await repository.upsert(tweetFixture('1'));
    expect(await repository.refresh({ ...tweetFixture('1'), updatedAt: 99 })).toBeNull();
    const refreshed = await repository.refresh({ ...tweetFixture('1'), verified: true });
    expect(refreshed?.verified).toBe(true);
    expect((await repository.get('1'))?.verified).toBe(true);
    db.close();
  });
});
```

- [ ] **Step 3：运行，确认失败**

Run: `pnpm vitest run tests/unit/db-migration.test.ts tests/unit/tweet-repository.test.ts`
Expected: FAIL —— `expected 1 to be 2`（`verno`）；`repository.refresh is not a function`；截断用例得到 `'the start'`

- [ ] **Step 4：第 2 版结构与迁移**

`src/background/db/schema.ts` 末尾追加：

```ts
/**
 * Version 2 keeps every index of version 1 — the snapshot fields are row
 * content, not keys. The bump exists for the upgrade in migrations.ts.
 */
export const SCHEMA_V2 = SCHEMA_V1;
```

`src/background/db/migrations.ts`：

```ts
import type { Transaction } from 'dexie';
import { upgradeV1Row, type TweetRecordV1 } from '@/core/domain/snapshot';
import type { TweetRecord } from '@/core/domain/tweet';

/**
 * v1 → v2: every stored post gains the snapshot fields (work order 3.2), so no
 * reader ever meets a half-shaped row. Folders, memberships and the recent
 * list are untouched. Idempotent, like upgradeV1Row itself.
 */
export async function upgradeToV2(tx: Transaction): Promise<void> {
  await tx
    .table('tweets')
    .toCollection()
    .modify((row: TweetRecordV1 & Partial<TweetRecord>) => {
      Object.assign(row, upgradeV1Row(row));
    });
}
```

`src/background/db/XFoldersDatabase.ts`：导入改为

```ts
import { SCHEMA_V1, SCHEMA_V2, type FolderRow, type MembershipRow, type MetaRow, type TweetRow } from './schema';
import { upgradeToV2 } from './migrations';
```

构造函数里在 `this.version(1).stores(SCHEMA_V1);` 下面加：

```ts
    this.version(2).stores(SCHEMA_V2).upgrade(upgradeToV2);
```

- [ ] **Step 5：合并写入**

`src/background/repositories/TweetRepository.ts`：顶部加 `import { mergeSnapshot, sameSnapshot } from '@/core/domain/snapshot';`，把 `upsert` 整个方法（含注释）替换为：

```ts
  /**
   * Stores a capture folded into whatever is already there (see
   * mergeSnapshot): a re-save can complete a snapshot but never degrade it,
   * and the first capture time is kept.
   */
  async upsert(incoming: TweetRecord): Promise<TweetRecord> {
    const existing = await this.get(incoming.tweetId);
    const merged = existing === undefined ? incoming : mergeSnapshot(existing, incoming);
    await this.db.tweets.put(merged);
    return merged;
  }

  /**
   * Folds a later sighting into a post that is already stored. Returns the new
   * record when something visible changed; null when the post is not stored —
   * a sighting never creates a row — or when nothing changed, so nothing is
   * written.
   */
  async refresh(incoming: TweetRecord): Promise<TweetRecord | null> {
    const existing = await this.get(incoming.tweetId);
    if (existing === undefined) return null;
    const merged = mergeSnapshot(existing, incoming);
    if (sameSnapshot(existing, merged)) return null;
    await this.db.tweets.put(merged);
    return merged;
  }
```

- [ ] **Step 6：运行，确认通过**

Run: `pnpm vitest run tests/unit/db-migration.test.ts tests/unit/tweet-repository.test.ts tests/unit/membership.test.ts tests/unit/pagination.test.ts`
Expected: PASS

- [ ] **Step 7：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add src/background/db/schema.ts src/background/db/migrations.ts src/background/db/XFoldersDatabase.ts \
  src/background/repositories/TweetRepository.ts tests/unit/db-migration.test.ts tests/unit/tweet-repository.test.ts
git commit -m "数据库升级到第 2 版并迁移旧帖子；保存改为合并写入"
git push origin main
```

---

### Task 6：提取作者（显示名、@用户名、认证、头像）与时间

**Files:**
- Modify: `src/hosts/x/selectors.ts`（新选择器一次加齐，后面的任务直接用）
- Create: `src/hosts/x/extractPicture.ts`、`src/hosts/x/extractAuthor.ts`
- Create: `tests/helpers/postDom.ts`（按实测结构手写的帖子 DOM，Task 7–9 共用）
- Create: `tests/unit/extract-author.test.ts`

- [ ] **Step 1：选择器**

`src/hosts/x/selectors.ts` 顶部注释 `Verified against real x.com DOM captured 2026-09-03 (see tests/fixtures).` 下面加一行：

```ts
 * Measured again on 2026-09-29 for snapshots (see the M2 plan).
```

`X_SELECTORS` 里 `card: '[data-testid="card.wrapper"]',` 下面加：

```ts
  /** Author avatar block; inside a quote it belongs to the quoted author. */
  avatar: '[data-testid="Tweet-User-Avatar"]',
  /** Blue, gold and grey checks all use this id; it sits inside User-Name. */
  verifiedBadge: '[data-testid="icon-verified"]',
  /**
   * The timeline's cut of a long post. A sibling of tweetText, not inside it;
   * a post's own page shows the full text and has none.
   */
  showMore: '[data-testid="tweet-text-show-more-link"]',
  /** One picture or video cell; a video nests videoPlayer > videoComponent > video in it. */
  mediaCell: '[data-testid="tweetPhoto"]',
  cardSmallMedia: '[data-testid="card.layoutSmall.media"]',
  video: 'video',
  time: 'time',
  /** Leaf text runs inside User-Name and cards. */
  textRun: 'span',
  image: 'img[src]',
  /** X paints avatars and posters a second time as a CSS background. */
  backgroundImage: '[style*="background-image"]',
  anyLink: 'a[href]',
```

- [ ] **Step 2：帖子 DOM 测试工具**

`tests/helpers/postDom.ts`：

```ts
/**
 * Hand-built X post markup shaped after the structure measured on real x.com
 * on 2026-09-29 (see the M2 plan). Only what our selectors read is present;
 * X's class names and styles are left out, as in the captured fixtures.
 */

const BADGE =
  '<span><svg data-testid="icon-verified" role="img" aria-label="LABEL"><path d="M0 0h24v24H0z"></path></svg></span>';

export interface PostOptions {
  id?: string;
  user?: string;
  name?: string;
  verified?: boolean;
  /** The avatar picture; null leaves it unloaded, as in a background tab. */
  avatar?: string | null;
  /** X paints avatars as an <img> and as a CSS background; either may come first. */
  avatarAs?: 'img' | 'background';
  datetime?: string;
  /** Inner HTML of tweetText; null leaves the block out (a media-only post). */
  textHtml?: string | null;
  showMore?: boolean;
  photos?: readonly string[];
  video?: { poster: string };
  cardHtml?: string;
  quoteHtml?: string;
  /** A post's own page: tabindex -1 and the time in a permalink row under the body. */
  focused?: boolean;
}

export function postHtml(options: PostOptions = {}): string {
  const id = options.id ?? '1234567890';
  const user = options.user ?? 'alice';
  const focused = options.focused === true;
  const avatar =
    options.avatar === undefined ? `https://pbs.twimg.com/profile_images/1/${user}_normal.jpg` : options.avatar;
  let avatarPaint = '';
  if (avatar !== null) {
    avatarPaint =
      options.avatarAs === 'background'
        ? `<div style="background-image: url(&quot;${avatar}&quot;);"></div>`
        : `<img alt="" draggable="true" src="${avatar}">`;
  }
  const time =
    `<a href="/${user}/status/${id}" role="link">` +
    `<time datetime="${options.datetime ?? '2026-09-28T10:00:00.000Z'}">3小时</time></a>`;
  const photos = (options.photos ?? [])
    .map(
      (src, index) =>
        `<div data-testid="tweetPhoto"><a href="/${user}/status/${id}/photo/${index + 1}">` +
        `<div><img alt="图像" src="${src}"></div></a></div>`,
    )
    .join('');
  const video =
    options.video === undefined
      ? ''
      : '<div data-testid="tweetPhoto"><div><div data-testid="placementTracking">' +
        '<div data-testid="videoPlayer"><div><div data-testid="videoComponent">' +
        `<video tabindex="-1" poster="${options.video.poster}" src="blob:https://x.com/0"></video>` +
        `<div><img alt="" src="${options.video.poster}"></div>` +
        '</div></div></div></div></div></div>';
  const text =
    options.textHtml === null
      ? ''
      : `<div data-testid="tweetText" dir="auto">${options.textHtml ?? '<span>hello</span>'}</div>`;
  const showMore =
    options.showMore === true
      ? '<button data-testid="tweet-text-show-more-link" role="button" type="button"><span>显示更多</span></button>'
      : '';
  return (
    `<article data-testid="tweet" role="article" tabindex="${focused ? '-1' : '0'}">` +
    `<div data-testid="Tweet-User-Avatar"><div data-testid="UserAvatar-Container-${user}">` +
    `<a href="/${user}" role="link" tabindex="-1" aria-hidden="true">${avatarPaint}</a></div></div>` +
    '<div data-testid="User-Name">' +
    `<a href="/${user}" role="link"><div><span><span>${options.name ?? 'Alice'}</span></span>` +
    `${options.verified === true ? BADGE : ''}</div></a>` +
    `<div><a href="/${user}" role="link" tabindex="-1"><span>@${user}</span></a>` +
    `<div aria-hidden="true"><span>·</span></div>${focused ? '' : time}</div>` +
    '</div>' +
    text +
    showMore +
    photos +
    video +
    (options.cardHtml ?? '') +
    (options.quoteHtml ?? '') +
    (focused ? `<div>${time}</div>` : '') +
    '<div role="group"><div><button data-testid="reply"></button></div>' +
    '<div><button data-testid="retweet"></button></div><div><button data-testid="like"></button></div></div>' +
    '</article>'
  );
}

export interface QuoteOptions {
  user?: string;
  name?: string;
  verified?: boolean;
  avatar?: string | null;
  text?: string;
  photo?: string;
  /** Sensitive media: X covers it and renders no picture. */
  interstitial?: boolean;
  datetime?: string;
  /** Older captures had a timestamped status link inside the quote; 2026-09-29 did not. */
  linkId?: string;
}

export function quoteHtml(options: QuoteOptions = {}): string {
  const user = options.user ?? 'quoted';
  const avatar =
    options.avatar === undefined ? `https://pbs.twimg.com/profile_images/2/${user}_normal.jpg` : options.avatar;
  const time = `<time datetime="${options.datetime ?? '2026-09-27T08:00:00.000Z'}">9月27日</time>`;
  const timeBlock =
    options.linkId === undefined
      ? `<div aria-label="LABEL">${time}</div>`
      : `<a href="/${user}/status/${options.linkId}" role="link">${time}</a>`;
  let media = '';
  if (options.interstitial === true) {
    media =
      '<div data-testid="testCondensedMedia"><div data-testid="tweetPhoto"><div>' +
      '<div data-testid="previewInterstitial" aria-label="LABEL"><span>内容警告</span></div></div></div></div>';
  } else if (options.photo !== undefined) {
    media =
      '<div data-testid="testCondensedMedia"><div data-testid="tweetPhoto">' +
      `<div><img alt="图像" src="${options.photo}"></div></div></div>`;
  }
  return (
    '<div role="link" tabindex="0"><div>' +
    `<div data-testid="Tweet-User-Avatar"><div data-testid="UserAvatar-Container-${user}">` +
    '<div role="presentation" tabindex="-1" aria-hidden="true">' +
    `${avatar === null ? '' : `<img alt="" src="${avatar}">`}</div></div></div>` +
    '<div data-testid="User-Name">' +
    `<div><span><span>${options.name ?? 'Quoted Person'}</span></span>${options.verified === true ? BADGE : ''}</div>` +
    `<div><div tabindex="-1"><span>@${user}</span></div><div aria-hidden="true"><span>·</span></div>${timeBlock}</div>` +
    '</div></div>' +
    `<div>${media}<div data-testid="tweetText" dir="auto"><span>${options.text ?? 'quoted words'}</span></div></div>` +
    '</div>'
  );
}

export interface CardOptions {
  layout?: 'large' | 'small';
  href?: string;
  /** null: a card without a picture. */
  image?: string | null;
  domainLine?: string;
  title?: string;
}

/**
 * A link preview. The test ids come from the 2026-09-03 capture; the text
 * lines inside are an assumption until Task 14's capture confirms them.
 */
export function cardHtml(options: CardOptions = {}): string {
  const href = options.href ?? 'https://t.co/card';
  const media = options.layout === 'small' ? 'card.layoutSmall.media' : 'card.layoutLarge.media';
  const image =
    options.image === undefined ? 'https://pbs.twimg.com/card_img/1/c?format=jpg&name=small' : options.image;
  const link = `<a href="${href}" rel="noopener noreferrer nofollow" target="_blank" role="link">`;
  return (
    '<div data-testid="card.wrapper">' +
    `<div data-testid="${media}">${link}${image === null ? '' : `<div><img alt="" src="${image}"></div>`}` +
    `<div><span>${options.domainLine ?? '来自 example.com'}</span></div></a></div>` +
    `${link}<div><span>${options.title ?? 'A card title'}</span></div></a>` +
    '</div>'
  );
}

/** Replaces the document body with `html` and returns its first post. */
export function mountPost(html: string): HTMLElement {
  document.body.innerHTML = html;
  const root = document.querySelector<HTMLElement>('article[data-testid="tweet"]');
  if (root === null) throw new Error('no post root in the markup');
  return root;
}
```

- [ ] **Step 3：写失败测试**

`tests/unit/extract-author.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { readAuthor } from '@/hosts/x/extractAuthor';
import { pictureIn, readTime } from '@/hosts/x/extractPicture';
import { X_SELECTORS } from '@/hosts/x/selectors';
import { mountPost, postHtml, quoteHtml } from '../helpers/postDom';

const AVATAR = 'https://pbs.twimg.com/profile_images/1/alice_normal.jpg';

describe('readAuthor', () => {
  it('reads the display name, handle, check mark and avatar', () => {
    const root = mountPost(postHtml({ name: 'Alice A.', verified: true }));
    expect(readAuthor(root, [])).toEqual({
      hasHeader: true,
      authorName: 'Alice A.',
      handle: 'alice',
      verified: true,
      avatarUrl: AVATAR,
    });
  });

  it('reports no check mark when there is none', () => {
    expect(readAuthor(mountPost(postHtml()), []).verified).toBe(false);
  });

  it('reads an avatar painted only as a background', () => {
    expect(readAuthor(mountPost(postHtml({ avatarAs: 'background' })), []).avatarUrl).toBe(AVATAR);
  });

  it('leaves the avatar empty until it has loaded, and never takes a placeholder', () => {
    expect(readAuthor(mountPost(postHtml({ avatar: null })), []).avatarUrl).toBeNull();
    const placeholder = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    expect(readAuthor(mountPost(postHtml({ avatar: placeholder })), []).avatarUrl).toBeNull();
  });

  it('keeps the outer author and the quoted author apart', () => {
    const root = mountPost(postHtml({ quoteHtml: quoteHtml({ user: 'bob', name: 'Bob', verified: true }) }));
    const quote = root.querySelector(X_SELECTORS.quoteContainer);
    expect(quote).not.toBeNull();
    if (quote === null) return;
    expect(readAuthor(root, [quote])).toMatchObject({ authorName: 'Alice', handle: 'alice', verified: false });
    expect(readAuthor(quote, [])).toEqual({
      hasHeader: true,
      authorName: 'Bob',
      handle: 'bob',
      verified: true,
      avatarUrl: 'https://pbs.twimg.com/profile_images/2/bob_normal.jpg',
    });
  });

  it('knows when X has not rendered the header yet', () => {
    const root = mountPost('<article data-testid="tweet"><div data-testid="tweetText"><span>x</span></div></article>');
    expect(readAuthor(root, [])).toEqual({
      hasHeader: false,
      authorName: null,
      handle: null,
      verified: false,
      avatarUrl: null,
    });
  });
});

describe('readTime and pictureIn', () => {
  it('parses a datetime and rejects anything else', () => {
    const root = mountPost(postHtml({ datetime: '2026-09-28T10:00:00.000Z' }));
    const time = root.querySelector(X_SELECTORS.time);
    expect(readTime(time)).toBe(Date.UTC(2026, 8, 28, 10));
    time?.setAttribute('datetime', 'soon');
    expect(readTime(time)).toBeNull();
    expect(readTime(null)).toBeNull();
  });

  it('finds nothing in a missing scope', () => {
    expect(pictureIn(null)).toBeNull();
  });
});
```

- [ ] **Step 4：运行，确认失败**

Run: `pnpm vitest run tests/unit/extract-author.test.ts`
Expected: FAIL，`Failed to resolve import "@/hosts/x/extractAuthor"`

- [ ] **Step 5：图片与时间工具**

`src/hosts/x/extractPicture.ts`：

```ts
import { isAllowedImageUrl } from '@/utils/url';
import { X_SELECTORS } from './selectors';

const BACKGROUND_URL = /url\((['"]?)(.*?)\1\)/;

/** The first <img> in `scope` whose picture is on X's image server. */
export function firstAllowedImage(scope: Element): HTMLImageElement | null {
  for (const img of Array.from(scope.querySelectorAll<HTMLImageElement>(X_SELECTORS.image))) {
    if (isAllowedImageUrl(img.src)) return img;
  }
  return null;
}

/**
 * The first allowed picture in `scope`. X paints avatars and video posters
 * twice — as an <img> and as a CSS background — and either may still be
 * missing while the picture loads (a background tab has neither yet).
 */
export function pictureIn(scope: Element | null): string | null {
  if (scope === null) return null;
  const img = firstAllowedImage(scope);
  if (img !== null) return img.src;
  for (const element of Array.from(scope.querySelectorAll<HTMLElement>(X_SELECTORS.backgroundImage))) {
    const url = BACKGROUND_URL.exec(element.style.backgroundImage)?.[2];
    if (url !== undefined && isAllowedImageUrl(url)) return url;
  }
  return null;
}

/** Milliseconds from a `<time datetime>`, or null when it is missing or unparsable. */
export function readTime(time: Element | null): number | null {
  const value = time?.getAttribute('datetime') ?? null;
  if (value === null) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
```

- [ ] **Step 6：作者**

`src/hosts/x/extractAuthor.ts`：

```ts
import { findWhere, isInsideAny, readVisibleText } from '@/utils/dom';
import { pictureIn } from './extractPicture';
import { X_SELECTORS } from './selectors';

export interface AuthorParts {
  /** False while X has not rendered the header yet. */
  hasHeader: boolean;
  authorName: string | null;
  /** The visible @handle without "@". The permalink stays the post's identity. */
  handle: string | null;
  verified: boolean;
  avatarUrl: string | null;
}

const HANDLE = /^@([A-Za-z0-9_]{1,15})$/;
const NAME_MAX = 128;

/**
 * Reads one post header: the outer post (with its quote subtrees in
 * `exclude`) or a quote block (with nothing excluded).
 *
 * User-Name's leaf spans come in a fixed order — display name, "@handle", "·"
 * and the time — so the first non-handle text is the name. The check mark
 * sits inside User-Name, so a quoted author's mark is never the outer one's.
 */
export function readAuthor(scope: Element, exclude: readonly Element[]): AuthorParts {
  const userName = findWhere(scope, X_SELECTORS.userName, (candidate) => !isInsideAny(candidate, exclude));
  const avatar = findWhere(scope, X_SELECTORS.avatar, (candidate) => !isInsideAny(candidate, exclude));
  if (userName === null) {
    return { hasHeader: false, authorName: null, handle: null, verified: false, avatarUrl: pictureIn(avatar) };
  }

  let authorName: string | null = null;
  let handle: string | null = null;
  for (const span of Array.from(userName.querySelectorAll(X_SELECTORS.textRun))) {
    if (span.querySelector(X_SELECTORS.textRun) !== null) continue;
    if (span.closest(X_SELECTORS.time) !== null) continue;
    const text = readVisibleText(span).trim();
    if (text.length === 0 || text === '·') continue;
    const match = HANDLE.exec(text);
    if (match !== null) {
      handle ??= match[1] ?? null;
      continue;
    }
    if (text.startsWith('@')) continue;
    authorName ??= text.slice(0, NAME_MAX);
  }

  return {
    hasHeader: true,
    authorName,
    handle,
    verified: userName.querySelector(X_SELECTORS.verifiedBadge) !== null,
    avatarUrl: pictureIn(avatar),
  };
}
```

- [ ] **Step 7：运行，确认通过**

Run: `pnpm vitest run tests/unit/extract-author.test.ts`
Expected: PASS

- [ ] **Step 8：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add src/hosts/x/selectors.ts src/hosts/x/extractPicture.ts src/hosts/x/extractAuthor.ts \
  tests/helpers/postDom.ts tests/unit/extract-author.test.ts
git commit -m "提取帖子作者：显示名、@用户名、认证标记、头像与时间"
git push origin main
```

---

### Task 7：正文拆成结构化片段

**Files:**
- Create: `src/hosts/x/extractText.ts`
- Create: `tests/unit/extract-text.test.ts`

- [ ] **Step 1：写失败测试**

`tests/unit/extract-text.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { readSegments } from '@/hosts/x/extractText';
import { X_SELECTORS } from '@/hosts/x/selectors';
import { mountPost, postHtml } from '../helpers/postDom';

function segmentsOf(textHtml: string): ReturnType<typeof readSegments> {
  const root = mountPost(postHtml({ textHtml }));
  const text = root.querySelector(X_SELECTORS.tweetText);
  if (text === null) throw new Error('no tweetText');
  return readSegments(text);
}

describe('readSegments', () => {
  it('splits text, mentions, links, hashtags, emoji and newlines', () => {
    expect(
      segmentsOf(
        '<span>Hi </span><div><span><a href="/bob" role="link">@bob</a></span></div><span> see </span>' +
          '<a href="https://t.co/abc" target="_blank" role="link"><span aria-hidden="true">https://</span>' +
          'example.com/post<span aria-hidden="true">…</span></a>' +
          '<span> </span><span><a href="/hashtag/AI?src=hashtag_click" role="link">#AI</a></span>' +
          '<img alt="🎉" src="https://abs-0.twimg.com/emoji/v2/svg/1f389.svg"><br><span>line two</span>',
      ),
    ).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'mention', text: '@bob', username: 'bob' },
      { kind: 'text', text: ' see ' },
      { kind: 'link', text: 'https://example.com/post…', url: 'https://t.co/abc' },
      { kind: 'text', text: ' ' },
      { kind: 'hashtag', text: '#AI', tag: 'AI' },
      { kind: 'emoji', text: '🎉' },
      { kind: 'text', text: '\nline two' },
    ]);
  });

  it('trims the outer whitespace and keeps the inner newlines', () => {
    expect(segmentsOf('<span>  a</span><br><br><span>b  </span>')).toEqual([{ kind: 'text', text: 'a\n\nb' }]);
  });

  it('treats a cashtag search as a plain link', () => {
    expect(segmentsOf('<a href="/search?q=%24TSLA&amp;src=cashtag_click" role="link">$TSLA</a>')).toEqual([
      { kind: 'link', text: '$TSLA', url: 'https://x.com/search?q=%24TSLA&src=cashtag_click' },
    ]);
  });

  it('does not call a profile link a mention unless its text starts with "@"', () => {
    expect(segmentsOf('<a href="/bob" role="link">Bob</a>')).toEqual([
      { kind: 'link', text: 'Bob', url: 'https://x.com/bob' },
    ]);
  });

  it('decodes a non-ASCII hashtag', () => {
    expect(
      segmentsOf('<a href="/hashtag/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD?src=hashtag_click">#人工智能</a>'),
    ).toEqual([{ kind: 'hashtag', text: '#人工智能', tag: '人工智能' }]);
  });
});
```

- [ ] **Step 2：运行，确认失败**

Run: `pnpm vitest run tests/unit/extract-text.test.ts`
Expected: FAIL，`Failed to resolve import "@/hosts/x/extractText"`

- [ ] **Step 3：实现**

`src/hosts/x/extractText.ts`：

```ts
import type { TextSegment } from '@/core/domain/tweet';
import { readVisibleText } from '@/utils/dom';

const X_HOSTS: ReadonlySet<string> = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
const PROFILE_PATH = /^\/([A-Za-z0-9_]{1,15})$/;
const HASHTAG_PATH = /^\/hashtag\/([^/]+)$/;
const LEADING_SPACE = /^[\s﻿ ]+/;
const TRAILING_SPACE = /[\s﻿ ]+$/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function anchorSegment(anchor: HTMLAnchorElement): TextSegment | null {
  const text = readVisibleText(anchor);
  if (text.length === 0) return null;
  let url: URL;
  try {
    url = new URL(anchor.href);
  } catch {
    return { kind: 'text', text };
  }
  if (X_HOSTS.has(url.hostname)) {
    const profile = PROFILE_PATH.exec(url.pathname)?.[1];
    if (profile !== undefined && text.startsWith('@')) return { kind: 'mention', text, username: profile };
    const hashtag = HASHTAG_PATH.exec(url.pathname)?.[1];
    if (hashtag !== undefined) return { kind: 'hashtag', text, tag: safeDecode(hashtag) };
  }
  return { kind: 'link', text, url: url.href };
}

/**
 * Turns a tweetText block into segments. Structure decides the kind, never the
 * wording or styling: an <a> to a profile whose text starts with "@" is a
 * mention, an <a> to /hashtag/… a hashtag, any other <a> a link (t.co, cashtag
 * searches), an <img> an emoji whose alt is the character, and <br> a newline.
 * The outer whitespace is trimmed; inner newlines stay.
 */
export function readSegments(textRoot: Element): TextSegment[] {
  const out: TextSegment[] = [];
  const pushText = (text: string): void => {
    if (text.length === 0) return;
    const last = out[out.length - 1];
    if (last !== undefined && last.kind === 'text') last.text += text;
    else out.push({ kind: 'text', text });
  };

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.nodeValue ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (tag === 'br') {
      pushText('\n');
      return;
    }
    if (tag === 'img') {
      const alt = element.getAttribute('alt');
      if (alt !== null && alt.length > 0) out.push({ kind: 'emoji', text: alt });
      return;
    }
    if (tag === 'script' || tag === 'style' || tag === 'svg') return;
    if (element instanceof HTMLAnchorElement) {
      const segment = anchorSegment(element);
      if (segment !== null) out.push(segment);
      return;
    }
    for (const child of Array.from(element.childNodes)) visit(child);
  };

  visit(textRoot);

  const first = out[0];
  if (first?.kind === 'text') first.text = first.text.replace(LEADING_SPACE, '');
  const last = out[out.length - 1];
  if (last?.kind === 'text') last.text = last.text.replace(TRAILING_SPACE, '');
  return out.filter((segment) => segment.text.length > 0);
}
```

- [ ] **Step 4：运行，确认通过**

Run: `pnpm vitest run tests/unit/extract-text.test.ts`
Expected: PASS

- [ ] **Step 5：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add src/hosts/x/extractText.ts tests/unit/extract-text.test.ts
git commit -m "提取正文为结构化片段：文字、链接、@提及、#话题、表情"
git push origin main
```

---

### Task 8：提取图片 / 视频 / GIF 与链接卡片

**Files:**
- Create: `src/hosts/x/extractMedia.ts`
- Create: `tests/unit/extract-media.test.ts`

- [ ] **Step 1：写失败测试**

`tests/unit/extract-media.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { readCard, readMedia } from '@/hosts/x/extractMedia';
import { X_SELECTORS } from '@/hosts/x/selectors';
import { cardHtml, mountPost, postHtml, quoteHtml } from '../helpers/postDom';

const photo = (id: string): string => `https://pbs.twimg.com/media/${id}?format=jpg&name=small`;

function quotesOf(root: Element): Element[] {
  return Array.from(root.querySelectorAll(X_SELECTORS.quoteContainer));
}

describe('readMedia', () => {
  it('reads photos in page order, at most four', () => {
    const root = mountPost(postHtml({ photos: ['A', 'B', 'C', 'D', 'E'].map(photo) }));
    expect(readMedia(root, [])).toEqual(
      ['A', 'B', 'C', 'D'].map((id) => ({ kind: 'photo', url: photo(id), alt: '图像' })),
    );
  });

  it('reads a video poster, and a GIF by its poster path', () => {
    const video = 'https://pbs.twimg.com/amplify_video_thumb/1/img/v.jpg';
    const gif = 'https://pbs.twimg.com/tweet_video_thumb/g.jpg';
    expect(readMedia(mountPost(postHtml({ video: { poster: video } })), [])).toEqual([
      { kind: 'video', url: video, alt: null },
    ]);
    expect(readMedia(mountPost(postHtml({ video: { poster: gif } })), [])).toEqual([
      { kind: 'gif', url: gif, alt: null },
    ]);
  });

  it('falls back to the picture inside the cell when the poster attribute is missing', () => {
    const video = 'https://pbs.twimg.com/amplify_video_thumb/1/img/v.jpg';
    const root = mountPost(postHtml({ video: { poster: video } }));
    root.querySelector(X_SELECTORS.video)?.removeAttribute('poster');
    expect(readMedia(root, [])).toEqual([{ kind: 'video', url: video, alt: null }]);
  });

  it('skips a picture that has not loaded yet', () => {
    const root = mountPost(postHtml({ photos: ['data:image/gif;base64,R0lGODlhAQABAAAAACw=', photo('B')] }));
    expect(readMedia(root, []).map((item) => item.url)).toEqual([photo('B')]);
  });

  it('leaves the quoted post’s picture out of the outer post', () => {
    const root = mountPost(postHtml({ photos: [photo('OUT')], quoteHtml: quoteHtml({ photo: photo('IN') }) }));
    expect(readMedia(root, quotesOf(root)).map((item) => item.url)).toEqual([photo('OUT')]);
  });
});

describe('readCard', () => {
  it('reads a large card: link, domain, title and picture', () => {
    const root = mountPost(postHtml({ cardHtml: cardHtml() }));
    expect(readCard(root, [])).toEqual({
      url: 'https://t.co/card',
      layout: 'large',
      title: 'A card title',
      domain: 'example.com',
      imageUrl: 'https://pbs.twimg.com/card_img/1/c?format=jpg&name=small',
    });
  });

  it('knows a small card and one without a picture', () => {
    const root = mountPost(postHtml({ cardHtml: cardHtml({ layout: 'small', image: null, domainLine: 'news.example.org' }) }));
    expect(readCard(root, [])).toMatchObject({ layout: 'small', domain: 'news.example.org', imageUrl: null });
  });

  it('keeps a title that merely ends in a dotted word', () => {
    const root = mountPost(postHtml({ cardHtml: cardHtml({ title: 'Why I still use Node.js' }) }));
    expect(readCard(root, [])?.title).toBe('Why I still use Node.js');
  });

  it('finds no card where there is none, or only inside the quote', () => {
    expect(readCard(mountPost(postHtml()), [])).toBeNull();
    const root = mountPost(postHtml({ quoteHtml: quoteHtml().replace('<div data-testid="tweetText"', `${cardHtml()}<div data-testid="tweetText"`) }));
    expect(readCard(root, quotesOf(root))).toBeNull();
  });
});
```

- [ ] **Step 2：运行，确认失败**

Run: `pnpm vitest run tests/unit/extract-media.test.ts`
Expected: FAIL，`Failed to resolve import "@/hosts/x/extractMedia"`

- [ ] **Step 3：实现**

`src/hosts/x/extractMedia.ts`：

```ts
import type { LinkCard, MediaItem } from '@/core/domain/tweet';
import { findWhere, isInsideAny, readVisibleText } from '@/utils/dom';
import { isAllowedImageUrl } from '@/utils/url';
import { firstAllowedImage, pictureIn } from './extractPicture';
import { X_SELECTORS } from './selectors';

const MEDIA_MAX = 4;
const GIF_POSTER = '/tweet_video_thumb/';
const TITLE_MAX = 300;
/** A line that is a bare domain, optionally after one word ("来自 example.com", "From example.com"). */
const DOMAIN_LINE = /^(?:\S+\s+)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/i;

function mediaFrom(cell: Element): MediaItem | null {
  const video = cell.querySelector(X_SELECTORS.video);
  if (video !== null) {
    const attribute = video.getAttribute('poster');
    const poster = attribute !== null && isAllowedImageUrl(attribute) ? attribute : pictureIn(cell);
    if (poster === null) return null;
    return { kind: poster.includes(GIF_POSTER) ? 'gif' : 'video', url: poster, alt: null };
  }
  const img = firstAllowedImage(cell);
  if (img === null) return null;
  return { kind: 'photo', url: img.src, alt: img.getAttribute('alt') };
}

/**
 * The post's pictures and video posters in page order. Each tweetPhoto cell is
 * one item: a cell holding a <video> is a video — or a GIF, by its poster
 * path — and anything else a photo. Cells inside `exclude` (the quote) are not
 * the post's own; a cell whose picture has not loaded yet is skipped.
 */
export function readMedia(scope: Element, exclude: readonly Element[]): MediaItem[] {
  const items: MediaItem[] = [];
  for (const cell of Array.from(scope.querySelectorAll(X_SELECTORS.mediaCell))) {
    if (isInsideAny(cell, exclude)) continue;
    const item = mediaFrom(cell);
    if (item !== null) items.push(item);
    if (items.length === MEDIA_MAX) break;
  }
  return items;
}

/** Non-empty text of every leaf span, in page order. */
function leafTexts(scope: Element): string[] {
  const out: string[] = [];
  for (const span of Array.from(scope.querySelectorAll(X_SELECTORS.textRun))) {
    if (span.querySelector(X_SELECTORS.textRun) !== null) continue;
    const text = readVisibleText(span).trim();
    if (text.length > 0) out.push(text);
  }
  return out;
}

/**
 * The post's link preview. The layout comes from X's test ids; the domain is
 * the first text line shaped like a bare domain and the title the first other
 * line. Reading the shape of the text rather than its wording keeps this
 * independent of X's interface language.
 */
export function readCard(scope: Element, exclude: readonly Element[]): LinkCard | null {
  const card = findWhere(scope, X_SELECTORS.card, (candidate) => !isInsideAny(candidate, exclude));
  if (card === null) return null;
  const anchor = card.querySelector(X_SELECTORS.anyLink);
  if (!(anchor instanceof HTMLAnchorElement)) return null;

  let domain: string | null = null;
  let title: string | null = null;
  for (const line of leafTexts(card)) {
    const found = DOMAIN_LINE.exec(line)?.[1];
    if (found !== undefined) domain ??= found.toLowerCase();
    else title ??= line.slice(0, TITLE_MAX);
  }
  return {
    url: anchor.href,
    layout: card.querySelector(X_SELECTORS.cardSmallMedia) !== null ? 'small' : 'large',
    title,
    domain,
    imageUrl: pictureIn(card),
  };
}
```

- [ ] **Step 4：运行，确认通过**

Run: `pnpm vitest run tests/unit/extract-media.test.ts`
Expected: PASS

- [ ] **Step 5：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add src/hosts/x/extractMedia.ts tests/unit/extract-media.test.ts
git commit -m "提取帖子的图片、视频与 GIF 封面，以及链接预览卡片"
git push origin main
```

---

### Task 9：提取引用帖并汇总成完整快照

**Files:**
- Create: `src/hosts/x/extractQuote.ts`
- Modify: `src/hosts/x/TweetExtractor.ts`（去掉 `outerText`、`outerAuthorName`，改用上面四个模块）
- Create: `tests/unit/tweet-extractor-snapshot.test.ts`

- [ ] **Step 1：写失败测试**

`tests/unit/tweet-extractor-snapshot.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { extractTweet, type ExtractOutcome } from '@/hosts/x/TweetExtractor';
import { cardHtml, mountPost, postHtml, quoteHtml } from '../helpers/postDom';

const NOW = 1_700_000_000_000;
const photo = (id: string): string => `https://pbs.twimg.com/media/${id}?format=jpg&name=small`;

function extract(html: string, pathname = '/home'): Extract<ExtractOutcome, { status: 'ok' }>['record'] {
  const outcome = extractTweet(mountPost(html), { pathname, now: NOW });
  if (outcome.status !== 'ok') throw new Error(`not extracted: ${outcome.reason}`);
  return outcome.record;
}

describe('extractTweet snapshot', () => {
  it('assembles everything a card shows', () => {
    const record = extract(
      postHtml({
        verified: true,
        textHtml: '<span>Hi </span><div><span><a href="/bob" role="link">@bob</a></span></div>',
        showMore: true,
        photos: [photo('P1')],
        cardHtml: cardHtml(),
        quoteHtml: quoteHtml({ photo: photo('Q1') }),
      }),
    );
    expect(record).toMatchObject({
      tweetId: '1234567890',
      canonicalUrl: 'https://x.com/alice/status/1234567890',
      authorName: 'Alice',
      verified: true,
      avatarUrl: 'https://pbs.twimg.com/profile_images/1/alice_normal.jpg',
      postedAt: Date.UTC(2026, 8, 28, 10),
      text: 'Hi @bob',
      segments: [
        { kind: 'text', text: 'Hi ' },
        { kind: 'mention', text: '@bob', username: 'bob' },
      ],
      truncated: true,
      media: [{ kind: 'photo', url: photo('P1'), alt: '图像' }],
      card: { url: 'https://t.co/card', layout: 'large', domain: 'example.com', title: 'A card title' },
      quote: {
        authorName: 'Quoted Person',
        username: 'quoted',
        verified: false,
        avatarUrl: 'https://pbs.twimg.com/profile_images/2/quoted_normal.jpg',
        postedAt: Date.UTC(2026, 8, 27, 8),
        text: 'quoted words',
        media: { kind: 'photo', url: photo('Q1'), alt: '图像' },
        url: null,
      },
      capturedAt: NOW,
      updatedAt: NOW,
    });
  });

  it('fills the quote link when X renders a timestamped link inside it', () => {
    const record = extract(postHtml({ quoteHtml: quoteHtml({ linkId: '42' }) }));
    expect(record.quote?.url).toBe('https://x.com/quoted/status/42');
  });

  it('stores no quote picture for covered sensitive media', () => {
    expect(extract(postHtml({ quoteHtml: quoteHtml({ interstitial: true }) })).quote?.media).toBeNull();
  });

  it('reads the time of a post’s own page from its permalink row and marks nothing truncated', () => {
    const record = extract(postHtml({ focused: true }), '/alice/status/1234567890');
    expect(record.postedAt).toBe(Date.UTC(2026, 8, 28, 10));
    expect(record.truncated).toBe(false);
  });

  it('gives a media-only post empty text rather than the quote’s words', () => {
    const record = extract(postHtml({ textHtml: null, quoteHtml: quoteHtml() }));
    expect(record.text).toBe('');
    expect(record.segments).toEqual([]);
  });
});
```

- [ ] **Step 2：运行，确认失败**

Run: `pnpm vitest run tests/unit/tweet-extractor-snapshot.test.ts`
Expected: FAIL —— `verified`、`avatarUrl`、`postedAt`、`media`、`card`、`quote`、`truncated` 都还是默认值

- [ ] **Step 3：引用帖**

`src/hosts/x/extractQuote.ts`：

```ts
import { TWEET_TEXT_MAX } from '@/core/constants';
import type { QuotedPost } from '@/core/domain/tweet';
import { findWhere, readVisibleText } from '@/utils/dom';
import { trimTweetText } from '@/utils/text';
import { parseStatusUrl } from '@/utils/url';
import { readAuthor } from './extractAuthor';
import { readMedia } from './extractMedia';
import { readTime } from './extractPicture';
import { X_SELECTORS } from './selectors';

/**
 * A quote block as the card shows it: author, plain text, first picture.
 *
 * Measured on 2026-09-29, the block carries no link to the quoted post — its
 * time sits in a plain div — so `url` is filled only when X does render a
 * timestamped status link inside it, as older captures had.
 */
export function readQuote(quote: Element): QuotedPost {
  const author = readAuthor(quote, []);
  const textNode = quote.querySelector(X_SELECTORS.tweetText);
  const link = findWhere(
    quote,
    X_SELECTORS.statusLink,
    (candidate) => candidate.querySelector(X_SELECTORS.time) !== null,
  );
  const parsed = link instanceof HTMLAnchorElement ? parseStatusUrl(link.href) : null;
  return {
    authorName: author.authorName,
    username: author.handle,
    verified: author.verified,
    avatarUrl: author.avatarUrl,
    postedAt: readTime(quote.querySelector(X_SELECTORS.time)),
    text: textNode === null ? '' : trimTweetText(readVisibleText(textNode), TWEET_TEXT_MAX),
    media: readMedia(quote, [])[0] ?? null,
    url: parsed === null ? null : parsed.canonicalUrl,
  };
}
```

- [ ] **Step 4：汇总**

`src/hosts/x/TweetExtractor.ts`：

1. 导入部分改为：

```ts
import { segmentsToText } from '@/core/domain/snapshot';
import type { TweetRecord } from '@/core/domain/tweet';
import { findWhere, isInsideAny } from '@/utils/dom';
import { parseStatusUrl } from '@/utils/url';
import { readAuthor } from './extractAuthor';
import { readCard, readMedia } from './extractMedia';
import { readTime } from './extractPicture';
import { readQuote } from './extractQuote';
import { readSegments } from './extractText';
import { X_SELECTORS } from './selectors';
```

2. 删除 `outerText` 和 `outerAuthorName` 两个函数。
3. `findIdentityAnchor` 里的 `candidate.querySelector('time')` 改为 `candidate.querySelector(X_SELECTORS.time)`。
4. `extractTweet` 末尾的 `return { status: 'ok', record: … };` 替换为：

```ts
  const author = readAuthor(root, quotes);
  const textRoot = findWhere(root, X_SELECTORS.tweetText, (candidate) => !isInsideAny(candidate, quotes));
  // The FIRST outer tweetText, never a concatenation: a quote tweet with no
  // commentary of its own must yield empty text, not the quoted author's words.
  const segments = textRoot === null ? [] : readSegments(textRoot);
  const quoteRoot = quotes[0];
  const record: TweetRecord = {
    tweetId,
    canonicalUrl,
    username,
    // As in v0.1: a rendered header without a readable name shows the handle.
    authorName: author.authorName ?? (author.hasHeader ? username : null),
    avatarUrl: author.avatarUrl,
    verified: author.verified,
    postedAt: readTime(anchor?.querySelector(X_SELECTORS.time) ?? null),
    text: segmentsToText(segments),
    segments,
    media: readMedia(root, quotes),
    quote: quoteRoot === undefined ? null : readQuote(quoteRoot),
    card: readCard(root, quotes),
    truncated: findWhere(root, X_SELECTORS.showMore, (candidate) => !isInsideAny(candidate, quotes)) !== null,
    capturedAt: context.now,
    updatedAt: context.now,
  };
  return { status: 'ok', record };
```

- [ ] **Step 5：运行，确认通过，且旧样本上的提取行为不变**

Run: `pnpm vitest run tests/unit/tweet-extractor-snapshot.test.ts tests/unit/tweet-extractor.test.ts tests/unit/tweet-enhancer.test.ts tests/unit/spa-resilience.test.ts`
Expected: 全部 PASS

- [ ] **Step 6：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add src/hosts/x/extractQuote.ts src/hosts/x/TweetExtractor.ts tests/unit/tweet-extractor-snapshot.test.ts
git commit -m "提取引用帖，并把作者、正文、媒体、卡片、截断标记汇总成完整快照"
git push origin main
```

---

### Task 10：已保存的帖子再次出现时补全快照

工单 2.4：时间线上被「显示更多」截断的长帖先存看得到的部分，以后在详情页等地方看到完整内容时自动补全。做法：内容脚本知道哪些帖子已保存（按钮的计数），这些帖子每次被读到新内容时交给 `SnapshotRefresher`，它按「这次比上次多看到了什么」去重、批量发给新的 `tweets.refresh`；后台只合并已存在的行，从不新建，内容没变就不写。保存那一刻也改为重新读一次页面（头像、图片是懒加载的）。

**Files:**
- Modify: `src/core/constants.ts`、`src/messaging/protocol.ts`、`src/messaging/validate.ts`、`src/messaging/RpcClient.ts`
- Modify: `src/background/services/TweetSaveService.ts`、`src/background/rpc/handlers.ts`
- Create: `src/hosts/x/SnapshotRefresher.ts`
- Modify: `src/hosts/x/TweetEnhancer.ts`、`src/hosts/x/XRuntime.ts`
- Create: `tests/unit/tweets-refresh.test.ts`、`tests/unit/snapshot-refresher.test.ts`
- Modify: `tests/unit/tweet-enhancer.test.ts`

- [ ] **Step 1：写失败测试（后台）**

`tests/unit/tweets-refresh.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { XFoldersDatabase } from '@/background/db/XFoldersDatabase';
import { FolderService } from '@/background/services/FolderService';
import { TweetSaveService } from '@/background/services/TweetSaveService';
import { CHANGE_CHANNEL_KEY } from '@/core/constants';
import { freshDatabase, tweetFixture } from '../helpers/db';

async function lastChange(): Promise<unknown> {
  return (await chrome.storage.local.get(CHANGE_CHANNEL_KEY))[CHANGE_CHANNEL_KEY];
}

describe('TweetSaveService.refresh', () => {
  let db: XFoldersDatabase;
  let service: TweetSaveService;

  beforeEach(async () => {
    db = await freshDatabase();
    service = new TweetSaveService(db);
    const folder = await new FolderService(db).create('AI', null);
    await service.save(folder.id, { ...tweetFixture('1', { text: 'cut' }), truncated: true });
    await chrome.storage.local.set({ [CHANGE_CHANNEL_KEY]: null });
  });

  it('completes a saved post and tells the other pages', async () => {
    const result = await service.refresh([tweetFixture('1', { text: 'cut, then the whole post' })]);
    expect(result).toEqual({ updated: ['1'] });
    expect((await db.tweets.get('1'))?.text).toBe('cut, then the whole post');
    expect(await lastChange()).toMatchObject({ foldersChanged: false, affectedTweetIds: ['1'] });
  });

  it('ignores unsaved posts, and stays silent when nothing changed', async () => {
    const same = { ...tweetFixture('1', { text: 'cut' }), truncated: true };
    expect(await service.refresh([same, tweetFixture('2')])).toEqual({ updated: [] });
    expect(await db.tweets.get('2')).toBeUndefined();
    expect(await lastChange()).toBeNull();
  });
});
```

- [ ] **Step 2：写失败测试（内容脚本）**

`tests/unit/snapshot-refresher.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TweetRecord } from '@/core/domain/tweet';
import { SnapshotRefresher } from '@/hosts/x/SnapshotRefresher';
import { tweetFixture } from '../helpers/db';

describe('SnapshotRefresher', () => {
  let sent: TweetRecord[][];
  let refresher: SnapshotRefresher;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    refresher = new SnapshotRefresher(async (records) => {
      sent.push(records);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('merges sightings into one message', async () => {
    refresher.offer(tweetFixture('1'));
    refresher.offer(tweetFixture('2'));
    await vi.runAllTimersAsync();
    expect(sent.map((batch) => batch.map((record) => record.tweetId))).toEqual([['1', '2']]);
  });

  it('sends a post again only when the page shows more of it', async () => {
    const cut = { ...tweetFixture('1', { text: 'cut' }), truncated: true };
    refresher.offer(cut);
    await vi.runAllTimersAsync();
    refresher.offer(cut);
    await vi.runAllTimersAsync();
    refresher.offer(tweetFixture('1', { text: 'cut, then the whole post' }));
    await vi.runAllTimersAsync();
    expect(sent.map((batch) => batch.map((record) => record.truncated))).toEqual([[true], [false]]);
  });

  it('splits a burst into capped batches', async () => {
    for (let index = 1; index <= 25; index += 1) refresher.offer(tweetFixture(String(index)));
    await vi.runAllTimersAsync();
    expect(sent.map((batch) => batch.length)).toEqual([20, 5]);
  });
});
```

在 `tests/unit/tweet-enhancer.test.ts` 顶部导入里加 `import { mountPost, postHtml } from '../helpers/postDom';`，并在最外层 `describe('TweetEnhancer', …)` 的末尾加：

```ts
  it('re-reads a post when it is saved, keeping pictures that loaded late', () => {
    const { enhancer } = makeEnhancer();
    const root = mountPost(postHtml({ avatar: null }));
    enhancer.enqueue([root]);
    enhancer.drain(1_000);
    expect(enhancer.recordFor('1234567890')?.avatarUrl).toBeNull();

    const late = document.createElement('img');
    late.src = 'https://pbs.twimg.com/profile_images/1/alice_normal.jpg';
    root.querySelector(X_SELECTORS.avatar)?.appendChild(late);
    const host = root.querySelector<HTMLElement>(`[${XF_ATTR.actionHost}]`);
    expect(host).not.toBeNull();
    if (host === null) return;
    expect(enhancer.freshRecord('1234567890', host)?.avatarUrl).toBe(late.src);
    expect(enhancer.recordFor('1234567890')?.avatarUrl).toBe(late.src);
  });

  it('hands each capture of a post known to be saved to the refresher', () => {
    const registry = new CleanupRegistry();
    const counts = new VisibleTweetStore();
    counts.attach(registry);
    counts.setLocal('1234567890', 1);
    const sightings: string[] = [];
    const enhancer = new TweetEnhancer(new TweetActionInjector(() => {}), counts, registry, (record) => {
      sightings.push(record.tweetId);
    });
    enhancer.enqueue([mountPost(postHtml())]);
    enhancer.drain(1_000);
    enhancer.enqueue([mountPost(postHtml({ id: '999', user: 'other' }))]);
    enhancer.drain(1_000);
    expect(sightings).toEqual(['1234567890']);
  });
```

- [ ] **Step 3：运行，确认失败**

Run: `pnpm vitest run tests/unit/tweets-refresh.test.ts tests/unit/snapshot-refresher.test.ts tests/unit/tweet-enhancer.test.ts`
Expected: FAIL —— `service.refresh is not a function`；`Failed to resolve import "@/hosts/x/SnapshotRefresher"`；`enhancer.freshRecord is not a function`

- [ ] **Step 4：常量与协议**

`src/core/constants.ts` 在 `MEMBERSHIP_COUNT_BATCH_MAX` 下面加：

```ts
/** Largest batch accepted by `tweets.refresh`; one snapshot can be a few kilobytes. */
export const SNAPSHOT_REFRESH_BATCH_MAX = 20;
```

`src/messaging/protocol.ts`：
1. 在 `RemoveTweetPayload` 下面加：

```ts
export interface RefreshTweetsPayload {
  tweets: TweetRecord[];
}
```

2. 在 `RemoveTweetResult` 下面加：

```ts
export interface RefreshTweetsResult {
  /** Posts whose stored snapshot actually changed. */
  updated: TweetId[];
}
```

3. `RpcMethods` 里 `'memberships.listFolderTweets'` 之后加 `'tweets.refresh': { payload: RefreshTweetsPayload; result: RefreshTweetsResult };`
4. `RPC_METHODS` 数组里 `'memberships.listFolderTweets',` 之后加 `'tweets.refresh',`

- [ ] **Step 5：校验与重试白名单**

`src/messaging/validate.ts`：导入里加上 `SNAPSHOT_REFRESH_BATCH_MAX`（来自 `@/core/constants`）和 `RefreshTweetsPayload`（来自 `./protocol`），`VALIDATORS` 里 `'memberships.listFolderTweets'` 之后加：

```ts
  'tweets.refresh': (payload): RefreshTweetsPayload => {
    const raw = asRecord(payload, 'payload');
    if (!Array.isArray(raw.tweets)) bad('tweets');
    if (raw.tweets.length > SNAPSHOT_REFRESH_BATCH_MAX) bad('tweets 超过单批上限');
    const now = Date.now();
    return { tweets: raw.tweets.map((tweet) => sanitizeSnapshot(tweet, now)) };
  },
```

`src/messaging/RpcClient.ts`：`RETRYABLE_METHODS` 里 `'memberships.saveTweet',` 之后加 `'tweets.refresh',`；上方注释的列表里 saveTweet 那一条后面加一行：

```ts
 *   - tweets.refresh, which only ever completes a snapshot, so applying it
 *     twice is the same as applying it once;
```

- [ ] **Step 6：后台服务与处理器**

`src/background/services/TweetSaveService.ts`：协议导入里加 `RefreshTweetsResult`，在 `remove` 方法后面加：

```ts
  /**
   * Folds later sightings into posts that are already saved (work order 2.4: a
   * long post cut short on the timeline is completed once its full text has
   * been seen). Never creates a row — an unsaved post stays unsaved — and only
   * broadcasts when a stored snapshot actually changed.
   */
  async refresh(incoming: readonly TweetRecord[]): Promise<RefreshTweetsResult> {
    const updated = await this.db.transaction('rw', this.db.tweets, async (): Promise<TweetId[]> => {
      const changed: TweetId[] = [];
      for (const record of incoming) {
        if ((await this.tweets.refresh(record)) !== null) changed.push(record.tweetId);
      }
      return changed;
    });
    if (updated.length > 0) await broadcast({ affectedTweetIds: updated });
    return { updated };
  }
```

`src/background/rpc/handlers.ts`：协议导入里加 `RefreshTweetsPayload`，`'memberships.listFolderTweets'` 之后加：

```ts
    'tweets.refresh': async (payload) =>
      tweetService().refresh((payload as RefreshTweetsPayload).tweets),
```

- [ ] **Step 7：刷新器**

`src/hosts/x/SnapshotRefresher.ts`：

```ts
import { SNAPSHOT_REFRESH_BATCH_MAX } from '@/core/constants';
import type { TweetId, TweetRecord } from '@/core/domain/tweet';
import { rpc } from '@/messaging/RpcClient';
import type { CleanupRegistry } from '@/utils/cleanup';

/** Window in which sightings are merged into one message. */
const BATCH_WINDOW_MS = 250;
/** Remembered signatures before starting over; bounds memory in a long session. */
const SEEN_MAX = 5_000;

export type RefreshSender = (records: TweetRecord[]) => Promise<void>;

async function sendToBackground(records: TweetRecord[]): Promise<void> {
  await rpc('tweets.refresh', { tweets: records });
}

/**
 * What a capture shows that can only grow as the page finishes rendering. A
 * post is sent again only when this changes: scrolling past a saved post a
 * second time costs nothing, while seeing its full text on its own page after
 * a truncated sighting — or its pictures finally loaded — still gets through.
 */
function signature(record: TweetRecord): string {
  return [
    record.tweetId,
    record.truncated ? 'cut' : 'full',
    record.text.length,
    record.media.length,
    record.avatarUrl === null ? 0 : 1,
    record.quote === null ? 0 : 1,
    record.card === null ? 0 : 1,
  ].join(':');
}

/**
 * Sends fresh captures of already-saved posts back to the database. Only posts
 * the page knows are saved are offered; the background ignores anything it
 * does not have, so a stale count costs one wasted message at most.
 */
export class SnapshotRefresher {
  readonly #pending = new Map<TweetId, TweetRecord>();
  readonly #seen = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly send: RefreshSender = sendToBackground) {}

  attach(registry: CleanupRegistry): void {
    registry.add(() => {
      if (this.#timer !== null) clearTimeout(this.#timer);
      this.#timer = null;
      this.#pending.clear();
      this.#seen.clear();
    });
  }

  offer(record: TweetRecord): void {
    const key = signature(record);
    if (this.#seen.has(key)) return;
    if (this.#seen.size >= SEEN_MAX) this.#seen.clear();
    this.#seen.add(key);
    this.#pending.set(record.tweetId, record);
    if (this.#timer !== null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#flush();
    }, BATCH_WINDOW_MS);
  }

  async #flush(): Promise<void> {
    const records = [...this.#pending.values()];
    this.#pending.clear();
    for (let index = 0; index < records.length; index += SNAPSHOT_REFRESH_BATCH_MAX) {
      await this.send(records.slice(index, index + SNAPSHOT_REFRESH_BATCH_MAX));
    }
  }
}
```

- [ ] **Step 8：增强器**

`src/hosts/x/TweetEnhancer.ts`：

1. 构造函数改为：

```ts
  constructor(
    private readonly injector: TweetActionInjector,
    private readonly counts: VisibleTweetStore,
    registry: CleanupRegistry,
    /** Receives every capture of a post already known to be saved. */
    private readonly onSavedSighting: (record: TweetRecord) => void = () => {},
  ) {
```

（函数体不变。）

2. 在 `recordFor` 后面加：

```ts
  /**
   * The capture to save. Re-reads the post from the page first: the capture
   * taken when it scrolled in may predate its lazily loaded avatar and
   * pictures, and what is saved is what the folder view will show.
   */
  freshRecord(tweetId: TweetId, anchor: HTMLElement): TweetRecord | null {
    const root = anchor.closest<HTMLElement>(X_SELECTORS.tweetRoot);
    if (root !== null) {
      const outcome = extractTweet(root, { pathname: location.pathname, now: Date.now() });
      if (outcome.status === 'ok' && outcome.record.tweetId === tweetId) {
        this.#records.set(tweetId, outcome.record);
        return outcome.record;
      }
    }
    return this.recordFor(tweetId);
  }
```

3. `drain()` 里的

```ts
      this.injector.ensure(root, {
        tweetId: record.tweetId,
        savedCount: this.counts.countFor(record.tweetId),
      });
```

改为：

```ts
      const savedCount = this.counts.countFor(record.tweetId);
      this.injector.ensure(root, { tweetId: record.tweetId, savedCount });
      if (savedCount > 0) this.onSavedSighting(record);
```

- [ ] **Step 9：运行时接线**

`src/hosts/x/XRuntime.ts`：
1. 导入加 `import { SnapshotRefresher } from './SnapshotRefresher';`
2. 字段里 `readonly #counts = new VisibleTweetStore();` 下面加 `readonly #refresher = new SnapshotRefresher();`
3. 构造 enhancer 改为：

```ts
    this.#enhancer = new TweetEnhancer(this.#injector, this.#counts, this.#registry, (record) =>
      this.#refresher.offer(record),
    );
```

4. `resolveTweet` 改为 `resolveTweet: (tweetId, anchor) => this.#enhancer.freshRecord(tweetId, anchor),`
5. `start()` 里 `this.#counts.attach(this.#registry);` 下面加 `this.#refresher.attach(this.#registry);`，并把

```ts
    this.#counts.subscribe(() => this.#enhancer.refreshButtons());
```

改为：

```ts
    this.#counts.subscribe((counts) => {
      this.#enhancer.refreshButtons();
      // Saved posts on screen: fold what the page shows now into their snapshots.
      for (const [tweetId, count] of counts) {
        if (count === 0) continue;
        const record = this.#enhancer.recordFor(tweetId);
        if (record !== null) this.#refresher.offer(record);
      }
    });
```

- [ ] **Step 10：运行，确认通过**

Run: `pnpm vitest run tests/unit/tweets-refresh.test.ts tests/unit/snapshot-refresher.test.ts tests/unit/tweet-enhancer.test.ts tests/unit/rpc-contract.test.ts tests/unit/xruntime-scan.test.ts tests/unit/spa-resilience.test.ts`
Expected: PASS

- [ ] **Step 11：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add src/core/constants.ts src/messaging/protocol.ts src/messaging/validate.ts src/messaging/RpcClient.ts \
  src/background/services/TweetSaveService.ts src/background/rpc/handlers.ts \
  src/hosts/x/SnapshotRefresher.ts src/hosts/x/TweetEnhancer.ts src/hosts/x/XRuntime.ts \
  tests/unit/tweets-refresh.test.ts tests/unit/snapshot-refresher.test.ts tests/unit/tweet-enhancer.test.ts
git commit -m "已保存的帖子再次出现时补全快照；保存时重新读取页面"
git push origin main
```

---

### Task 11：富卡片组件（页面内与侧边栏共用）

**Files:**
- Create: `src/ui/shared/Icon.tsx`
- Modify: `src/ui/shared/icons.ts`（播放图标）
- Create: `src/ui/tweet-card/format.ts`、`SafeImage.tsx`、`Avatar.tsx`、`VerifiedBadge.tsx`、`TweetText.tsx`、`MediaGrid.tsx`、`QuoteBlock.tsx`、`LinkCardView.tsx`、`TweetCard.tsx`、`tweetCard.css.ts`
- Create: `tests/unit/tweet-card.test.tsx`

外观对照 X：左侧 40px 圆头像；名字行 = 粗体昵称 + 认证标记 + 灰色 @用户名 · 时间；正文 15px、保留换行，链接 / @ / # 为蓝色；1–4 图按 X 的方式排成 16:9 的圆角网格；视频 / GIF 只显示封面加播放标记或「GIF」角标；引用帖是圆角边框里的小头像作者行 + 左侧小图 + 最多 4 行正文；有图时不显示链接卡片（与 X 相同）。不显示点赞等数字。认证标记是自己画的蓝底白勾，不用 X 的图案。

- [ ] **Step 1：写失败测试**

`tests/unit/tweet-card.test.tsx`：

```tsx
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { TweetRecord } from '@/core/domain/tweet';
import { displayLinkText, formatDay, formatPostedAt } from '@/ui/tweet-card/format';
import { TweetCard, type OpenOptions } from '@/ui/tweet-card/TweetCard';
import { tweetFixture } from '../helpers/db';

const NOW = new Date(2026, 8, 29, 12, 0).getTime();
const photo = (id: string): string => `https://pbs.twimg.com/media/${id}?format=jpg&name=small`;
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const RICH: TweetRecord = {
  ...tweetFixture('1'),
  authorName: 'Alice',
  verified: true,
  avatarUrl: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
  postedAt: new Date(2026, 8, 29, 9, 0).getTime(),
  text: 'Hi @bob https://example.com/a/very/long/path/indeed… #AI',
  segments: [
    { kind: 'text', text: 'Hi ' },
    { kind: 'mention', text: '@bob', username: 'bob' },
    { kind: 'text', text: ' ' },
    { kind: 'link', text: 'https://example.com/a/very/long/path/indeed…', url: 'https://t.co/abc' },
    { kind: 'text', text: ' ' },
    { kind: 'hashtag', text: '#AI', tag: 'AI' },
  ],
  media: [
    { kind: 'photo', url: photo('A'), alt: '图像' },
    { kind: 'video', url: 'https://pbs.twimg.com/amplify_video_thumb/1/img/v.jpg', alt: null },
  ],
};

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  // A target=_blank link would try to navigate jsdom. Only those are stopped
  // here, so what the card itself prevents stays observable.
  container.addEventListener(
    'click',
    (event) => {
      if (event.target instanceof Element && event.target.closest('a[target="_blank"]') !== null) {
        event.preventDefault();
      }
    },
    true,
  );
});

afterEach(() => {
  render(null, container);
  container.remove();
});

function draw(tweet: TweetRecord): Mock<(url: string, options: OpenOptions) => void> {
  const onOpen = vi.fn<(url: string, options: OpenOptions) => void>();
  render(<TweetCard tweet={tweet} now={NOW} onOpen={onOpen} />, container);
  return onOpen;
}

describe('TweetCard', () => {
  it('shows the author line like X: name, check mark, handle and time', () => {
    draw(RICH);
    expect(container.querySelector('.xf-tc-name')?.textContent).toBe('Alice');
    expect(container.querySelector('.xf-tc-verified')).not.toBeNull();
    expect(container.querySelector('.xf-tc-time')?.textContent).toBe('3小时');
    expect(container.querySelector<HTMLImageElement>('img.xf-tc-avatar')?.src).toBe(
      'https://pbs.twimg.com/profile_images/1/a_bigger.jpg',
    );
  });

  it('turns mentions, links and hashtags into links that open in a new tab', () => {
    draw(RICH);
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('.xf-tc-text a'));
    expect(links.map((a) => [a.textContent, a.getAttribute('href'), a.target])).toEqual([
      ['@bob', 'https://x.com/bob', '_blank'],
      ['example.com/a/very/long/path/i…', 'https://t.co/abc', '_blank'],
      ['#AI', 'https://x.com/hashtag/AI', '_blank'],
    ]);
  });

  it('lays out the pictures and marks the video poster', () => {
    draw(RICH);
    expect(container.querySelector('.xf-tc-media')?.getAttribute('data-count')).toBe('2');
    expect(Array.from(container.querySelectorAll<HTMLImageElement>('.xf-tc-media img')).map((img) => img.src)).toEqual([
      photo('A'),
      'https://pbs.twimg.com/amplify_video_thumb/1/img/v.jpg',
    ]);
    expect(container.querySelectorAll('.xf-tc-play')).toHaveLength(1);
  });

  it('never renders a picture from outside pbs.twimg.com, and greys out one that fails', async () => {
    draw({ ...RICH, media: [{ kind: 'photo', url: 'https://evil.example/x.jpg', alt: null }] });
    expect(container.querySelector('.xf-tc-media img')).toBeNull();
    expect(container.querySelector('.xf-tc-media .xf-tc-img-missing')).not.toBeNull();

    draw(RICH);
    container.querySelector('.xf-tc-media img')?.dispatchEvent(new Event('error'));
    await flush();
    expect(container.querySelectorAll('.xf-tc-media .xf-tc-img-missing')).toHaveLength(1);
  });

  it('opens the post on a click anywhere but its controls, in a new tab with ⌘/Ctrl', () => {
    const onOpen = draw(RICH);
    container.querySelector<HTMLElement>('.xf-tc-name')?.click();
    expect(onOpen).toHaveBeenLastCalledWith('https://x.com/alice/status/1', { newTab: false });
    container
      .querySelector('.xf-tc-name')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    expect(onOpen).toHaveBeenLastCalledWith('https://x.com/alice/status/1', { newTab: true });

    onOpen.mockClear();
    container.querySelector<HTMLAnchorElement>('.xf-tc-text a')?.click();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens the post from its time link instead of letting the link navigate', () => {
    const onOpen = draw(RICH);
    const time = container.querySelector<HTMLAnchorElement>('.xf-tc-time');
    expect(time?.getAttribute('href')).toBe('https://x.com/alice/status/1');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    time?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('offers "显示更多" on a truncated post', () => {
    draw({ ...RICH, truncated: true });
    expect(container.querySelector('.xf-tc-more')?.textContent).toBe('显示更多');
  });

  it('shows the quote, and the link card when there are no pictures', () => {
    draw({
      ...RICH,
      media: [],
      quote: {
        authorName: 'Q',
        username: 'q',
        verified: false,
        avatarUrl: null,
        postedAt: null,
        text: 'quoted words',
        media: null,
        url: null,
      },
      card: { url: 'https://t.co/card', layout: 'large', title: 'A title', domain: 'example.com', imageUrl: null },
    });
    expect(container.querySelector('.xf-tc-quote-text')?.textContent).toBe('quoted words');
    expect(container.querySelector('.xf-tc-quote .xf-tc-avatar-empty')?.textContent).toBe('Q');
    expect(container.querySelector<HTMLAnchorElement>('.xf-tc-card')?.href).toBe('https://t.co/card');
    expect(container.querySelector('.xf-tc-card-domain')?.textContent).toBe('example.com');
  });

  it('drops links that are not http(s) and never opens an unsafe permalink', () => {
    const onOpen = draw({
      ...RICH,
      canonicalUrl: 'https://evil.example/alice/status/1',
      segments: [{ kind: 'link', text: 'x', url: 'javascript:alert(1)' }],
      media: [],
      card: { url: 'javascript:alert(1)', layout: 'large', title: 't', domain: null, imageUrl: null },
    });
    expect(container.querySelector('.xf-tc-text a')).toBeNull();
    expect(container.querySelector('.xf-tc-card')).toBeNull();
    expect(container.querySelector('.xf-tc-time')).toBeNull();
    container.querySelector<HTMLElement>('.xf-tc-name')?.click();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('card formatting', () => {
  it('formats post times like X', () => {
    expect(formatPostedAt(NOW - 20_000, NOW)).toBe('20秒');
    expect(formatPostedAt(NOW - 5 * 60_000, NOW)).toBe('5分钟');
    expect(formatPostedAt(NOW - 3 * 3_600_000, NOW)).toBe('3小时');
    expect(formatPostedAt(new Date(2026, 8, 1).getTime(), NOW)).toBe('9月1日');
    expect(formatPostedAt(new Date(2025, 11, 31).getTime(), NOW)).toBe('2025年12月31日');
    expect(formatDay(new Date(2026, 0, 2).getTime(), NOW)).toBe('1月2日');
  });

  it('shortens link text as X does', () => {
    expect(displayLinkText('https://www.example.com/')).toBe('example.com/');
    expect(displayLinkText('example.com/short…')).toBe('example.com/short');
  });
});
```

- [ ] **Step 2：运行，确认失败**

Run: `pnpm vitest run tests/unit/tweet-card.test.tsx`
Expected: FAIL，`Failed to resolve import "@/ui/tweet-card/format"`

- [ ] **Step 3：通用图标组件与播放图标**

`src/ui/shared/Icon.tsx`：

```tsx
import { useEffect, useRef } from 'preact/hooks';
import { createIcon, type IconName } from './icons';

/** An icon built with DOM APIs (see icons.ts), for use inside components. */
export function Icon({ name, size }: { name: IconName; size: number }): preact.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(createIcon(name, size));
  }, [name, size]);
  return <span ref={ref} aria-hidden="true" style="display:inline-flex" />;
}
```

`src/ui/shared/icons.ts` 的 `ICON_PATHS` 里 `trash` 之后加：

```ts
  /** A play triangle for video posters. */
  play: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.9-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z',
```

- [ ] **Step 4：格式化**

`src/ui/tweet-card/format.ts`：

```ts
const SECOND_MS = 1000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const LINK_TEXT_MAX = 30;

/** "9月28日", or "2025年9月28日" outside the current year — local time, as X shows it. */
export function formatDay(at: number, now: number): string {
  const date = new Date(at);
  const day = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${date.getFullYear()}年${day}`;
}

/** X's own style: "20秒", "5分钟", "3小时" within a day, then the date. */
export function formatPostedAt(postedAt: number, now: number): string {
  const elapsed = now - postedAt;
  if (elapsed >= 0 && elapsed < MINUTE_MS) return `${Math.max(1, Math.floor(elapsed / SECOND_MS))}秒`;
  if (elapsed >= 0 && elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}分钟`;
  if (elapsed >= 0 && elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}小时`;
  return formatDay(postedAt, now);
}

/** Link text as X shows it: no scheme, no "www.", at most 30 characters. */
export function displayLinkText(text: string): string {
  const bare = text.replace(/^https?:\/\/(?:www\.)?/, '').replace(/…$/, '');
  return bare.length > LINK_TEXT_MAX ? `${bare.slice(0, LINK_TEXT_MAX)}…` : bare;
}
```

- [ ] **Step 5：图片、头像、认证标记**

`src/ui/tweet-card/SafeImage.tsx`：

```tsx
import { useState } from 'preact/hooks';
import { isAllowedImageUrl } from '@/utils/url';

export interface SafeImageProps {
  src: string;
  alt: string;
  class?: string;
}

/**
 * A picture from X's image server that becomes a grey placeholder when it
 * cannot be shown: a URL outside the allow-list (checked again here, whatever
 * the database holds), a deleted post, no network. Pictures are referenced,
 * never downloaded (work order 2.4).
 */
export function SafeImage(props: SafeImageProps): preact.JSX.Element {
  const [broken, setBroken] = useState(false);
  const className = props.class === undefined ? 'xf-tc-img' : `xf-tc-img ${props.class}`;
  if (broken || !isAllowedImageUrl(props.src)) {
    return <span class={`${className} xf-tc-img-missing`} role="img" aria-label={props.alt || '图片无法显示'} />;
  }
  return (
    <img
      class={className}
      src={props.src}
      alt={props.alt}
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}
```

`src/ui/tweet-card/Avatar.tsx`：

```tsx
import { avatarUrlForDisplay } from '@/utils/url';
import { SafeImage } from './SafeImage';

/** The round author picture; the name's first letter until a picture is known. */
export function Avatar(props: { url: string | null; name: string; size: 'normal' | 'small' }): preact.JSX.Element {
  const className = props.size === 'small' ? 'xf-tc-avatar xf-tc-avatar-small' : 'xf-tc-avatar';
  if (props.url === null) {
    return (
      <span class={`${className} xf-tc-avatar-empty`} aria-hidden="true">
        {Array.from(props.name.trim())[0] ?? ''}
      </span>
    );
  }
  return <SafeImage class={className} src={avatarUrlForDisplay(props.url)} alt="" />;
}
```

`src/ui/tweet-card/VerifiedBadge.tsx`：

```tsx
import { Icon } from '@/ui/shared/Icon';

/** A round check mark in the accent colour — our own drawing, not X's badge artwork. */
export function VerifiedBadge(): preact.JSX.Element {
  return (
    <span class="xf-tc-verified" role="img" aria-label="已认证">
      <Icon name="check" size={12} />
    </span>
  );
}
```

- [ ] **Step 6：正文、媒体、引用、链接卡片**

`src/ui/tweet-card/TweetText.tsx`：

```tsx
import type { TextSegment } from '@/core/domain/tweet';
import { isAllowedLinkUrl } from '@/utils/url';
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
  truncated: boolean;
  /** Where "显示更多" leads: the post itself; null when it has no safe link. */
  moreHref: string | null;
  onMore: (event: MouseEvent) => void;
}

/** Post text with links, mentions and hashtags live; newlines are kept by CSS. */
export function TweetText(props: TweetTextProps): preact.JSX.Element | null {
  if (props.segments.length === 0 && !props.truncated) return null;
  return (
    <div class="xf-tc-text" dir="auto">
      {props.segments.map(renderSegment)}
      {props.truncated && props.moreHref !== null && (
        <>
          {' '}
          <a class="xf-tc-more" href={props.moreHref} onClick={props.onMore}>
            显示更多
          </a>
        </>
      )}
    </div>
  );
}
```

`src/ui/tweet-card/MediaGrid.tsx`：

```tsx
import type { MediaItem } from '@/core/domain/tweet';
import { Icon } from '@/ui/shared/Icon';
import { imageUrlForSize } from '@/utils/url';
import { SafeImage } from './SafeImage';

/**
 * One to four pictures laid out as X does: one fills the frame, two side by
 * side, three as one tall and two stacked, four in a 2×2 grid. A video or GIF
 * shows its poster with a play mark or a "GIF" badge; nothing plays here.
 */
export function MediaGrid(props: { media: readonly MediaItem[] }): preact.JSX.Element | null {
  const items = props.media.slice(0, 4);
  if (items.length === 0) return null;
  const size = items.length === 1 ? 'medium' : 'small';
  return (
    <div class="xf-tc-media" data-count={items.length}>
      {items.map((item, index) => (
        <div key={index} class="xf-tc-media-cell">
          <SafeImage src={imageUrlForSize(item.url, size)} alt={item.alt ?? ''} />
          {item.kind === 'video' && (
            <span class="xf-tc-play">
              <Icon name="play" size={24} />
            </span>
          )}
          {item.kind === 'gif' && <span class="xf-tc-gif">GIF</span>}
        </div>
      ))}
    </div>
  );
}
```

`src/ui/tweet-card/QuoteBlock.tsx`：

```tsx
import type { QuotedPost } from '@/core/domain/tweet';
import { imageUrlForSize, isSafeXUrl } from '@/utils/url';
import { Avatar } from './Avatar';
import { formatPostedAt } from './format';
import { SafeImage } from './SafeImage';
import { VerifiedBadge } from './VerifiedBadge';

export interface QuoteBlockProps {
  quote: QuotedPost;
  now: number;
  onOpen: (url: string, options: { newTab: boolean }) => void;
}

/**
 * The quoted post framed like X's. A click opens the quoted post when its link
 * is known; otherwise it falls through to the card, which opens the outer post.
 */
export function QuoteBlock(props: QuoteBlockProps): preact.JSX.Element {
  const { quote } = props;
  const href = quote.url !== null && isSafeXUrl(quote.url) ? quote.url : null;
  const name = quote.authorName ?? quote.username ?? '';
  return (
    <div
      class="xf-tc-quote"
      onClick={(event) => {
        if (href === null) return;
        event.stopPropagation();
        props.onOpen(href, { newTab: event.metaKey || event.ctrlKey });
      }}
    >
      <div class="xf-tc-quote-head">
        <Avatar url={quote.avatarUrl} name={name} size="small" />
        <span class="xf-tc-name">{name}</span>
        {quote.verified && <VerifiedBadge />}
        {quote.username !== null && <span class="xf-tc-handle">{`@${quote.username}`}</span>}
        {quote.postedAt !== null && (
          <span class="xf-tc-handle">{`· ${formatPostedAt(quote.postedAt, props.now)}`}</span>
        )}
      </div>
      <div class="xf-tc-quote-body">
        {quote.media !== null && (
          <SafeImage
            class="xf-tc-quote-thumb"
            src={imageUrlForSize(quote.media.url, 'small')}
            alt={quote.media.alt ?? ''}
          />
        )}
        {quote.text.length > 0 && (
          <div class="xf-tc-quote-text" dir="auto">
            {quote.text}
          </div>
        )}
      </div>
    </div>
  );
}
```

`src/ui/tweet-card/LinkCardView.tsx`：

```tsx
import type { LinkCard } from '@/core/domain/tweet';
import { isAllowedLinkUrl } from '@/utils/url';
import { SafeImage } from './SafeImage';

/** The link preview: picture, domain and title, opening the link in a new tab. */
export function LinkCardView(props: { card: LinkCard }): preact.JSX.Element | null {
  const { card } = props;
  if (!isAllowedLinkUrl(card.url)) return null;
  return (
    <a class="xf-tc-card" data-layout={card.layout} href={card.url} target="_blank" rel="noopener noreferrer">
      {card.imageUrl !== null && <SafeImage class="xf-tc-card-img" src={card.imageUrl} alt="" />}
      <span class="xf-tc-card-text">
        {card.domain !== null && <span class="xf-tc-card-domain">{card.domain}</span>}
        {card.title !== null && <span class="xf-tc-card-title">{card.title}</span>}
      </span>
    </a>
  );
}
```

- [ ] **Step 7：卡片本体**

`src/ui/tweet-card/TweetCard.tsx`：

```tsx
import type { TweetRecord } from '@/core/domain/tweet';
import { isSafeXUrl } from '@/utils/url';
import { Avatar } from './Avatar';
import { formatPostedAt } from './format';
import { LinkCardView } from './LinkCardView';
import { MediaGrid } from './MediaGrid';
import { QuoteBlock } from './QuoteBlock';
import { TweetText } from './TweetText';
import { VerifiedBadge } from './VerifiedBadge';

export interface OpenOptions {
  /** ⌘/Ctrl-click: a new tab. */
  newTab: boolean;
}

export interface TweetCardProps {
  tweet: TweetRecord;
  /** Render-time clock, passed in so every card in one paint agrees. */
  now: number;
  /** Opens a post; the page overlay and the side panel each decide how. */
  onOpen: (url: string, options: OpenOptions) => void;
  /** Top-right corner — the folder view puts its ⋯ menu here. */
  actions?: preact.ComponentChildren;
  /** Under the body — the folder view puts "保存于 …" here. */
  footer?: preact.ComponentChildren;
}

/** Controls that handle their own clicks; clicking one never opens the card. */
const INTERACTIVE = 'a, button, [role="menu"], [role="menuitem"]';

/**
 * A saved post drawn as close to X's own card as a snapshot allows (work order
 * 2.4): avatar, name, check mark, @handle and time; text with live links; up to
 * four pictures; the quoted post; the link preview. No counts — they would be
 * stale. A click anywhere that is not a control opens the post, as on X; the
 * time is the post's real link, for keyboards and screen readers.
 */
export function TweetCard(props: TweetCardProps): preact.JSX.Element {
  const { tweet } = props;
  // A stored URL that fails the same-origin guard is never opened.
  const href = isSafeXUrl(tweet.canonicalUrl) ? tweet.canonicalUrl : null;
  const name = tweet.authorName ?? tweet.username;

  const open = (event: MouseEvent): void => {
    if (href === null) return;
    props.onOpen(href, { newTab: event.metaKey || event.ctrlKey });
  };
  const openFromLink = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    open(event);
  };

  return (
    <article
      class="xf-tc"
      onClick={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest(INTERACTIVE) !== null) return;
        // Selecting text to copy it is not a click on the card.
        if ((window.getSelection()?.toString() ?? '').length > 0) return;
        open(event);
      }}
    >
      <Avatar url={tweet.avatarUrl} name={name} size="normal" />
      <div class="xf-tc-main">
        <div class="xf-tc-head">
          <span class="xf-tc-name">{name}</span>
          {tweet.verified && <VerifiedBadge />}
          <span class="xf-tc-handle">{`@${tweet.username}`}</span>
          {href !== null && (
            <>
              <span class="xf-tc-handle" aria-hidden="true">
                ·
              </span>
              <a class="xf-tc-time" href={href} onClick={openFromLink}>
                {tweet.postedAt === null ? '打开原帖' : formatPostedAt(tweet.postedAt, props.now)}
              </a>
            </>
          )}
          {props.actions !== undefined && <span class="xf-tc-actions">{props.actions}</span>}
        </div>
        <TweetText segments={tweet.segments} truncated={tweet.truncated} moreHref={href} onMore={openFromLink} />
        <MediaGrid media={tweet.media} />
        {tweet.quote !== null && <QuoteBlock quote={tweet.quote} now={props.now} onOpen={props.onOpen} />}
        {tweet.card !== null && tweet.media.length === 0 && <LinkCardView card={tweet.card} />}
        {props.footer}
      </div>
    </article>
  );
}
```

- [ ] **Step 8：样式**

`src/ui/tweet-card/tweetCard.css.ts`：

```ts
/**
 * Rich post card, shared by the page overlay and the side panel. Every colour
 * is a `--xf-*` token, so the card follows X's theme wherever it is mounted.
 */
export const TWEET_CARD_CSS = `
.xf-tc { display: flex; gap: 12px; padding: 12px 16px; cursor: pointer; color: var(--xf-text); }
.xf-tc-main { flex: 1 1 auto; min-width: 0; }

.xf-tc-avatar {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  border-radius: 9999px;
  object-fit: cover;
  background: var(--xf-hover);
}
.xf-tc-avatar-small { width: 20px; height: 20px; }
.xf-tc-avatar-empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: var(--xf-text-muted);
  background: var(--xf-border);
}
.xf-tc-avatar-small.xf-tc-avatar-empty { font-size: 11px; }

.xf-tc-head { display: flex; align-items: center; gap: 4px; min-width: 0; font-size: 15px; line-height: 20px; }
.xf-tc-name { min-width: 0; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.xf-tc-handle { min-width: 0; color: var(--xf-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.xf-tc-time { flex: 0 0 auto; color: var(--xf-text-muted); text-decoration: none; white-space: nowrap; }
.xf-tc-time:hover { text-decoration: underline; }
.xf-tc-actions { flex: 0 0 auto; display: inline-flex; margin: -4px 0 -4px auto; }

.xf-tc-verified {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 9999px;
  background: var(--xf-accent);
  color: #fff;
}

.xf-tc-text { margin-top: 2px; font-size: 15px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; }
.xf-tc-link, .xf-tc-more { color: var(--xf-accent); text-decoration: none; }
.xf-tc-link:hover, .xf-tc-more:hover { text-decoration: underline; }

.xf-tc-media {
  display: grid;
  gap: 2px;
  margin-top: 12px;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--xf-border);
  border-radius: 16px;
  overflow: hidden;
}
.xf-tc-media[data-count="1"] { grid-template: 1fr / 1fr; }
.xf-tc-media[data-count="2"] { grid-template: 1fr / 1fr 1fr; }
.xf-tc-media[data-count="3"], .xf-tc-media[data-count="4"] { grid-template: 1fr 1fr / 1fr 1fr; }
.xf-tc-media[data-count="3"] > :first-child { grid-row: span 2; }
.xf-tc-media-cell { position: relative; min-width: 0; min-height: 0; }
.xf-tc-media-cell .xf-tc-img { display: block; width: 100%; height: 100%; object-fit: cover; }
.xf-tc-play {
  position: absolute;
  top: 50%;
  left: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin: -24px 0 0 -24px;
  border: 3px solid #fff;
  border-radius: 9999px;
  background: var(--xf-accent);
  color: #fff;
}
.xf-tc-gif {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.77);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  line-height: 16px;
}
.xf-tc-img-missing { display: block; background: var(--xf-border); }

.xf-tc-quote { margin-top: 12px; padding: 12px; border: 1px solid var(--xf-border); border-radius: 16px; }
.xf-tc-quote-head { display: flex; align-items: center; gap: 4px; min-width: 0; font-size: 15px; line-height: 20px; }
.xf-tc-quote-body { display: flex; gap: 12px; margin-top: 4px; }
.xf-tc-quote-thumb { flex: 0 0 auto; width: 64px; height: 64px; border-radius: 8px; object-fit: cover; }
.xf-tc-quote-text {
  min-width: 0;
  font-size: 15px;
  line-height: 20px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.xf-tc-card {
  display: block;
  margin-top: 12px;
  border: 1px solid var(--xf-border);
  border-radius: 16px;
  overflow: hidden;
  color: inherit;
  text-decoration: none;
}
.xf-tc-card-img { display: block; width: 100%; aspect-ratio: 1.91 / 1; object-fit: cover; }
.xf-tc-card-text { display: flex; flex-direction: column; gap: 2px; padding: 12px; font-size: 15px; line-height: 20px; }
.xf-tc-card-domain { color: var(--xf-text-muted); }
.xf-tc-card-title {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.xf-tc-card[data-layout="small"] { display: flex; }
.xf-tc-card[data-layout="small"] .xf-tc-card-img { flex: 0 0 auto; width: 130px; aspect-ratio: 1 / 1; }
.xf-tc-card[data-layout="small"] .xf-tc-card-text { justify-content: center; min-width: 0; }

.xf-tc-saved { margin-top: 12px; font-size: 13px; color: var(--xf-text-muted); }
`;
```

- [ ] **Step 9：运行，确认通过**

Run: `pnpm vitest run tests/unit/tweet-card.test.tsx`
Expected: PASS

- [ ] **Step 10：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add src/ui/shared/Icon.tsx src/ui/shared/icons.ts src/ui/tweet-card tests/unit/tweet-card.test.tsx
git commit -m "新增还原 X 的富帖子卡片组件"
git push origin main
```

---

### Task 12：收藏列表改用富卡片，加 ⋯ 菜单

卡片不再是一个大链接（里面有正文链接、卡片链接，嵌套 `<a>` 不合法），打开方式改由外部传入：页面内覆盖层在当前标签页跳转（⌘/Ctrl 新标签），侧边栏交给 `openPost`（让旁边的 X 标签页跳转）。原来行尾的删除按钮换成工单要求的「⋯」菜单：在新标签页打开、从此文件夹移除。卡片底部显示「保存于 某日」。

**Files:**
- Modify: `src/ui/folder-view/SavedTweetCard.tsx`（整个替换）
- Modify: `src/ui/folder-view/FolderViewApp.tsx`
- Modify: `src/ui/folder-view/folderView.css.ts`
- Modify: `src/hosts/x/FolderViewMount.tsx`
- Modify: `src/sidepanel/SidePanelApp.tsx`、`src/sidepanel/styles.ts`
- Modify: `tests/unit/folder-view.test.tsx`（三个用例）

- [ ] **Step 1：把列表测试改成新行为（先失败）**

`tests/unit/folder-view.test.tsx`：

1. 用例 `removes a row and updates the count without refetching the list` 中，把

```ts
    const button = rows()[1]?.querySelector<HTMLButtonElement>('.xf-fv-remove');
    expect(button).not.toBeNull();
    button?.click();
    await settle();
```

替换为：

```ts
    const more = rows()[1]?.querySelector<HTMLButtonElement>('button[aria-label="更多操作"]');
    expect(more).not.toBeNull();
    more?.click();
    await settle();
    const removeItem = Array.from(shadow().querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
      (item) => item.textContent === '从此文件夹移除',
    );
    expect(removeItem).toBeDefined();
    removeItem?.click();
    await settle();
```

2. 用例 `renders a same-origin link per row and drops an unsafe one` 整个替换为：

```ts
  it('links each row to its post and never links an unsafe one', async () => {
    records = [savedView(0), savedView(1, { url: 'https://evil.example.com/user1/status/1' })];
    folders = [folderFixture(records.length)];
    await store.refresh();
    await open();

    const safe = rows()[0];
    const unsafe = rows()[1];
    expect(safe?.querySelector('a.xf-tc-time')?.getAttribute('href')).toBe(records[0]?.tweet.canonicalUrl);
    expect(unsafe?.querySelector('a.xf-tc-time')).toBeNull();
    // The row still shows what was saved; it just is not a link.
    expect(unsafe?.textContent).toContain('第 1 条收藏');
  });
```

3. 用例 `shows the author, handle and a relative saved time` 整个替换为：

```ts
  it('shows the author, handle and the day it was saved', async () => {
    records = [savedView(0, { savedAt: new Date(2026, 8, 26, 10).getTime() })];
    folders = [folderFixture(1)];
    await store.refresh();
    await open();

    expect(textOf('.xf-tc-name')).toBe('作者0');
    expect(textOf('.xf-tc-handle')).toBe('@user0');
    expect(textOf('.xf-tc-saved')).toMatch(/^保存于 (2026年)?9月26日$/);
  });
```

- [ ] **Step 2：运行，确认失败**

Run: `pnpm vitest run tests/unit/folder-view.test.tsx`
Expected: 3 个 FAIL（找不到「更多操作」按钮、`.xf-tc-time`、`.xf-tc-name`）

- [ ] **Step 3：列表行**

`src/ui/folder-view/SavedTweetCard.tsx` 整个替换为：

```tsx
import type { SavedTweetView } from '@/core/domain/membership';
import type { TweetId } from '@/core/domain/tweet';
import { XF_ATTR } from '@/hosts/x/selectors';
import { Icon } from '@/ui/shared/Icon';
import { formatDay } from '@/ui/tweet-card/format';
import { TweetCard, type OpenOptions } from '@/ui/tweet-card/TweetCard';

/** Keeps the ⋯ menu inside the viewport's left edge. */
const MENU_WIDTH_PX = 180;

export interface SavedTweetCardProps {
  item: SavedTweetView;
  /** Render-time clock, passed in so every row in one paint agrees. */
  now: number;
  removing: boolean;
  onOpen: (url: string, options: OpenOptions) => void;
  /** Opens this post's ⋯ menu at a viewport point. */
  onMenu: (tweetId: TweetId, x: number, y: number) => void;
}

/** One saved post in a folder: the rich card, its ⋯ menu and the day it was saved. */
export function SavedTweetCard(props: SavedTweetCardProps): preact.JSX.Element {
  const { tweet, savedAt } = props.item;
  return (
    <div
      class="xf-fv-row"
      data-removing={props.removing ? 'true' : 'false'}
      {...{ [XF_ATTR.tweetId]: tweet.tweetId }}
    >
      <TweetCard
        tweet={tweet}
        now={props.now}
        onOpen={props.onOpen}
        actions={
          <button
            type="button"
            class="xf-icon-button"
            aria-label="更多操作"
            aria-haspopup="menu"
            title="更多操作"
            disabled={props.removing}
            onClick={(event) => {
              const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
              props.onMenu(tweet.tweetId, Math.max(8, rect.right - MENU_WIDTH_PX), rect.bottom + 4);
            }}
          >
            <Icon name="more" size={18} />
          </button>
        }
        footer={<div class="xf-tc-saved">{`保存于 ${formatDay(savedAt, props.now)}`}</div>}
      />
    </div>
  );
}
```

- [ ] **Step 4：列表组件**

`src/ui/folder-view/FolderViewApp.tsx`：

1. 导入加：

```ts
import { FolderContextMenu } from '@/ui/sidebar/FolderContextMenu';
import type { OpenOptions } from '@/ui/tweet-card/TweetCard';
```

2. `FolderViewAppProps` 里加：

```ts
  /** Opens a post from a card: the page navigates itself, the side panel asks the X tab. */
  onOpenPost: (url: string, options: OpenOptions) => void;
```

3. 在 `const [count, setCount] = …` 下面加：

```ts
  const [menu, setMenu] = useState<{ tweetId: TweetId; x: number; y: number } | null>(null);
```

4. 切换文件夹的那个 `useEffect` 里，`setRemoving(null);` 下面加 `setMenu(null);`
5. `items.map(...)` 里的 `<SavedTweetCard … />` 改为：

```tsx
          <SavedTweetCard
            key={item.tweet.tweetId}
            item={item}
            now={now}
            removing={removing === item.tweet.tweetId}
            onOpen={props.onOpenPost}
            onMenu={(tweetId, x, y) => setMenu({ tweetId, x, y })}
          />
```

6. 在 `return (` 之前加：

```tsx
  const menuTarget = menu === null ? undefined : items.find((item) => item.tweet.tweetId === menu.tweetId);
```

7. 在 `<ToastHost />` 之前加：

```tsx
      {menu !== null && menuTarget !== undefined && (
        <FolderContextMenu
          items={[
            { id: 'open', label: '在新标签页打开', icon: 'external' },
            { id: 'remove', label: '从此文件夹移除', icon: 'trash', danger: true, disabled: removing !== null },
          ]}
          x={menu.x}
          y={menu.y}
          onSelect={(action) => {
            setMenu(null);
            if (action === 'open') props.onOpenPost(menuTarget.tweet.canonicalUrl, { newTab: true });
            if (action === 'remove') void remove(menuTarget.tweet.tweetId);
          }}
          onClose={() => setMenu(null)}
        />
      )}
```

- [ ] **Step 5：列表样式**

`src/ui/folder-view/folderView.css.ts` 中删除从 `.xf-fv-row {` 到 `.xf-fv-remove[disabled] { … }` 的整段旧卡片样式，换成：

```css
.xf-fv-row { border-bottom: 1px solid var(--xf-border); }
.xf-fv-row:hover { background: var(--xf-hover); }
.xf-fv-row[data-removing="true"] { opacity: .5; }

/* The ⋯ menu (FolderContextMenu) floats over the list. */
.xf-menu-layer { position: fixed; inset: 0; z-index: 6; }
.xf-menu-anchored { position: absolute; }
```

- [ ] **Step 6：页面内覆盖层**

`src/hosts/x/FolderViewMount.tsx`：
1. 导入加：

```ts
import { TWEET_CARD_CSS } from '@/ui/tweet-card/tweetCard.css';
import type { OpenOptions } from '@/ui/tweet-card/TweetCard';
import { isSafeXUrl } from '@/utils/url';
```

2. `#createHost()` 里 `css: \`${BASE_CSS}${FEEDBACK_CSS}${FOLDER_VIEW_CSS}\`,` 改为 `css: \`${BASE_CSS}${FEEDBACK_CSS}${FOLDER_VIEW_CSS}${TWEET_CARD_CSS}\`,`
3. `#render()` 里的 `<FolderViewApp … />` 加一个属性 `onOpenPost={openPostHere}`
4. 文件末尾加：

```ts
/**
 * The page overlay opens a post in this tab, like following one of X's own
 * links, or in a new tab on ⌘/Ctrl-click. Only x.com permalinks are followed.
 */
function openPostHere(url: string, options: OpenOptions): void {
  if (!isSafeXUrl(url)) return;
  if (options.newTab) window.open(url, '_blank', 'noopener,noreferrer');
  else location.assign(url);
}
```

- [ ] **Step 7：侧边栏**

`src/sidepanel/SidePanelApp.tsx`：
1. 根元素 `<div class="xf-root xf-sp" onClick={routePostLinks}>` 改为 `<div class="xf-root xf-sp">`
2. 删除文件末尾的 `routePostLinks` 函数
3. `<FolderViewApp … />` 加一个属性：

```tsx
            onOpenPost={(url, options) => void openPost(url, options)}
```

4. 组件上方的注释改为：

```ts
/**
 * The side panel: the same folder tree and folder list the page uses, stacked.
 * Opening a post is routed to the X tab beside the panel (see openPost).
 */
```

`src/sidepanel/styles.ts`：导入加 `import { TWEET_CARD_CSS } from '@/ui/tweet-card/tweetCard.css';`，`style.textContent` 的拼接末尾加上 `${TWEET_CARD_CSS}`。

- [ ] **Step 8：运行，确认通过**

Run: `pnpm vitest run tests/unit/folder-view.test.tsx tests/unit/side-panel-app.test.tsx tests/unit/open-in-side-panel.test.tsx tests/unit/tweet-card.test.tsx`
Expected: PASS（侧边栏用例点的仍是 `a[href=帖子链接]`，现在是卡片的时间链接，同样交给 `openPost`）。`onOpenPost` 是必填属性：如果 `pnpm typecheck` 报某个测试直接渲染 `<FolderViewApp>` 却没传它，给那个测试补上 `onOpenPost={() => {}}`。

- [ ] **Step 9：全量检查、构建并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add src/ui/folder-view src/hosts/x/FolderViewMount.tsx src/sidepanel tests/unit/folder-view.test.tsx
git commit -m "收藏列表改用富卡片：⋯ 菜单、保存日期，打开方式按页面内或侧边栏区分"
git push origin main
```

---

### Task 13：页面样本采集工具与脱敏检查

工单 3.3 第 2 条：样本要从真实 x.com 抓取，脱敏「默认替换、只放行结构性内容」，提交前复查。做法：采集脚本在**页面里**就地脱敏，原始内容不离开浏览器，也不再产生 `raw/captured.json` 这类未脱敏文件；另写一个「默认拒绝」的检查器，任何不是合成形状的属性、链接、图片、文字、长数字都算泄露，作为单元测试守住每个提交的样本。

**Files:**
- Create: `tools/capture-fixture.js`
- Modify: `eslint.config.js`（给 `tools/` 配浏览器全局）
- Create: `tests/helpers/sanitizedCheck.ts`
- Create: `tests/unit/capture-fixture.test.ts`、`tests/unit/fixtures-sanitized.test.ts`

- [ ] **Step 1：写检查器**

`tests/helpers/sanitizedCheck.ts`：

```ts
/**
 * Default-deny review of a captured page (work order 3.3 rule 2): every
 * attribute, link, picture and text run must have one of the synthetic shapes
 * tools/capture-fixture.js produces. Returns what does not; an empty list
 * means the page may be committed.
 */

const SYNTHETIC_ID = '10{8,}\\d{1,9}';
const PATH_WORD =
  '(?:with_replies|media|likes|highlights|articles|followers|following|verified_followers|lists|' +
  `communities|header_photo|photo|video|status|analytics|quotes|retweets|history|x|1|${SYNTHETIC_ID})`;
const KEPT_FIRST =
  '(?:home|explore|notifications|messages|settings|compose|i|jobs|communities|premium_sign_up|' +
  'verified-choose|lists|bookmarks|tos|privacy|logout|account|grok)';

const HREF_SHAPES: readonly RegExp[] = [
  /^\/$/,
  new RegExp(`^/user\\d+(?:/${PATH_WORD})*$`),
  /^\/hashtag\/tag\d+$/,
  /^\/search\?q=fixture$/,
  new RegExp(`^/${KEPT_FIRST}(?:/(?:[a-z_-]{1,30}|1))*$`),
  /^https:\/\/t\.co\/fixture\d+$/,
  /^https:\/\/example\.com\/fixture\d+$/,
];

const IMAGE_SHAPES: readonly RegExp[] = [
  /^https:\/\/pbs\.twimg\.com\/[a-z_]{1,30}(?:\/(?:1|x|img|pu))*\/fixture-[a-z]+-\d+(?:_(?:normal|bigger|mini|x96|200x200|400x400|reasonably_small))?(?:\.(?:jpe?g|png|webp|gif))?(?:\?(?:format=[a-z0-9]{1,12}&name=[a-z0-9]{1,12}|format=[a-z0-9]{1,12}|name=[a-z0-9]{1,12}))?$/i,
  /^https:\/\/abs-0\.twimg\.com\/emoji\/v2\/svg\/1f642\.svg$/,
  /^https:\/\/abs\.twimg\.com\/sticky\/default_profile_images\/default_profile_normal\.png$/,
];

const SYNTHETIC_TEXT: readonly RegExp[] = [
  /^[\s示例文字]*$/u,
  /^\s*@user\d+\s*$/,
  /^\s*[#$]tag\d+\s*$/,
  /^\s*(?:[示例文字]+\s+)?example\.com\s*$/u,
];

const PLAIN_ATTRS: ReadonlySet<string> = new Set([
  'data-testid',
  'role',
  'tabindex',
  'aria-hidden',
  'dir',
  'type',
  'target',
  'rel',
  'draggable',
  'aria-haspopup',
  'aria-expanded',
  'aria-selected',
  'aria-checked',
  'aria-disabled',
  'aria-live',
  'aria-orientation',
  'aria-multiselectable',
  'viewBox',
]);

function styleOk(element: Element, value: string): boolean {
  if (element.tagName === 'BODY') return /^background-color: rgb\(\d{1,3}, \d{1,3}, \d{1,3}\);$/.test(value);
  const url = /^background-image: url\("([^"]+)"\);$/.exec(value)?.[1];
  return url !== undefined && IMAGE_SHAPES.some((shape) => shape.test(url));
}

function attributeOk(element: Element, name: string, value: string): boolean {
  switch (name) {
    case 'href':
      return HREF_SHAPES.some((shape) => shape.test(value));
    case 'src':
    case 'poster':
      return IMAGE_SHAPES.some((shape) => shape.test(value));
    case 'style':
      return styleOk(element, value);
    case 'datetime':
      return /^20\d\d-\d\d-\d\dT\d\d:00:00\.000Z$/.test(value);
    case 'alt':
      return value === '' || value === 'ALT' || value === '🙂';
    case 'aria-label':
      return value === 'LABEL';
    case 'd':
      return value === 'M0 0h24v24H0z';
    case 'id':
      return element.tagName === 'DIV' && value === 'react-root';
    case 'data-testid':
      return value.startsWith('UserAvatar-Container-')
        ? /^UserAvatar-Container-user\d+$/.test(value)
        : /^[\w.:-]{1,80}$/.test(value);
    default:
      return PLAIN_ATTRS.has(name) && /^[\w .:-]{0,40}$/.test(value);
  }
}

export function findLeaks(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const problems: string[] = [];
  for (const element of [doc.body, ...Array.from(doc.body.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (!attributeOk(element, attribute.name, attribute.value)) {
        problems.push(`<${element.tagName.toLowerCase()} ${attribute.name}="${attribute.value.slice(0, 80)}">`);
      }
    }
  }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    if (!SYNTHETIC_TEXT.some((shape) => shape.test(text))) problems.push(`text ${JSON.stringify(text.slice(0, 80))}`);
  }
  const syntheticId = new RegExp(`^${SYNTHETIC_ID}$`);
  for (const [digits] of html.matchAll(/\d{7,}/g)) {
    if (!syntheticId.test(digits)) problems.push(`number ${digits}`);
  }
  return problems;
}
```

- [ ] **Step 2：写失败测试**

`tests/unit/capture-fixture.test.ts`：

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cardHtml, postHtml, quoteHtml } from '../helpers/postDom';
import { findLeaks } from '../helpers/sanitizedCheck';

interface Capture {
  reset(): void;
  grab(): { added: number; total: number };
  html(): string;
}

let capture: Capture;

beforeAll(() => {
  // The script is written for an x.com page; run it in jsdom's window the same way.
  const source = readFileSync(resolve(process.cwd(), 'tools/capture-fixture.js'), 'utf8');
  new Function(source)();
  capture = (window as unknown as { __xfCapture: Capture }).__xfCapture;
});

const REAL_POST = postHtml({
  id: '1839990000000000123',
  user: 'RealPerson',
  name: 'Real Person Name',
  verified: true,
  avatar: 'https://pbs.twimg.com/profile_images/1771234567/Ab_c9Xyz_normal.jpg',
  textHtml:
    '<span>secret words </span><div><span><a href="/SomeFriend">@SomeFriend</a></span></div>' +
    '<a href="https://t.co/Zq9Real">https://private.example.org/path</a>' +
    '<span><a href="/hashtag/Private?src=hashtag_click">#Private</a></span>' +
    '<img alt="😀" src="https://abs-0.twimg.com/emoji/v2/svg/1f600.svg">',
  photos: ['https://pbs.twimg.com/media/GZsecretKey?format=jpg&name=900x900'],
  cardHtml: cardHtml({ href: 'https://t.co/CardReal', domainLine: '来自 private.example.org', title: 'Private headline' }),
  quoteHtml: quoteHtml({ user: 'QuotedReal', name: 'Quoted Real', text: 'quoted secret' }),
});

function capturedPage(): Document {
  return new DOMParser().parseFromString(capture.html(), 'text/html');
}

beforeEach(() => {
  document.body.innerHTML =
    '<header role="banner"><nav><a href="/home" aria-label="Home">首页</a><a href="/RealPerson">Profile</a></nav></header>' +
    '<main><div data-testid="primaryColumn"><section><div>' +
    `<div data-testid="cellInnerDiv" style="transform: translateY(0px);">${REAL_POST}</div>` +
    '</div></section></div></main>';
  capture.reset();
  capture.grab();
});

describe('tools/capture-fixture.js', () => {
  it('keeps the structure our selectors need', () => {
    const doc = capturedPage();
    for (const testid of [
      'primaryColumn',
      'cellInnerDiv',
      'tweet',
      'User-Name',
      'Tweet-User-Avatar',
      'tweetText',
      'tweetPhoto',
      'card.wrapper',
      'icon-verified',
    ]) {
      expect(doc.querySelector(`[data-testid="${testid}"]`), testid).not.toBeNull();
    }
    expect(doc.querySelector('#react-root header[role="banner"] nav')).not.toBeNull();
    expect(doc.querySelector('div[role="link"][tabindex="0"]')).not.toBeNull();
  });

  it('leaks no real name, id, text, link or picture name', () => {
    const out = capture.html();
    for (const secret of [
      'RealPerson',
      'Real Person Name',
      '1839990000000000123',
      'SomeFriend',
      'secret',
      'Zq9Real',
      'private.example.org',
      'Private',
      'GZsecretKey',
      '1771234567',
      'Ab_c9Xyz',
      'CardReal',
      'QuotedReal',
      '首页',
      'Profile',
      'translateY',
    ]) {
      expect(out, secret).not.toContain(secret);
    }
    expect(findLeaks(out)).toEqual([]);
  });

  it('maps a handle and its links to the same synthetic user, and a post to one synthetic id', () => {
    const doc = capturedPage();
    const mention = doc.querySelector('[data-testid="tweetText"] a[href^="/user"]');
    expect(mention?.textContent).toBe(`@${mention?.getAttribute('href')?.slice(1) ?? ''}`);
    const permalink = doc.querySelector('[data-testid="User-Name"] a[href*="/status/"]')?.getAttribute('href') ?? '';
    expect(permalink).toMatch(/^\/user\d+\/status\/10{8,}\d+$/);
    const photoLink = doc.querySelector('[data-testid="tweetPhoto"] a')?.getAttribute('href') ?? '';
    expect(photoLink.startsWith(`${permalink}/photo/`)).toBe(true);
  });
});
```

`tests/unit/fixtures-sanitized.test.ts`：

```ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findLeaks } from '../helpers/sanitizedCheck';

/** Samples taken with tools/capture-fixture.js (M2 onwards); the v0.1 samples predate it. */
const SANITIZED_FIXTURES = ['x-home-rich.html', 'x-status-long.html', 'x-bookmarks.html'];

describe('committed page samples leak nothing (work order 3.3 rule 2)', () => {
  for (const name of SANITIZED_FIXTURES) {
    const path = resolve(process.cwd(), 'tests/fixtures', name);
    // Task 14 captures these and turns the skip into a plain `it`.
    it.skipIf(!existsSync(path))(name, () => {
      expect(findLeaks(readFileSync(path, 'utf8'))).toEqual([]);
    });
  }
});
```

- [ ] **Step 3：运行，确认失败**

Run: `pnpm vitest run tests/unit/capture-fixture.test.ts tests/unit/fixtures-sanitized.test.ts`
Expected: `capture-fixture` FAIL（`ENOENT … tools/capture-fixture.js`）；`fixtures-sanitized` 3 个 SKIP

- [ ] **Step 4：采集脚本**

`tools/capture-fixture.js`：

```js
/**
 * X Folders — page sample capture (work order 3.3 rule 2).
 *
 * Runs inside a logged-in x.com tab (the M2 plan does it through Claude in
 * Chrome's javascript tool). Read-only: it scrolls and clones, never clicks.
 * Everything is sanitised inside the page — default-deny — so no real
 * username, post id, text or picture name ever leaves the browser:
 *   - text becomes synthetic ("示例文字…") of the same length; handles,
 *     hashtags and domains become their mapped synthetic forms;
 *   - attributes are allow-listed; class, id, lang, style (but a rewritten
 *     background picture) and data-* (but data-testid) are dropped;
 *   - links, pictures, test ids and times become synthetic values, consistent
 *     within one run, so a post keeps its id across the pages captured;
 *   - script, style, iframe and similar elements are removed.
 *
 * window.__xfCapture:
 *   sanitize(node)          a sanitised deep clone
 *   grab()                  add the timeline rows now mounted
 *   collect({ scrolls })    scroll and grab; resolves with coverage()
 *   coverage()              what the collected rows contain
 *   reset()                 drop the collected rows, keep the id maps
 *   go(path)                in-app navigation that keeps this object alive
 *   openLongPost()          go to the first collected "Show more" post; returns its synthetic id
 *   html()                  the fixture document
 *   download(name)          save html() as a file (ask the user first)
 */
window.__xfCapture = (() => {
  'use strict';

  const SYNTH = '示例文字';
  const EMOJI_SRC = 'https://abs-0.twimg.com/emoji/v2/svg/1f642.svg';
  const DEFAULT_AVATAR = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SVG_PATH = 'M0 0h24v24H0z';
  const BASE_TIME = Date.UTC(2026, 0, 1);
  const HOUR_MS = 3600000;
  const QUOTE = 'div[role="link"][tabindex="0"]';

  const X_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
  const KEEP_ATTRS = new Set([
    'data-testid', 'role', 'tabindex', 'aria-hidden', 'dir', 'type', 'target', 'rel', 'draggable',
    'aria-haspopup', 'aria-expanded', 'aria-selected', 'aria-checked', 'aria-disabled', 'aria-live',
    'aria-orientation', 'aria-multiselectable', 'viewBox',
  ]);
  const DROP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'LINK', 'META', 'TEMPLATE', 'OBJECT', 'EMBED', 'SOURCE', 'TRACK', 'CANVAS',
  ]);
  const KEEP_FIRST = new Set([
    'home', 'explore', 'notifications', 'messages', 'settings', 'compose', 'i', 'jobs', 'communities',
    'premium_sign_up', 'verified-choose', 'lists', 'bookmarks', 'tos', 'privacy', 'logout', 'account', 'grok',
  ]);
  const PATH_WORDS = new Set([
    'status', 'photo', 'video', 'analytics', 'quotes', 'retweets', 'likes', 'history', 'with_replies', 'media',
    'highlights', 'articles', 'followers', 'following', 'verified_followers', 'lists', 'communities', 'header_photo',
  ]);
  const IMAGE_KINDS = {
    media: 'media',
    profile_images: 'avatar',
    amplify_video_thumb: 'video',
    ext_tw_video_thumb: 'video',
    tweet_video_thumb: 'gif',
    card_img: 'card',
    semantic_core_img: 'topic',
    profile_banners: 'banner',
    ad_img: 'ad',
    news_img: 'news',
  };
  const IMAGE_SUFFIX = /(?:_(?:normal|bigger|mini|x96|200x200|400x400|reasonably_small))?(?:\.(?:jpe?g|png|webp|gif))?$/i;
  const HANDLE_TEXT = /^(\s*)@([A-Za-z0-9_]{1,15})(\s*)$/;
  const TAG_TEXT = /^(\s*)([#$])(\S+?)(\s*)$/u;
  const DOMAIN_TEXT = /^(\s*)(?:(\S+)\s+)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})(\s*)$/i;

  const sequences = new Map();
  const rows = new Map();

  function seq(kind, key) {
    let map = sequences.get(kind);
    if (map === undefined) {
      map = new Map();
      sequences.set(kind, map);
    }
    if (!map.has(key)) map.set(key, map.size + 1);
    return map.get(key);
  }

  function mapUser(name) {
    return `user${seq('user', name.toLowerCase())}`;
  }

  function mapId(id) {
    return String(10n ** 18n + BigInt(seq('id', id)));
  }

  function decode(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function synth(text) {
    let index = 0;
    return text.replace(/\S/gu, () => SYNTH[index++ % SYNTH.length]);
  }

  function rewriteHref(raw) {
    let url;
    try {
      url = new URL(raw, 'https://x.com');
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.hostname === 't.co') return `https://t.co/fixture${seq('tco', url.pathname)}`;
    if (!X_HOSTS.has(url.hostname)) return `https://example.com/fixture${seq('ext', url.href)}`;
    const segs = url.pathname.split('/').filter(Boolean);
    if (segs.length === 0) return '/';
    const first = segs[0];
    const rest = segs.slice(1);
    if (first === 'hashtag') return `/hashtag/tag${seq('tag', decode(rest[0] || '').toLowerCase())}`;
    if (first === 'search') return '/search?q=fixture';
    if (KEEP_FIRST.has(first)) {
      return `/${segs.map((s) => (/^\d+$/.test(s) ? '1' : /^[a-z_-]{1,30}$/.test(s) ? s : 'x')).join('/')}`;
    }
    if (!/^[A-Za-z0-9_]{1,15}$/.test(first)) return '/';
    const out = [mapUser(first)];
    for (let i = 0; i < rest.length; i += 1) {
      const s = rest[i];
      if (/^\d+$/.test(s)) out.push(rest[i - 1] === 'status' ? mapId(s) : '1');
      else out.push(PATH_WORDS.has(s) ? s : 'x');
    }
    return `/${out.join('/')}`;
  }

  function rewriteImage(raw) {
    let url;
    try {
      url = new URL(raw, location.href);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:') return null;
    if (url.hostname === 'abs-0.twimg.com' && url.pathname.startsWith('/emoji/')) return EMOJI_SRC;
    if (url.hostname === 'abs.twimg.com' && url.pathname.startsWith('/sticky/default_profile_images/')) {
      return DEFAULT_AVATAR;
    }
    if (url.hostname !== 'pbs.twimg.com') return null;
    const segs = url.pathname.split('/').filter(Boolean);
    const kind = segs.length >= 2 && /^[a-z_]{1,30}$/.test(segs[0]) ? segs[0] : 'x';
    const file = segs[segs.length - 1] || '';
    const suffix = IMAGE_SUFFIX.exec(file)[0];
    const middle = segs.slice(1, -1).map((s) => (/^\d+$/.test(s) ? '1' : s === 'img' || s === 'pu' ? s : 'x'));
    const name = `fixture-${IMAGE_KINDS[kind] || 'image'}-${seq('img', url.pathname)}${suffix}`;
    const params = new URLSearchParams();
    for (const key of ['format', 'name']) {
      const value = url.searchParams.get(key);
      if (value !== null && /^[a-z0-9]{1,12}$/i.test(value)) params.set(key, value);
    }
    const query = params.toString();
    return `https://pbs.twimg.com/${[kind, ...middle, name].join('/')}${query ? `?${query}` : ''}`;
  }

  function rewriteText(node) {
    const text = node.nodeValue || '';
    if (!/\S/.test(text)) return;
    const inLink = node.parentElement !== null && node.parentElement.closest('a') !== null;
    let match = HANDLE_TEXT.exec(text);
    if (match) {
      node.nodeValue = `${match[1]}@${mapUser(match[2])}${match[3]}`;
      return;
    }
    match = inLink ? TAG_TEXT.exec(text) : null;
    if (match) {
      node.nodeValue = `${match[1]}${match[2]}tag${seq('tag', match[3].toLowerCase())}${match[4]}`;
      return;
    }
    match = DOMAIN_TEXT.exec(text);
    if (match) {
      node.nodeValue = `${match[1]}${match[2] ? `${synth(match[2])} ` : ''}example.com${match[4]}`;
      return;
    }
    node.nodeValue = synth(text);
  }

  function rewriteAttributes(el, inText) {
    for (const attribute of Array.from(el.attributes)) {
      const name = attribute.name;
      const value = attribute.value;
      let next = null;
      if (name === 'data-testid') {
        next = value.startsWith('UserAvatar-Container-')
          ? `UserAvatar-Container-${mapUser(value.slice('UserAvatar-Container-'.length))}`
          : value.replace(/\d{5,}/g, (digits) => mapId(digits));
      } else if (name === 'href') {
        next = rewriteHref(value);
      } else if (name === 'src' || name === 'poster') {
        next = rewriteImage(value);
      } else if (name === 'datetime') {
        next = new Date(BASE_TIME - seq('time', value) * HOUR_MS).toISOString();
      } else if (name === 'alt') {
        next = value === '' ? '' : inText ? '🙂' : 'ALT';
      } else if (name === 'aria-label') {
        next = 'LABEL';
      } else if (name === 'style') {
        const found = /url\(["']?(.*?)["']?\)/.exec(el.style ? el.style.backgroundImage : '');
        const image = found ? rewriteImage(found[1]) : null;
        next = image === null ? null : `background-image: url("${image}");`;
      } else if (name === 'd' && el.tagName.toLowerCase() === 'path') {
        next = SVG_PATH;
      } else if (KEEP_ATTRS.has(name) && /^[\w .:-]{0,40}$/.test(value)) {
        next = value;
      }
      if (next === null) el.removeAttribute(name);
      else if (next !== value) el.setAttribute(name, next);
    }
  }

  function resetSvg(svg) {
    while (svg.firstChild !== null) svg.firstChild.remove();
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', SVG_PATH);
    svg.appendChild(path);
  }

  function sanitizeInPlace(root) {
    const walk = (el, inText) => {
      if (DROP_TAGS.has(el.tagName.toUpperCase())) {
        el.remove();
        return;
      }
      const textBlock = inText || el.getAttribute('data-testid') === 'tweetText';
      rewriteAttributes(el, textBlock);
      if (el.namespaceURI === SVG_NS && el.tagName.toLowerCase() === 'svg') {
        resetSvg(el);
        return;
      }
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.removeAttribute('value');
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) rewriteText(child);
        else if (child.nodeType === Node.ELEMENT_NODE) walk(child, textBlock);
        else child.remove();
      }
    };
    walk(root, false);
    return root;
  }

  function sanitize(node) {
    return sanitizeInPlace(node.cloneNode(true));
  }

  function permalinkOf(cell) {
    for (const a of cell.querySelectorAll('a[href*="/status/"]')) {
      if (a.closest(QUOTE) === null && a.querySelector('time') !== null) return a.getAttribute('href');
    }
    return null;
  }

  function grab() {
    let added = 0;
    for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
      if (cell.querySelector('article[data-testid="tweet"]') === null) continue;
      const key =
        permalinkOf(cell) || `ad:${cell.querySelectorAll('*').length}:${(cell.textContent || '').length}`;
      if (rows.has(key)) continue;
      rows.set(key, sanitize(cell));
      added += 1;
    }
    return { added, total: rows.size };
  }

  function coverage() {
    const out = {
      posts: 0, photo1: 0, photo2: 0, photo3: 0, photo4: 0, video: 0, gif: 0, cardLarge: 0, cardSmall: 0,
      quote: 0, quoteMedia: 0, showMore: 0, promoted: 0, avatar: 0, verified: 0,
    };
    for (const row of rows.values()) {
      const post = row.querySelector('article[data-testid="tweet"]');
      if (post === null) continue;
      out.posts += 1;
      const quote = post.querySelector(QUOTE);
      const own = (selector) =>
        Array.from(post.querySelectorAll(selector)).filter((el) => quote === null || !quote.contains(el));
      const stills = own('[data-testid="tweetPhoto"]').filter(
        (cell) => cell.querySelector('video') === null && cell.querySelector('img[src]') !== null,
      );
      if (stills.length > 0) out[`photo${Math.min(stills.length, 4)}`] += 1;
      for (const video of own('video')) {
        if (String(video.getAttribute('poster')).includes('/tweet_video_thumb/')) out.gif += 1;
        else out.video += 1;
      }
      if (own('[data-testid="card.layoutSmall.media"]').length > 0) out.cardSmall += 1;
      else if (own('[data-testid="card.wrapper"]').length > 0) out.cardLarge += 1;
      if (quote !== null) {
        out.quote += 1;
        if (quote.querySelector('img[src*="/media/"], video') !== null) out.quoteMedia += 1;
      }
      if (own('[data-testid="tweet-text-show-more-link"]').length > 0) out.showMore += 1;
      if (post.querySelector('[data-testid="placementTracking"]') !== null && permalinkOf(row) === null) {
        out.promoted += 1;
      }
      if (own('[data-testid="Tweet-User-Avatar"] img[src*="/profile_images/"]').length > 0) out.avatar += 1;
      if (own('[data-testid="icon-verified"]').length > 0) out.verified += 1;
    }
    return out;
  }

  async function collect({ scrolls = 10, delayMs = 1200 } = {}) {
    for (let i = 0; i < scrolls; i += 1) {
      grab();
      scrollBy(0, innerHeight * 1.5);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    grab();
    return coverage();
  }

  function reset() {
    rows.clear();
  }

  function go(path) {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    return location.pathname.split('/').length;
  }

  function openLongPost() {
    for (const [key, row] of rows) {
      if (!key.startsWith('/') || row.querySelector('[data-testid="tweet-text-show-more-link"]') === null) continue;
      const id = /\/status\/(\d+)/.exec(key);
      if (id === null) continue;
      go(key.replace(/\/(?:photo|video)\/\d+$/, ''));
      return mapId(id[1]);
    }
    return null;
  }

  function html() {
    const background = document.body.style.backgroundColor || 'rgb(255, 255, 255)';
    const header = document.querySelector('header[role="banner"]');
    const column = document.querySelector('[data-testid="primaryColumn"]');
    const shell = column === null ? document.createElement('div') : column.cloneNode(true);
    const first = shell.querySelector('[data-testid="cellInnerDiv"]');
    const list = first === null ? shell : first.parentElement;
    for (const cell of Array.from(shell.querySelectorAll('[data-testid="cellInnerDiv"]'))) cell.remove();
    sanitizeInPlace(shell);
    for (const row of rows.values()) list.appendChild(row.cloneNode(true));
    const head = header === null ? '' : sanitize(header).outerHTML;
    return (
      '<!doctype html>\n<html lang="zh"><head><meta charset="utf-8"><title>X Folders fixture</title></head>' +
      `<body style="background-color: ${background};"><div id="react-root"><div><div>${head}` +
      `<main role="main"><div>${shell.outerHTML}</div></main></div></div></div></body></html>\n`
    );
  }

  function download(name) {
    const blob = new Blob([html()], { type: 'text/html' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    return `${name}: ${blob.size} bytes`;
  }

  return { sanitize, grab, collect, coverage, reset, go, openLongPost, html, download };
})();
```

`go()` 故意只返回路径段数而不是路径本身：真实用户名和帖子 ID 只在页面里用，不回到调用方。

- [ ] **Step 5：给脚本配 lint**

`eslint.config.js` 在最后一个配置对象（`tests/**` 那个）后面加：

```js
  {
    // Runs inside an x.com page, not in the extension (see tools/capture-fixture.js).
    files: ['tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        location: 'readonly',
        history: 'readonly',
        Node: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Blob: 'readonly',
        PopStateEvent: 'readonly',
        setTimeout: 'readonly',
        scrollBy: 'readonly',
        innerHeight: 'readonly',
        dispatchEvent: 'readonly',
      },
    },
  },
```

- [ ] **Step 6：运行，确认通过**

Run: `pnpm vitest run tests/unit/capture-fixture.test.ts tests/unit/fixtures-sanitized.test.ts && pnpm lint`
Expected: `capture-fixture` PASS；`fixtures-sanitized` 仍为 SKIP；lint 无错误

- [ ] **Step 7：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add tools/capture-fixture.js eslint.config.js tests/helpers/sanitizedCheck.ts \
  tests/unit/capture-fixture.test.ts tests/unit/fixtures-sanitized.test.ts
git commit -m "新增页面样本采集脚本（页面内默认拒绝脱敏）与泄露检查"
git push origin main
```

---

### Task 14：在真实 x.com 上抓新样本（需要你配合）

这一版抓首页（宽屏）、长帖详情页和书签页三类，覆盖快照要读的全部内容。个人主页和搜索页继续用 v0.1 的样本（按钮注入测试已在用）；窄屏首页留到 M3，那时要做侧边栏模式下的导航入口图标，正好一起抓。

**Files:**
- Create: `tests/fixtures/x-home-rich.html`、`tests/fixtures/x-status-long.html`、`tests/fixtures/x-bookmarks.html`
- Modify: `tests/unit/fixtures-sanitized.test.ts`（去掉跳过）、`tests/helpers/fixtures.ts`（新样本名）
- Create: `tests/unit/tweet-extractor-rich.test.ts`
- Modify（视样本而定）：`src/hosts/x/extract*.ts`、`tests/helpers/postDom.ts`

- [ ] **Step 1：征得同意**

向你说明并等你同意：用 Claude in Chrome 在你已登录的 x.com 上打开**首页**、**一条长帖的详情页**、**书签页**，运行 `tools/capture-fixture.js`（只滚动，不点击，不点赞、不转帖、不书签、不发帖、不改设置），在页面里脱敏后**下载 3 个 HTML 文件**到「下载」文件夹（文件名 `x-home-rich.html`、`x-status-long.html`、`x-bookmarks.html`，每个预计 50–300KB，下载前报告实际大小）。书签页里是你的私人收藏，脱敏后只剩结构。采集期间需要你把那个标签页切到前台（后台标签页不加载图片）。

- [ ] **Step 2：首页**

1. 用 Claude in Chrome 新开标签页打开 `https://x.com/home`，请你切到前台。
2. `javascript_tool` 执行 `tools/capture-fixture.js` 的全部内容。
3. 执行 `await window.__xfCapture.collect({ scrolls: 20 })`，查看返回的覆盖情况。
4. **必需**：`photo1+photo2+photo3+photo4 ≥ 1`、`video ≥ 1`、`cardLarge+cardSmall ≥ 1`、`quote ≥ 1`、`showMore ≥ 1`、`avatar ≥ posts × 0.8`。**尽量有**：`photo2`–`photo4`、`gif`、`cardSmall`、`quoteMedia`、`promoted`。必需项不够就再 `collect({ scrolls: 15 })`，总共最多 60 条；还不够，停下来和你商量去哪个页面补（每个新页面单独征得同意）。
5. 执行 `window.__xfCapture.download('x-home-rich.html')`，报告大小。

- [ ] **Step 3：长帖详情页**

执行 `window.__xfCapture.openLongPost()`（返回合成 ID，记下）→ 等 3 秒 → `window.__xfCapture.reset(); window.__xfCapture.grab()` → 确认 `coverage().posts ≥ 1` → `download('x-status-long.html')`。

- [ ] **Step 4：书签页**

执行 `window.__xfCapture.go('/i/bookmarks')` → 等 3 秒 → `reset()` → `await collect({ scrolls: 5 })` → `download('x-bookmarks.html')`。如果你的书签页是空的，跳过这一页，并把 Step 7 里书签相关的断言和 Task 15 的书签用例一起删掉，在报告里写明。完成后关闭标签页。

- [ ] **Step 5：放进仓库并检查泄露**

```bash
mv ~/Downloads/x-home-rich.html ~/Downloads/x-status-long.html ~/Downloads/x-bookmarks.html tests/fixtures/
```

`tests/unit/fixtures-sanitized.test.ts` 里 `it.skipIf(!existsSync(path))(name, …)` 改为 `it(name, …)`，删掉不再使用的 `existsSync` 导入和那行注释。

Run: `pnpm vitest run tests/unit/fixtures-sanitized.test.ts`
Expected: 3 个 PASS。任何一处泄露都**不许提交**：先修 `tools/capture-fixture.js`（配单元测试），再重抓。

再人工抽查一遍：

```bash
grep -o 'data-testid="[^"]*"' tests/fixtures/x-home-rich.html | sort | uniq -c | sort -rn | head -40
grep -c 'fixture-' tests/fixtures/x-home-rich.html
```

- [ ] **Step 6：新样本名**

`tests/helpers/fixtures.ts` 中：

```ts
export type FixtureName =
  | 'x-home'
  | 'x-status'
  | 'x-profile'
  | 'x-search'
  | 'x-home-rich'
  | 'x-status-long'
  | 'x-bookmarks';
```

- [ ] **Step 7：用新样本回归提取**

`tests/unit/tweet-extractor-rich.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import type { TweetRecord } from '@/core/domain/tweet';
import { extractTweet } from '@/hosts/x/TweetExtractor';
import { loadFixture, type FixtureName } from '../helpers/fixtures';

const NOW = Date.UTC(2026, 8, 30);

function records(name: FixtureName, pathname: string): TweetRecord[] {
  return loadFixture(name).tweets.flatMap((root) => {
    const outcome = extractTweet(root, { pathname, now: NOW });
    return outcome.status === 'ok' ? [outcome.record] : [];
  });
}

describe('snapshots from the 2026-09 captures', () => {
  const home = records('x-home-rich', '/home');

  it('reads an avatar, a name and a time for nearly every post', () => {
    expect(home.length).toBeGreaterThan(10);
    const complete = home.filter(
      (record) =>
        record.avatarUrl?.startsWith('https://pbs.twimg.com/profile_images/') === true &&
        record.authorName !== null &&
        record.postedAt !== null,
    );
    expect(complete.length / home.length).toBeGreaterThanOrEqual(0.8);
  });

  it('finds every kind of content the capture was required to cover', () => {
    expect(home.some((record) => record.media.some((item) => item.kind === 'photo'))).toBe(true);
    expect(home.some((record) => record.media.some((item) => item.kind === 'video'))).toBe(true);
    expect(home.some((record) => record.card?.url.startsWith('https://t.co/') === true)).toBe(true);
    expect(home.some((record) => record.quote !== null)).toBe(true);
    expect(home.some((record) => record.truncated)).toBe(true);
  });

  it('keeps quoted pictures out of the outer post', () => {
    for (const record of home) {
      const quoted = record.quote?.media?.url;
      if (quoted === undefined) continue;
      expect(record.media.map((item) => item.url)).not.toContain(quoted);
    }
  });

  it('finds the full text of a cut-short post on its own page', () => {
    const cut = home.find((record) => record.truncated);
    expect(cut).toBeDefined();
    if (cut === undefined) return;
    const own = records('x-status-long', `/${cut.username}/status/${cut.tweetId}`).find(
      (record) => record.tweetId === cut.tweetId,
    );
    expect(own?.truncated).toBe(false);
    expect(own?.text.length ?? 0).toBeGreaterThan(cut.text.length);
  });

  it('extracts the posts on the bookmarks page', () => {
    expect(records('x-bookmarks', '/i/bookmarks').length).toBeGreaterThan(0);
  });
});
```

Run: `pnpm vitest run tests/unit/tweet-extractor-rich.test.ts`
Expected: PASS。

**如果失败**（例如链接卡片的文字结构、GIF 的封面路径与假设不同）：按 superpowers:systematic-debugging 在样本里查清真实结构 → 先把 `tests/helpers/postDom.ts` 里对应的手写模板改成真实结构、让 Task 6–9 的单元测试先失败 → 再改 `src/hosts/x/extract*.ts` → 全部通过。把新发现记进 Task 17 要写的选择器手册。

- [ ] **Step 8：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add tests/fixtures/x-home-rich.html tests/fixtures/x-status-long.html tests/fixtures/x-bookmarks.html \
  tests/unit/fixtures-sanitized.test.ts tests/helpers/fixtures.ts tests/unit/tweet-extractor-rich.test.ts
git commit -m "新增 2026-09 脱敏页面样本（首页、长帖详情、书签页）并用它们回归提取"
git push origin main
```

（若 Step 7 改了提取代码或 `postDom.ts`，一并加入这次提交。）

---

### Task 15：端到端测试（富卡片、长帖补全、打开方式、⋯ 菜单、书签页）

**Files:**
- Modify: `tests/e2e/harness.ts`
- Create: `tests/e2e/rich-card.spec.ts`

- [ ] **Step 1：测试框架支持新样本与图片**

`tests/e2e/harness.ts`：

1. `fixtureFor` 整个替换为：

```ts
/** Which captured page answers an x.com URL; `?fixture=name` picks one explicitly. */
function fixtureFor(url: URL): string {
  const named = url.searchParams.get('fixture');
  if (named !== null && /^[a-z-]+$/.test(named)) return `x-${named}.html`;
  if (/^\/[^/]+\/status\/\d+/.test(url.pathname)) return 'x-status.html';
  if (url.pathname.startsWith('/search')) return 'x-search.html';
  if (url.pathname === '/i/bookmarks') return 'x-bookmarks.html';
  if (url.pathname === '/home' || url.pathname === '/') return 'x-home.html';
  return 'x-profile.html';
}
```

2. x.com 路由里的

```ts
      const { pathname } = new URL(request.url());
```

改为 `const url = new URL(request.url());`，`fixtureFor(pathname)` 改为 `fixtureFor(url)`。
3. 在 x.com 路由之后加（后注册的路由优先，所以它盖过前面的「一律拒绝」）：

```ts
    // Pictures get a plain grey frame, so cards render as they would on X
    // without anything leaving the machine.
    await context.route('https://pbs.twimg.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PLACEHOLDER_SVG }),
    );
```

4. 文件顶部常量区加：

```ts
const PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="338"><rect width="600" height="338" fill="#cfd9de"/></svg>';
```

- [ ] **Step 2：写端到端用例**

`tests/e2e/rich-card.spec.ts`：

```ts
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './harness';

const RICH = '/home?fixture=home-rich';

async function ready(page: Page): Promise<void> {
  await expect.poll(() => page.locator('[data-xf-action-host]').count(), { timeout: 3_000 }).toBeGreaterThan(0);
}

async function createFolder(page: Page, name: string): Promise<void> {
  const sidebar = page.locator('[data-xf-sidebar-host]');
  await sidebar.getByRole('button', { name: '新建文件夹' }).click();
  const input = sidebar.getByPlaceholder('文件夹名称');
  await input.fill(name);
  await input.press('Enter');
  await expect(sidebar.getByRole('button', { name, exact: true })).toBeVisible();
}

/** The id of the first post whose article contains `selector`. */
async function postWith(page: Page, selector: string, options: { ownOnly?: boolean } = {}): Promise<string> {
  // ownOnly: the post itself has it, not merely the post it quotes.
  const noQuote = options.ownOnly === true ? ':not(:has(div[role="link"][tabindex="0"]))' : '';
  const host = page.locator(`article[data-testid="tweet"]:has(${selector})${noQuote} [data-xf-action-host]`).first();
  await expect(host).toHaveCount(1);
  const id = await host.getAttribute('data-xf-tweet-id');
  if (id === null) throw new Error(`no post with ${selector}`);
  return id;
}

async function saveInto(page: Page, tweetId: string, folder: string): Promise<void> {
  await page.locator(`[data-xf-action-host][data-xf-tweet-id="${tweetId}"] button`).click();
  const popover = page.locator('[data-xf-popover-host]');
  await popover.getByRole('menuitemcheckbox', { name: folder, exact: true }).first().click();
  await expect(popover).toHaveCount(0);
}

async function openFolder(page: Page, folder: string): Promise<Locator> {
  await page.locator('[data-xf-sidebar-host]').getByRole('button', { name: folder, exact: true }).click();
  return page.locator('[data-xf-overlay-host]');
}

test('a saved post with pictures shows as a rich card on the page and in the side panel', async ({
  harness,
}, testInfo) => {
  const page = await harness.openX(RICH);
  await ready(page);
  await createFolder(page, '图片');
  const id = await postWith(page, '[data-testid="tweetPhoto"] img', { ownOnly: true });
  await saveInto(page, id, '图片');

  const overlay = await openFolder(page, '图片');
  const row = overlay.locator(`[data-xf-tweet-id="${id}"]`);
  await expect(row.locator('.xf-tc-media-cell')).not.toHaveCount(0);
  await expect(row.locator('img.xf-tc-avatar')).toHaveCount(1);
  await expect(row.locator('.xf-tc-name')).not.toHaveText('');
  await expect(row.locator('.xf-tc-saved')).toHaveText(/^保存于 /);
  await page.screenshot({ path: testInfo.outputPath('rich-card-page.png') });

  const panel = await harness.context.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${harness.extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: '图片', exact: true }).click();
  await expect(panel.locator(`[data-xf-tweet-id="${id}"] .xf-tc-media-cell`)).not.toHaveCount(0);
  await panel.screenshot({ path: testInfo.outputPath('rich-card-panel.png') });
});

test('a post saved cut short is completed once its own page has been seen', async ({ harness }) => {
  const page = await harness.openX(RICH);
  await ready(page);
  await createFolder(page, '长帖');
  const id = await postWith(page, '[data-testid="tweet-text-show-more-link"]');
  await saveInto(page, id, '长帖');
  const overlay = await openFolder(page, '长帖');
  await expect(overlay.locator(`[data-xf-tweet-id="${id}"] .xf-tc-more`)).toHaveCount(1);

  // The post's own page shows the whole text: once its saved count arrives,
  // the refresher sends the fuller capture and the background merges it.
  const detail = await harness.openX(`/user1/status/${id}?fixture=status-long`);
  await ready(detail);

  await expect
    .poll(
      async () => {
        await page.reload();
        const again = await openFolder(page, '长帖');
        return again.locator(`[data-xf-tweet-id="${id}"] .xf-tc-more`).count();
      },
      { timeout: 10_000 },
    )
    .toBe(0);
});

test('clicking a card opens the post; ⌘/Ctrl-click opens it in a new tab', async ({ harness }) => {
  const page = await harness.openX(RICH);
  await ready(page);
  await createFolder(page, 'A');
  const id = await postWith(page, '[data-testid="tweetText"]');
  await saveInto(page, id, 'A');
  const overlay = await openFolder(page, 'A');
  const saved = overlay.locator(`[data-xf-tweet-id="${id}"] .xf-tc-saved`);

  const [popup] = await Promise.all([
    harness.context.waitForEvent('page'),
    saved.click({ modifiers: ['ControlOrMeta'] }),
  ]);
  await expect.poll(() => popup.url()).toContain(`/status/${id}`);
  await popup.close();

  await Promise.all([page.waitForURL(new RegExp(`/status/${id}`)), saved.click()]);
});

test('the ⋯ menu removes a post from the folder', async ({ harness }) => {
  const page = await harness.openX(RICH);
  await ready(page);
  await createFolder(page, 'B');
  const id = await postWith(page, '[data-testid="tweetText"]');
  await saveInto(page, id, 'B');
  const overlay = await openFolder(page, 'B');

  await overlay.locator(`[data-xf-tweet-id="${id}"]`).getByRole('button', { name: '更多操作' }).click();
  await overlay.getByRole('menuitem', { name: '从此文件夹移除' }).click();
  await expect(overlay.locator(`[data-xf-tweet-id="${id}"]`)).toHaveCount(0);
  await expect(overlay.locator('.xf-fv-count')).toHaveText('0 条收藏');
});

test('every post on the bookmarks page gets exactly one folder button', async ({ harness }) => {
  const page = await harness.openX('/i/bookmarks');
  await ready(page);
  const extractable = page.locator('article[data-testid="tweet"]:not([data-xf-skip])');
  await expect
    .poll(async () => (await page.locator('[data-xf-action-host]').count()) === (await extractable.count()))
    .toBe(true);
  const perPost = await extractable.evaluateAll((posts) =>
    posts.map((post) => post.querySelectorAll('[data-xf-action-host]').length),
  );
  expect(perPost.every((count) => count === 1)).toBe(true);
});
```

- [ ] **Step 3：运行**

Run: `pnpm test:e2e`
Expected: M1 的 8 个用例 + 这 5 个全部 PASS。失败时先看 `test-results/` 里的截图和轨迹，用 superpowers:systematic-debugging 找根因。

- [ ] **Step 4：给你看效果**

把 `test-results/` 下的 `rich-card-page.png`（页面内）和 `rich-card-panel.png`（侧边栏宽度）用截图发给你（内置浏览器渲染不出来，按约定发图片）。图片位置是灰色占位（测试不联网），版式、头像、名字行、正文、图片网格可以看清。

- [ ] **Step 5：提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add tests/e2e/harness.ts tests/e2e/rich-card.spec.ts
git commit -m "端到端测试：富卡片、长帖补全、打开方式、⋯ 菜单与书签页按钮"
git push origin main
```

---

### Task 16：真实 X 冒烟测试（需要你配合）

- [ ] **Step 1：构建并请你重新加载扩展**

```bash
pnpm build
```

请你在 `chrome://extensions` 里点 X Folders 的「重新加载」（不要卸载：卸载会清空数据，就测不到旧数据迁移了）。

- [ ] **Step 2：征得同意后逐项检查**

用 Claude in Chrome 在你已登录的 x.com 上检查（只点插件自己的界面和帖子卡片；不点赞、不转帖、不书签、不发帖、不改设置）；测试标签页请放在前台：

| # | 检查 | 通过标准 |
|---|---|---|
| 1 | 旧数据迁移 | M1 时存的帖子仍在原文件夹里，卡片显示作者和正文 |
| 2 | 保存各类帖子 | 在首页把带图 / 视频 / 引用 / 链接卡片 / 长帖各一条（遇到哪类测哪类）存进「M2 测试」文件夹 |
| 3 | 页面内卡片外观 | 截图发给你，与 X 原帖对照：头像、名字行、正文链接、图片排列、视频封面、引用块、链接卡片 |
| 4 | 侧边栏卡片 | 你打开侧边栏看同一个文件夹，外观一致（你确认） |
| 5 | 长帖补全 | 打开那条长帖的详情页，停 2 秒，回到列表：全文、没有「显示更多」 |
| 6 | 打开方式 | 点卡片空白处 → 当前标签页跳到原帖；⌘ 点 → 新标签页；⋯ →「在新标签页打开」 |
| 7 | ⋯ 移除 | ⋯ →「从此文件夹移除」→ 卡片消失、数量减一，帖子上的按钮同步变化 |
| 8 | 旧帖子补全 | 如果能在时间线上再看到第 1 项里的某条旧帖子：回列表后它有了头像等信息 |

- [ ] **Step 3：如实记录**

`docs/manual-qa.md` 末尾追加一节 `## M2 帖子快照与富卡片（执行日期，真实登录态 x.com，Chrome 版本号，macOS）`，结构同 M1：检查表（结果、证据 / 备注）、发现的缺陷与修复提交、复验、尚未验证。

- [ ] **Step 4：缺陷处理**

每个缺陷：先写能复现它的自动化测试（单元或端到端）→ 修复 → 全量检查 → 单独提交 → 请你重新加载后复验，结果补进 manual-qa。

- [ ] **Step 5：提交记录**

```bash
git add docs/manual-qa.md
git commit -m "记录 M2 真实 X 冒烟测试结果"
git push origin main
```

---

### Task 17：M2 收尾

**Files:**
- Modify: `docs/privacy.md`、`docs/selector-playbook.md`、`docs/superpowers/specs/2026-09-28-folders-for-x-v0.2-design.md`（附录 A 第 2 条）、`CHANGELOG.md`

- [ ] **Step 1：隐私说明**

`docs/privacy.md` 中 `### \`tweets\`（帖子元数据，主键 \`tweetId\`）` 一节（从标题到「正文是从页面读出的可见文本，不是 X 接口返回的对象。」为止）替换为：

```markdown
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
信息，不是 X 接口返回的对象。

**补全**：已保存的帖子再次出现在你浏览的页面上时，扩展用页面上看到的内容补全这条记录（例如长帖的全文、换过
的头像地址）。没有保存过的帖子不会被记录。

**图片加载**：收藏列表显示图片时，浏览器直接从 X 的图片服务器 `pbs.twimg.com` 加载，与你在 X 上看到这些图片
相同，并且不附带来源页信息；扩展自己不向任何地方发送数据。
```

- [ ] **Step 2：选择器手册**

`docs/selector-playbook.md` 末尾追加：

```markdown
## 2026-09-29 快照相关实测（M2）

- 认证标记 `svg[data-testid="icon-verified"]` 在 `User-Name` 的第一个链接里；引用块的认证标记在它自己的 `User-Name` 里。
- 头像在 `Tweet-User-Avatar` 里懒加载，`img` 与 `background-image` 两种画法都有；后台标签页里两者都还没有，所以保存时重新读取。
- 视频：`tweetPhoto > placementTracking > videoPlayer > videoComponent > video[poster]`，`src` 为 `blob:`；GIF 的封面路径含 `/tweet_video_thumb/`。视频格里也有 `placementTracking`，它不能单独作为广告判据。
- 引用块 `div[role="link"][tabindex="0"]` 里**没有**链接：`@用户名` 在 `div[tabindex="-1"]` 里，时间在 `div > time` 里；引用的媒体在 `testCondensedMedia` 里，敏感内容被 `previewInterstitial` 遮住。
- 「显示更多」是 `tweetText` 的兄弟 `[data-testid="tweet-text-show-more-link"]`；详情页主帖显示全文，没有它。
- 链接卡片：`card.wrapper` 内是 `card.layoutLarge.media` 或 `card.layoutSmall.media`；域名与标题按文字的形状区分（见 `src/hosts/x/extractMedia.ts`），不依赖界面语言。
```

再把 Task 14 Step 7 里发现的新事实（如有）逐条补在后面。

- [ ] **Step 3：更正工单附录 A 第 2 条**

`docs/superpowers/specs/2026-09-28-folders-for-x-v0.2-design.md` 附录 A 第 2 条改为：

```markdown
2. **引用的帖子不是嵌套的帖子根**，而是同一个 `article` 里的 `div[role="link"][tabindex="0"]`，自带作者、时间和正文。2026-09-29 实测其中**没有指向引用帖的链接**（时间在普通 `div` 里），所以快照里引用帖的链接只在页面给出时才有。
```

- [ ] **Step 4：更新日志**

`CHANGELOG.md` 的 `## [未发布]` 里：

「修复」小节末尾追加：

```markdown
- 后台自报的版本号不再写死为 0.1.0。
- 文件夹层级与子孙计算不再写死为两层。
```

「新增」小节末尾追加：

```markdown
- 收藏列表改为还原 X 的富卡片：头像、昵称、认证标记、@用户名、发帖时间；正文里的链接、@提及、#话题可点；1–4 张图按 X 的方式排列；视频和 GIF 显示封面；引用帖与链接预览卡片。页面内与侧边栏共用同一套卡片。
- 卡片「⋯」菜单（在新标签页打开、从此文件夹移除），卡片底部显示「保存于 某日」。
- 时间线上被「显示更多」截断的长帖，之后在详情页看到全文时自动补全；已保存帖子的头像等信息随之更新。
- 数据库升级到第 2 版，旧数据自动迁移。
- 页面样本采集脚本：在页面里默认拒绝式脱敏，另有泄露检查守住每个提交的样本。
```

并新增一个「安全」小节：

```markdown
### 安全

- 帖子快照在后台逐字段校验：图片只接受 `https://pbs.twimg.com/`，链接只接受 http/https，其余一律丢弃；显示时再校验一次。
```

- [ ] **Step 5：全量检查并提交**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm build
git add docs/privacy.md docs/selector-playbook.md docs/superpowers/specs/2026-09-28-folders-for-x-v0.2-design.md CHANGELOG.md
git commit -m "M2 收尾：更新隐私说明、选择器手册、工单附录与更新日志"
git push origin main
```

---

## M2 完成的标准

- 全部 17 个任务完成，`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:e2e`、`pnpm build` 全部通过；
- 三个新样本通过泄露检查，并被提取回归测试与端到端测试使用；
- 真实 X 冒烟 8 项结果如实写进 `docs/manual-qa.md`，发现的缺陷都已修复并复验；
- 之后再写 M3（两种阅读模式完整版）的计划。
