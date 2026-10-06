import { describe, expect, it } from 'vitest';
import { isCanonicalSurfacesSearch, shouldBlockSurfacesNavigation, surfacesSearchSchema } from './surfaces-search.model';
const id = 'a0000000-0000-4000-8000-000000000001';
describe('GEO Surface/Profile URL 状态', () => {
  it('省略默认值，规范 UUID，清理坏参数和跨 Tab 字段', () => {
    expect(surfacesSearchSchema.parse({ tab: 'surfaces', q: ' ', page: 1, page_size: 20, sort: 'NAME_ASC', profile_id: id, editor: 1 })).toEqual({});
    expect(surfacesSearchSchema.parse({ tab: 'profiles', surface_id: id.toUpperCase(), profile_id: id.toUpperCase(), is_active: 'false', page: '2', page_size: '50', editor: '1', surface_kind: 'MODEL_API' })).toEqual({ tab: 'profiles', surface_id: id, profile_id: id, is_active: false, page: 2, page_size: 50, editor: 1 });
    expect(surfacesSearchSchema.parse({ surface_id: 'bad', page: -1, page_size: 100, tab: 'unknown' })).toEqual({});
    expect(isCanonicalSurfacesSearch({ surface_id: id.toUpperCase() }, surfacesSearchSchema.parse({ surface_id: id.toUpperCase() }))).toBe(false);
  });
  it('dirty 保护编辑身份，筛选和分页保持草稿', () => {
    const current = { pathname: '/configuration/geo-surfaces', search: { tab: 'profiles', profile_id: id, editor: 1 } };
    expect(shouldBlockSurfacesNavigation(current, { ...current, search: { ...current.search, q: '过滤', page: 2 } })).toBe(false);
    expect(shouldBlockSurfacesNavigation(current, { ...current, search: { ...current.search, editor: undefined } })).toBe(true);
    expect(shouldBlockSurfacesNavigation(current, { ...current, search: { tab: 'profiles', new: 1 } })).toBe(true);
    expect(shouldBlockSurfacesNavigation(current, { ...current, pathname: '/configuration/geo-entities' })).toBe(true);
  });
});
