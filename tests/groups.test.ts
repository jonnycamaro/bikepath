import { describe, expect, it } from 'vitest';
import { childGroups, flattenGroups, groupPath, removeGroup, subtreeIds } from '../src/lib/groups';

const g = (id: string, name: string, createdAt: number, parentId?: string) => ({ id, name, createdAt, parentId });
const groups = [g('eifel', 'Reise Eifel', 1), g('tag1', 'Tag 1', 2, 'eifel'), g('cafes', 'Cafés', 3, 'tag1'), g('home', 'Zuhause', 4), g('orphan', 'Verwaist', 5, 'gone')];

describe('favourite groups', () => {
  it('builds the tree', () => {
    expect(childGroups(groups).map((x) => x.id)).toEqual(['eifel', 'home', 'orphan']); // a missing parent counts as top level
    expect(childGroups(groups, 'eifel').map((x) => x.id)).toEqual(['tag1']);
    expect(flattenGroups(groups).map((x) => `${x.depth}:${x.group.id}`)).toEqual(['0:eifel', '1:tag1', '2:cafes', '0:home', '0:orphan']);
  });

  it('names the path and finds everything below a group', () => {
    expect(groupPath(groups, 'cafes')).toBe('Reise Eifel › Tag 1 › Cafés');
    expect([...subtreeIds(groups, 'eifel')].sort()).toEqual(['cafes', 'eifel', 'tag1']);
  });

  it('moves sub-groups and favourites up when a group is removed', () => {
    const r = removeGroup(groups, 'tag1');
    expect(r.moveTo).toBe('eifel');
    expect(r.groups.find((x) => x.id === 'cafes')?.parentId).toBe('eifel');
    expect(removeGroup(groups, 'eifel').moveTo).toBeUndefined();
  });
});
