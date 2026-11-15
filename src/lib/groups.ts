import type { Collection } from './storage';

/**
 * Favourite groups form a tree (e.g. "Reise Eifel" › "Tag 1"). A group whose parent no longer
 * exists counts as top level, so a damaged tree never hides anything.
 */

const exists = (groups: Collection[], id?: string) => !!id && groups.some((g) => g.id === id);

/** direct children of `parentId` (undefined = top level), in creation order */
export function childGroups(groups: Collection[], parentId?: string): Collection[] {
  return groups
    .filter((g) => (parentId ? g.parentId === parentId : !exists(groups, g.parentId)))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** the group and everything below it */
export function subtreeIds(groups: Collection[], id: string): Set<string> {
  const out = new Set([id]);
  for (let added = true; added; ) {
    added = false;
    for (const g of groups)
      if (g.parentId && out.has(g.parentId) && !out.has(g.id)) {
        out.add(g.id);
        added = true;
      }
  }
  return out;
}

/** "Reise Eifel › Tag 1" */
export function groupPath(groups: Collection[], id: string): string {
  const names: string[] = [];
  const seen = new Set<string>();
  for (let g = groups.find((x) => x.id === id); g && !seen.has(g.id); g = groups.find((x) => x.id === g!.parentId)) {
    seen.add(g.id);
    names.unshift(g.name);
  }
  return names.join(' › ');
}

/** every group in tree order with its depth (for pickers) */
export function flattenGroups(groups: Collection[]): { group: Collection; depth: number }[] {
  const out: { group: Collection; depth: number }[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const g of childGroups(groups, parent)) {
      out.push({ group: g, depth });
      walk(g.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

/** Remove a group: its sub-groups move up to its parent, and so do its favourites (returned as the new group id). */
export function removeGroup(groups: Collection[], id: string): { groups: Collection[]; moveTo: string | undefined } {
  const g = groups.find((x) => x.id === id);
  const parent = exists(groups, g?.parentId) ? g!.parentId : undefined;
  return {
    groups: groups.filter((x) => x.id !== id).map((x) => (x.parentId === id ? { ...x, parentId: parent } : x)),
    moveTo: parent,
  };
}
