import {
  appendFile,
  readdir,
  readFile,
  stat,
} from 'node:fs/promises';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  tag: string;
  version: 1;
};

type PlaywrightLastRun = {
  status: 'passed' | 'failed' | 'timedout' | 'interrupted';
  failedTests: string[];
};

function scannerError(message: string, cause: unknown) {
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  }));
  return nested.flat();
}

async function assertCurrentPlaywrightArtifacts(directory: string): Promise<PlaywrightLastRun> {
  let root;
  try {
    root = await stat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw scannerError('Playwright 测试产物目录不存在，拒绝绕过敏感值扫描', error);
    }
    throw error;
  }
  if (!root.isDirectory()) {
    throw new Error('Playwright 测试产物路径不是目录，拒绝绕过敏感值扫描');
  }

  const entries = await readdir(directory);
  if (entries.length === 0) {
    throw new Error('Playwright 测试产物目录为空，拒绝绕过敏感值扫描');
  }

  const markerPath = path.join(directory, '.last-run.json');
  let markerStat;
  try {
    markerStat = await stat(markerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw scannerError('Playwright 测试产物缺少本轮 .last-run.json，拒绝扫描旧产物', error);
    }
    throw error;
  }
  if (!markerStat.isFile()) {
    throw new Error('Playwright .last-run.json 不是普通文件，拒绝扫描旧产物');
  }

  let marker: unknown;
  try {
    marker = JSON.parse(await readFile(markerPath, 'utf8'));
  } catch {
    throw new Error('Playwright .last-run.json 不是有效 JSON，拒绝扫描旧产物');
  }
  if (
    !marker
    || typeof marker !== 'object'
    || !('status' in marker)
    || !['passed', 'failed', 'timedout', 'interrupted'].includes(String(marker.status))
    || !('failedTests' in marker)
    || !Array.isArray(marker.failedTests)
    || !marker.failedTests.every((item) => typeof item === 'string')
  ) {
    throw new Error('Playwright .last-run.json 格式无效，拒绝扫描旧产物');
  }
  return marker as PlaywrightLastRun;
}

async function assertSecretsAbsent(directory: string, secrets: readonly string[]): Promise<void> {
  for (const file of await listFiles(directory)) {
    const content = await readFile(file);
    if (secrets.some((secret) => content.includes(Buffer.from(secret)))) {
      throw new Error(`敏感值进入 Playwright 测试产物：${path.relative(directory, file)}`);
    }
  }
}

async function expectSecretsAbsent(directory: string, secrets: readonly string[]): Promise<void> {
  try {
    await stat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await assertSecretsAbsent(directory, secrets);
}

async function assertPrivateFile(filePath: string, label: string): Promise<void> {
  const file = await stat(filePath);
  if (!file.isFile()) throw new Error(`${label}不是普通文件`);
  if ((file.mode & 0o777) !== 0o600) throw new Error(`${label}权限必须为 0600`);
}

function requiredPath(name: 'PARTSIGNAL_E2E_SECRET_KEY_FILE' | 'PARTSIGNAL_E2E_SECRET_MANIFEST') {
  const value = process.env[name];
  if (!value) throw new Error(`缺少 ${name}，无法完成真实栈敏感产物检查`);
  return value;
}

async function registerArtifactSecrets(secrets: readonly string[]): Promise<void> {
  const manifestPath = requiredPath('PARTSIGNAL_E2E_SECRET_MANIFEST');
  const keyPath = requiredPath('PARTSIGNAL_E2E_SECRET_KEY_FILE');
  await assertPrivateFile(manifestPath, '真实栈敏感产物检查清单');
  await assertPrivateFile(keyPath, '真实栈敏感产物检查密钥');
  const key = await readFile(keyPath);
  if (key.byteLength !== 32) throw new Error('真实栈敏感产物检查密钥长度无效');

  const records = Array.from(new Set(secrets.filter((secret) => secret.length > 0))).map((secret) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const record: EncryptedSecret = {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      version: 1,
    };
    return JSON.stringify(record);
  });
  if (records.length > 0) await appendFile(manifestPath, `${records.join('\n')}\n`, { mode: 0o600 });
}

async function readRegisteredSecrets(manifestPath: string, keyPath: string): Promise<string[]> {
  await assertPrivateFile(manifestPath, '真实栈敏感产物检查清单');
  await assertPrivateFile(keyPath, '真实栈敏感产物检查密钥');
  const key = await readFile(keyPath);
  if (key.byteLength !== 32) throw new Error('真实栈敏感产物检查密钥长度无效');
  const manifest = await readFile(manifestPath, 'utf8');
  const secrets = manifest.split('\n').filter(Boolean).map((line) => {
    const record = JSON.parse(line) as EncryptedSecret;
    if (record.version !== 1) throw new Error('真实栈敏感产物检查清单版本无效');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  });
  return Array.from(new Set(secrets));
}

async function readSeedSecretsFromStdin(): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const payload = Buffer.concat(chunks);
  if (payload.byteLength === 0 || payload.at(-1) !== 0) {
    throw new Error('真实栈 seed 敏感值输入必须使用 NUL 结尾帧');
  }
  const secrets = payload.subarray(0, -1).toString('utf8').split('\0');
  if (secrets.length !== 2) throw new Error('真实栈 seed 敏感值输入必须包含两个帧');
  return secrets;
}

async function scanRegisteredSecrets(
  directory: string,
  manifestPath: string,
  keyPath: string,
): Promise<void> {
  await assertCurrentPlaywrightArtifacts(directory);
  const secrets = await readRegisteredSecrets(manifestPath, keyPath);
  if (secrets.length === 0) throw new Error('真实栈未登记任何敏感值，拒绝绕过产物检查');
  await assertSecretsAbsent(directory, secrets);
}

async function runCli() {
  const [, , command, directory, manifestPath, keyPath] = process.argv;
  if (command === 'register-seed') {
    await registerArtifactSecrets(await readSeedSecretsFromStdin());
    process.stdout.write('E2E_SECRET_REGISTRATION status=ready\n');
    return;
  }
  if (command !== 'scan' || !directory || !manifestPath || !keyPath) {
    throw new Error('用法：secret-artifact.ts register-seed | scan <artifact-directory> <manifest> <key>');
  }
  await scanRegisteredSecrets(directory, manifestPath, keyPath);
  process.stdout.write('E2E_SECRET_SCAN status=clean\n');
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : '真实栈敏感产物检查失败'}\n`);
    process.exitCode = 1;
  });
}

export {
  assertCurrentPlaywrightArtifacts,
  expectSecretsAbsent,
  registerArtifactSecrets,
  scanRegisteredSecrets,
};
