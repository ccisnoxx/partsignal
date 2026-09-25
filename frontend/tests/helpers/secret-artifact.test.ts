import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserContext } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  expectSecretsAbsent,
  registerArtifactSecrets,
  scanRegisteredSecrets,
} from '../e2e/secret-artifact';
import { registerRealStackLoginSecrets } from '../e2e/real-stack-session';

let root = '';
let manifestPath = '';
let keyPath = '';

async function writeMarker(directory: string, status = 'passed') {
  await writeFile(
    path.join(directory, '.last-run.json'),
    JSON.stringify({ status, failedTests: [] }),
  );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'partsignal-secret-artifact-'));
  manifestPath = path.join(root, 'manifest.jsonl');
  keyPath = path.join(root, 'key');
  await writeFile(manifestPath, '', { mode: 0o600 });
  await writeFile(keyPath, randomBytes(32), { mode: 0o600 });
  process.env.PARTSIGNAL_E2E_SECRET_MANIFEST = manifestPath;
  process.env.PARTSIGNAL_E2E_SECRET_KEY_FILE = keyPath;
});

afterEach(async () => {
  delete process.env.PARTSIGNAL_E2E_SECRET_MANIFEST;
  delete process.env.PARTSIGNAL_E2E_SECRET_KEY_FILE;
  await rm(root, { force: true, recursive: true });
});

describe('真实栈敏感产物扫描', () => {
  it('单测试未生成产物目录时视为 clean', async () => {
    await expect(expectSecretsAbsent(
      path.join(root, 'missing-test-output'),
      ['secret-value'],
    )).resolves.toBeUndefined();
  });

  it('单测试产物目录中的敏感值仍会使检查失败', async () => {
    const artifacts = path.join(root, 'test-output');
    await mkdir(artifacts);
    await writeFile(path.join(artifacts, 'trace.txt'), 'contains secret-value');

    await expect(expectSecretsAbsent(artifacts, ['secret-value']))
      .rejects.toThrow('敏感值进入 Playwright 测试产物：trace.txt');
  });

  it('根目录缺失时 fail closed', async () => {
    await registerArtifactSecrets(['secret-value']);
    await expect(scanRegisteredSecrets(
      path.join(root, 'missing'),
      manifestPath,
      keyPath,
    )).rejects.toThrow('测试产物目录不存在');
  });

  it('根路径不是目录时 fail closed', async () => {
    await registerArtifactSecrets(['secret-value']);
    const artifactPath = path.join(root, 'artifact-file');
    await writeFile(artifactPath, 'not-a-directory');
    await expect(scanRegisteredSecrets(artifactPath, manifestPath, keyPath))
      .rejects.toThrow('测试产物路径不是目录');
  });

  it('空目录与缺少本轮 marker 都 fail closed', async () => {
    await registerArtifactSecrets(['secret-value']);
    const empty = path.join(root, 'empty');
    const withoutMarker = path.join(root, 'without-marker');
    await mkdir(empty);
    await mkdir(withoutMarker);
    await writeFile(path.join(withoutMarker, 'artifact.txt'), 'safe');

    await expect(scanRegisteredSecrets(empty, manifestPath, keyPath))
      .rejects.toThrow('测试产物目录为空');
    await expect(scanRegisteredSecrets(withoutMarker, manifestPath, keyPath))
      .rejects.toThrow('缺少本轮 .last-run.json');
  });

  it('只接受 Playwright 当前 .last-run.json 的真实格式', async () => {
    await registerArtifactSecrets(['secret-value']);
    const artifacts = path.join(root, 'artifacts');
    await mkdir(artifacts);
    await writeFile(path.join(artifacts, '.last-run.json'), JSON.stringify({ status: 'passed' }));

    await expect(scanRegisteredSecrets(artifacts, manifestPath, keyPath))
      .rejects.toThrow('.last-run.json 格式无效');
  });

  it('登录成功后立即失败仍已登记 session/CSRF，最终扫描能命中泄露', async () => {
    const artifacts = path.join(root, 'artifacts');
    await mkdir(artifacts);
    await writeMarker(artifacts, 'failed');
    const sessionSecret = 'session-after-login';
    const csrfSecret = 'csrf-after-login';
    const context = {
      cookies: async () => [
        { name: 'partsignal_session', value: sessionSecret },
        { name: 'partsignal_csrf', value: csrfSecret },
      ],
    } as unknown as BrowserContext;

    await registerRealStackLoginSecrets(context, 'http://127.0.0.1:8000', csrfSecret);
    await writeFile(path.join(artifacts, 'error-context.txt'), `failure ${sessionSecret}`);

    await expect(scanRegisteredSecrets(artifacts, manifestPath, keyPath))
      .rejects.toThrow('敏感值进入 Playwright 测试产物：error-context.txt');
  });

  it('递归扫描中的嵌套读取失败会向上传播', async () => {
    const artifacts = path.join(root, 'artifacts');
    const nested = path.join(artifacts, 'nested');
    await mkdir(path.join(nested, 'directory-target'), { recursive: true });
    await symlink('directory-target', path.join(nested, 'directory-link'));
    await writeMarker(artifacts);
    await registerArtifactSecrets(['secret-value']);

    await expect(scanRegisteredSecrets(artifacts, manifestPath, keyPath))
      .rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('seed 登记以 NUL stdin 保留换行、忽略空帧且不回显明文', async () => {
    const secret = 'seed-with-newline\nsecond-line';
    const script = path.resolve('tests/e2e/secret-artifact.ts');
    const child = spawn(process.execPath, [
      '--experimental-strip-types',
      script,
      'register-seed',
    ], {
      env: {
        ...process.env,
        PARTSIGNAL_E2E_SECRET_MANIFEST: manifestPath,
        PARTSIGNAL_E2E_SECRET_KEY_FILE: keyPath,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdin.end(Buffer.concat([Buffer.from([0]), Buffer.from(secret), Buffer.from([0])]));
    const [code] = await once(child, 'close') as [number];
    const output = Buffer.concat([...stdout, ...stderr]).toString('utf8');

    expect(code).toBe(0);
    expect(child.spawnargs.join('\n')).not.toContain(secret);
    expect(output).toBe('E2E_SECRET_REGISTRATION status=ready\n');
    expect(output).not.toContain(secret);
    expect((await readFile(manifestPath, 'utf8')).trim().split('\n')).toHaveLength(1);

    const artifacts = path.join(root, 'artifacts');
    await mkdir(artifacts);
    await writeMarker(artifacts);
    await writeFile(path.join(artifacts, 'late.txt'), secret);
    await expect(scanRegisteredSecrets(artifacts, manifestPath, keyPath))
      .rejects.toThrow('敏感值进入 Playwright 测试产物：late.txt');
  });

  it('AES-GCM 清单不写入明文且 clean artifact 通过', async () => {
    const secret = 'registered-plaintext-secret';
    const artifacts = path.join(root, 'artifacts');
    await mkdir(artifacts);
    await writeMarker(artifacts);
    await writeFile(path.join(artifacts, 'safe.txt'), 'safe artifact');
    await registerArtifactSecrets([secret]);

    expect(await readFile(manifestPath, 'utf8')).not.toContain(secret);
    await expect(scanRegisteredSecrets(artifacts, manifestPath, keyPath)).resolves.toBeUndefined();
  });
});
