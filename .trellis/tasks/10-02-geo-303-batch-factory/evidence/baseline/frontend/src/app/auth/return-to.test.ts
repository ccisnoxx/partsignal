import { describe, expect, it } from 'vitest';

import { approvedReturnTo } from './return-to';

describe('approvedReturnTo', () => {
  it.each([
    '/',
    '/tasks?page=2#results',
    '/configuration/platforms?platform=00000000-0000-4000-8000-000000000001',
  ])('保留安全站内地址 %s', (href) => {
    expect(approvedReturnTo(href)).toBe(href);
  });

  it.each([
    undefined,
    '',
    'https://evil.example/path',
    '//evil.example/path',
    '/\\evil.example/path',
    '/%2f%2fevil.example/path',
    '/%252f%252fevil.example/path',
    '/%252525252f%252525252fevil.example/path',
    '/%5cevil.example/path',
    '/%E0%A4%A',
    '/javascript:alert(1)',
    '/data:text/html,boom',
    '/login',
    '/%6cogin?redirect=%2Ftasks',
    '/%256cogin?redirect=%252Ftasks',
  ])('拒绝不安全或循环地址 %#', (href) => {
    expect(approvedReturnTo(href)).toBe('/');
  });
});
