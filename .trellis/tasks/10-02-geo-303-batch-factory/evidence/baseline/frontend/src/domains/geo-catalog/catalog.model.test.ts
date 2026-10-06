import { describe, expect, it } from 'vitest';

import {
  catalogEditorIdentity,
  catalogSearchSchema,
  catalogSearchToApiParams,
  isCanonicalCatalogSearch,
  shouldBlockCatalogNavigation,
} from './catalog.model';

const subjectId = 'abcdef00-0000-4000-8000-abcdef000001';
const productId = 'abcdef00-0000-4000-8000-abcdef000002';
const parentId = 'abcdef00-0000-4000-8000-abcdef000003';

describe('Catalog URL 模型', () => {
  it('URL 省略默认值，API 始终发送默认分页与排序', () => {
    const search = catalogSearchSchema.parse({});
    expect(search).toEqual({});
    expect(catalogSearchSchema.parse({ page: '1', page_size: '20', sort: 'NAME_ASC' })).toEqual({});
    expect(catalogSearchToApiParams(search)).toEqual({ page: 1, page_size: 20, sort: 'NAME_ASC' });
    expect(isCanonicalCatalogSearch({}, search)).toBe(true);
    expect(isCanonicalCatalogSearch({ page: 1, page_size: 20, sort: 'NAME_ASC' }, search)).toBe(false);
  });

  it('规范化文字与 UUID，保留 false 筛选并隔离编辑身份', () => {
    const raw = {
      q: '  PS-123  ',
      subject_type: 'OWN_PRODUCT',
      is_active: 'false',
      product_id: productId.toUpperCase(),
      parent_subject_id: ` ${parentId.toUpperCase()} `,
      sort: 'UPDATED_DESC',
      page: '2',
      page_size: '50',
      subject_id: subjectId.toUpperCase(),
      ignored: 'value',
    };
    const search = catalogSearchSchema.parse(raw);
    expect(search).toEqual({
      q: 'PS-123',
      subject_type: 'OWN_PRODUCT',
      is_active: false,
      product_id: productId,
      parent_subject_id: parentId,
      sort: 'UPDATED_DESC',
      page: 2,
      page_size: 50,
      subject_id: subjectId,
    });
    expect(catalogSearchToApiParams(search)).toEqual({
      q: 'PS-123',
      subject_type: 'OWN_PRODUCT',
      is_active: false,
      product_id: productId,
      parent_subject_id: parentId,
      sort: 'UPDATED_DESC',
      page: 2,
      page_size: 50,
    });
    expect(isCanonicalCatalogSearch(raw, search)).toBe(false);
    expect(isCanonicalCatalogSearch({ ...search, is_active: 'false', page: '2' }, search)).toBe(true);
  });

  it.each([true, 'true', false, 'false'])('布尔值 %s 不使用 truthy coercion', (value) => {
    const search = catalogSearchSchema.parse({ is_active: value });
    expect(search.is_active).toBe(value === true || value === 'true');
  });

  it('删除无效、未知或非标量参数，不把默认值写入 URL', () => {
    const search = catalogSearchSchema.parse({
      q: 'x'.repeat(241),
      subject_type: 'UNKNOWN',
      is_active: '0',
      product_id: 'not-a-uuid',
      parent_subject_id: {},
      subject_id: ['not-a-uuid'],
      sort: 'NAME_DESC',
      page: -1,
      page_size: 100,
      new: true,
      extra: 'unknown',
    });
    expect(search).toEqual({});
    expect(catalogSearchSchema.parse(null)).toEqual({});
    expect(catalogSearchSchema.parse({ q: ' \n ', page: true, page_size: [10] })).toEqual({});
    expect(catalogSearchSchema.parse({ page: Number.MAX_SAFE_INTEGER + 1 })).toEqual({});
    expect(isCanonicalCatalogSearch({ extra: 'unknown' }, search)).toBe(false);
    expect(isCanonicalCatalogSearch({ is_active: ['false'] }, { is_active: false })).toBe(false);
  });

  it('创建优先于详情，创建身份不进入列表请求', () => {
    const search = catalogSearchSchema.parse({ subject_id: subjectId, new: '1', q: '品牌' });
    expect(search).toEqual({ q: '品牌', new: 1 });
    expect(catalogEditorIdentity(search)).toBe('new');
    expect(catalogEditorIdentity({ subject_id: subjectId })).toBe(`subject:${subjectId}`);
    expect(catalogEditorIdentity({})).toBe('none');
    expect(catalogSearchToApiParams(search)).toEqual({
      q: '品牌', page: 1, page_size: 20, sort: 'NAME_ASC',
    });
    expect(isCanonicalCatalogSearch({ subject_id: subjectId, new: 1 }, search)).toBe(false);
  });

  it('仅路径或编辑身份变化阻断，同身份筛选/分页变化保留草稿', () => {
    const current = {
      pathname: '/configuration/geo-entities',
      search: { subject_id: subjectId, q: '旧搜索' },
    };
    expect(shouldBlockCatalogNavigation(current, {
      pathname: current.pathname,
      search: {
        subject_id: subjectId.toUpperCase(),
        q: '新搜索',
        subject_type: 'COMPETITOR_BRAND',
        is_active: false,
        page: 3,
        page_size: 10,
        sort: 'UPDATED_DESC',
      },
    })).toBe(false);
    for (const search of [{ subject_id: parentId }, { new: 1 }, {}]) {
      expect(shouldBlockCatalogNavigation(current, { pathname: current.pathname, search })).toBe(true);
    }
    expect(shouldBlockCatalogNavigation(current, { pathname: '/products', search: {} })).toBe(true);
    expect(shouldBlockCatalogNavigation(
      { pathname: current.pathname, search: { new: 1 } },
      { pathname: current.pathname, search: { new: '1', q: '新建筛选' } },
    )).toBe(false);
  });

});
