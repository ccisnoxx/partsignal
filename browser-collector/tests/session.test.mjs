import assert from 'node:assert/strict';
import {
  constants, createCipheriv, generateKeyPairSync, publicEncrypt, randomBytes,
} from 'node:crypto';
import {
  chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { decryptSessionEnvelope, withAuthorizedSession } from '../src/session.mjs';

const reference = '8f50626b-9219-4650-84cd-32749bc99c1d';
const profileId = '73a2a9ce-846c-4915-96b2-c6f580b33e57';
const canary = '仅限虚构测试-cookie-localStorage-秘密标记';
const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
const pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const otherPair = generateKeyPairSync('rsa', { modulusLength: 3072 });
const wrongPem = otherPair.privateKey.export({ type: 'pkcs8', format: 'pem' });

function state() {
  return {
    cookies: [{
      name: 'test-session', value: canary, domain: 'chat.example.invalid', path: '/',
      expires: -1, httpOnly: true, secure: true, sameSite: 'Lax',
    }],
    origins: [{ origin: 'https://chat.example.invalid', localStorage: [{ name: 'test', value: canary }] }],
  };
}

function fixture({ expires = Date.now() + 60 * 60 * 1000, storage = state() } = {}) {
  const expiresAt = new Date(expires).toISOString().replace('Z', '000+00:00');
  const expected = { reference, profileId, expiresAt };
  const aad = `partsignal:geo-browser-session:v1:${reference}:${profileId}:${expiresAt}`;
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(storage)), cipher.final(), cipher.getAuthTag()]);
  const wrapped = publicEncrypt({
    key: pair.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256',
  }, key);
  key.fill(0);
  return {
    expected,
    envelope: JSON.stringify({
      version: 1, algorithm: 'RSA-OAEP-SHA256+A256GCM', reference, profile_id: profileId,
      expires_at: expiresAt, aad, wrapped_key: wrapped.toString('base64'),
      nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'),
    }),
  };
}

function failure(code) {
  return (error) => {
    assert.equal(error.code, code);
    assert.equal(error.cause, undefined);
    assert.ok(!`${error}\n${error.stack}\n${JSON.stringify(error)}`.includes(canary));
    assert.ok(!error.message.includes('-----BEGIN'));
    return true;
  };
}

test('RSA-OAEP SHA256/AES-GCM 封装在内存恢复相同 storage state', () => {
  const input = fixture();
  assert.deepEqual(decryptSessionEnvelope(input.envelope, pem, input.expected), state());
  assert.ok(!input.envelope.includes(canary));
});

test('错误私钥和跨 reference/profile/expiry 绑定全部拒绝', () => {
  const input = fixture();
  assert.throws(() => decryptSessionEnvelope(input.envelope, wrongPem, input.expected), failure('GEO_BROWSER_SESSION_UNREADABLE'));
  for (const expected of [
    { ...input.expected, reference: profileId },
    { ...input.expected, profileId: reference },
    { ...input.expected, expiresAt: new Date().toISOString() },
    { ...input.expected, secret: canary },
  ]) {
    assert.throws(() => decryptSessionEnvelope(input.envelope, pem, expected), failure('GEO_BROWSER_SESSION_UNREADABLE'));
  }
});

test('nonce/wrapped key/ciphertext/tag/AAD 篡改均无法恢复', () => {
  const input = fixture();
  for (const field of ['nonce', 'wrapped_key', 'ciphertext']) {
    const envelope = JSON.parse(input.envelope);
    const bytes = Buffer.from(envelope[field], 'base64');
    bytes[0] ^= 1;
    envelope[field] = bytes.toString('base64');
    assert.throws(() => decryptSessionEnvelope(JSON.stringify(envelope), pem, input.expected), failure('GEO_BROWSER_SESSION_UNREADABLE'));
  }
  const envelope = JSON.parse(input.envelope);
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  ciphertext[ciphertext.length - 1] ^= 1;
  envelope.ciphertext = ciphertext.toString('base64');
  assert.throws(() => decryptSessionEnvelope(JSON.stringify(envelope), pem, input.expected), failure('GEO_BROWSER_SESSION_UNREADABLE'));
  envelope.aad += canary;
  assert.throws(() => decryptSessionEnvelope(JSON.stringify(envelope), pem, input.expected), failure('GEO_BROWSER_SESSION_UNREADABLE'));
});

test('算法、封装闭合、重复 JSON 键和非标准 Base64 被拒绝', () => {
  const input = fixture();
  for (const change of [
    { version: 2 }, { version: true }, { algorithm: 'RSA-PKCS1' }, { secret: canary },
    { nonce: 'AA' }, { nonce: `${JSON.parse(input.envelope).nonce}\n` }, { ciphertext: '***' },
    { wrapped_key: 'A'.repeat(512 * 1024) },
  ]) {
    const envelope = JSON.stringify({ ...JSON.parse(input.envelope), ...change });
    assert.throws(() => decryptSessionEnvelope(envelope, pem, input.expected), failure('GEO_BROWSER_SESSION_UNREADABLE'));
  }
  const duplicated = input.envelope.replace('"version":1', '"version":2,"version":1');
  assert.throws(() => decryptSessionEnvelope(duplicated, pem, input.expected), failure('GEO_BROWSER_SESSION_UNREADABLE'));
  assert.throws(() => decryptSessionEnvelope(`{"secret":"${canary}",`, pem, input.expected), failure('GEO_BROWSER_SESSION_UNREADABLE'));
});

