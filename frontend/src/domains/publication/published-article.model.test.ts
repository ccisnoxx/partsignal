import { describe, expect, it } from 'vitest';

import {
  canonicalPublishedArticleSearchRecord,
  isCanonicalPublishedArticleSearch,
  publishedArticleSearchSchema,
  publishedArticleSearchToApiParams,
  publishedArticleUrlDomain,
} from './published-article.model';

describe('Published Article model', () => {
  it('规范化 canonical URL 并映射服务端 search/sort/page', () => {
    const search = publishedArticleSearchSchema.parse({
      q: '  工程师社区  ',
      page: '2',
      pageSize: '50',
      sort: 'TITLE_ASC',
      unknown: 'remove-me',
    });
    expect(search).toEqual({ q: '工程师社区', page: 2, pageSize: 50, sort: 'TITLE_ASC' });
    expect(publishedArticleSearchToApiParams(search)).toEqual({
      page: 2,
      page_size: 50,
      search: '工程师社区',
      sort: 'TITLE_ASC',
    });
    expect(canonicalPublishedArticleSearchRecord(search)).toEqual({
      q: '工程师社区',
      page: 2,
      pageSize: 50,
      sort: 'TITLE_ASC',
    });
  });

  it('非法参数回到显式分页默认值，默认排序不写 URL', () => {
    const search = publishedArticleSearchSchema.parse({
      q: ' '.repeat(201),
      page: 0,
      pageSize: 99,
      sort: 'UNKNOWN',
    });
    expect(search).toEqual({ page: 1, pageSize: 20 });
    expect(publishedArticleSearchToApiParams(search).sort).toBe('VERIFIED_DESC');
    expect(isCanonicalPublishedArticleSearch({}, search)).toBe(false);
    expect(isCanonicalPublishedArticleSearch({ page: 1, pageSize: 20 }, search)).toBe(true);
  });

  it('只接受可解析的最终 URL domain', () => {
    expect(publishedArticleUrlDomain('https://community.example.invalid/a')).toBe('community.example.invalid');
    expect(() => publishedArticleUrlDomain('not-a-url')).toThrow('非法最终 URL');
  });
});
