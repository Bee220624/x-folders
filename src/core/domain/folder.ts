export type FolderId = string;

export interface Folder {
  id: FolderId;
  name: string;
  /** `null` for a root folder. Only one level of nesting is allowed. */
  parentId: FolderId | null;
  /** Ordering key, meaningful only among siblings. */
  position: number;
  collapsed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FolderTreeNode extends Folder {
  children: FolderTreeNode[];
  depth: number;
  /** Memberships in this folder alone — descendants are not rolled up. */
  tweetCount: number;
}

/** A folder plus its own membership count, as returned by `folders.list`. */
export interface FolderWithCount extends Folder {
  tweetCount: number;
}

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

/** Depth-first walk in display order. */
export function flattenTree(nodes: readonly FolderTreeNode[]): FolderTreeNode[] {
  const out: FolderTreeNode[] = [];
  const visit = (list: readonly FolderTreeNode[]): void => {
    for (const node of list) {
      out.push(node);
      visit(node.children);
    }
  };
  visit(nodes);
  return out;
}