test('过期材料、非法日期和过期 Cookie 不进入 consumer', () => {
  const expired = fixture({ expires: Date.now() - 1000 });
  assert.throws(() => decryptSessionEnvelope(expired.envelope, pem, expired.expected), failure('GEO_BROWSER_SESSION_EXPIRED'));
  const valid = fixture();
  for (const expiresAt of ['2026-02-30T00:00:00.000000+00:00', '2026-10-05T00:00:00Z', 'secret-canary']) {
    const envelope = { ...JSON.parse(valid.envelope), expires_at: expiresAt };
    assert.throws(() => decryptSessionEnvelope(JSON.stringify(envelope), pem, { ...valid.expected, expiresAt }), failure('GEO_BROWSER_SESSION_UNREADABLE'));
  }
  const storage = state();
  storage.cookies[0].expires = (Date.now() - 1000) / 1000;
  const badCookie = fixture({ storage });
  assert.throws(() => decryptSessionEnvelope(badCookie.envelope, pem, badCookie.expected), failure('GEO_BROWSER_SESSION_UNREADABLE'));
});

test('恢复资料仍检查 storage state 的结构与秘密错误边界', () => {
  for (const storage of [null, {}, { cookies: [], origins: [] }, { ...state(), secret: canary }]) {
    const input = fixture({ storage });
    assert.throws(() => decryptSessionEnvelope(input.envelope, pem, input.expected), failure('GEO_BROWSER_SESSION_UNREADABLE'));
  }
});

test('每次消费重新授权；撤销拒绝先于读取私钥，保留的资料在 finally 清空', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'geo802-session-')));
  const keyFile = join(directory, 'private.pem');
  writeFileSync(keyFile, pem, { mode: 0o600 });
  const input = fixture();
  let revoked = false;
  let calls = 0;
  let consumers = 0;
  let retained;
  const authorize = async () => {
    calls += 1;
    if (revoked) throw new Error(canary);
    return input.envelope;
  };
  const consumer = async (storage) => {
    consumers += 1;
    retained = storage;
    assert.deepEqual(storage, state());
    return '完成';
  };
  try {
    assert.equal(await withAuthorizedSession({ authorize, privateKeyFile: keyFile, expected: input.expected, consumer }), '完成');
    assert.deepEqual(retained, { cookies: [], origins: [] });
    revoked = true;
    rmSync(keyFile);
    await assert.rejects(withAuthorizedSession({ authorize, privateKeyFile: keyFile, expected: input.expected, consumer }), failure('GEO_BROWSER_SESSION_ACCESS_DENIED'));
    assert.equal(calls, 2);
    assert.equal(consumers, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('consumer 失败也清空引用且摘要不泄露秘密', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'geo802-session-')));
  const keyFile = join(directory, 'private.pem');
  writeFileSync(keyFile, pem, { mode: 0o400 });
  const input = fixture();
  let retained;
  try {
    await assert.rejects(withAuthorizedSession({
      authorize: async () => input.envelope, privateKeyFile: keyFile, expected: input.expected,
      consumer: async (storage) => { retained = storage; throw new Error(canary); },
    }), failure('GEO_BROWSER_SESSION_CONSUMPTION_FAILED'));
    assert.deepEqual(retained, { cookies: [], origins: [] });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('私钥权限、缺失、目录和任意层 symlink 均拒绝', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'geo802-session-')));
  const keyFile = join(directory, 'private.pem');
  const input = fixture();
  let consumed = false;
  const attempt = (privateKeyFile) => withAuthorizedSession({
    authorize: async () => input.envelope, privateKeyFile, expected: input.expected,
    consumer: async () => { consumed = true; },
  });
  try {
    await assert.rejects(attempt(keyFile), failure('DEPENDENCY_UNAVAILABLE'));
    await assert.rejects(attempt(directory), failure('DEPENDENCY_UNAVAILABLE'));
    await assert.rejects(attempt('private.pem'), failure('DEPENDENCY_UNAVAILABLE'));
    writeFileSync(keyFile, pem, { mode: 0o644 });
    await assert.rejects(attempt(keyFile), failure('DEPENDENCY_UNAVAILABLE'));
    chmodSync(keyFile, 0o600);
    const link = join(directory, 'private-link.pem');
    symlinkSync(keyFile, link);
    await assert.rejects(attempt(link), failure('DEPENDENCY_UNAVAILABLE'));
    const parentLink = join(directory, 'parent-link');
    symlinkSync(directory, parentLink, 'dir');
    await assert.rejects(attempt(join(parentLink, 'private.pem')), failure('DEPENDENCY_UNAVAILABLE'));
    writeFileSync(keyFile, canary.repeat(16 * 1024));
    await assert.rejects(attempt(keyFile), failure('DEPENDENCY_UNAVAILABLE'));
    assert.equal(consumed, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('授权返回损坏材料时不调用 consumer 且错误不带异常正文', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'geo802-session-')));
  const keyFile = join(directory, 'private.pem');
  writeFileSync(keyFile, pem, { mode: 0o600 });
  const input = fixture();
  let consumed = false;
  try {
    await assert.rejects(withAuthorizedSession({
      authorize: async () => canary, privateKeyFile: keyFile, expected: input.expected,
      consumer: async () => { consumed = true; },
    }), failure('GEO_BROWSER_SESSION_UNREADABLE'));
    assert.equal(consumed, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
