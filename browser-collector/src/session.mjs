import {
  constants as cryptoConstants, createDecipheriv, createPrivateKey, privateDecrypt,
} from 'node:crypto';
import { closeSync, constants as fsConstants, fstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute, join, parse } from 'node:path';

const maxEnvelopeBytes = 256 * 1024;
const maxStateBytes = 128 * 1024;
const envelopeFields = [
  'version', 'algorithm', 'reference', 'profile_id', 'expires_at', 'aad',
  'wrapped_key', 'nonce', 'ciphertext',
];
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/** @typedef {{reference: string, profileId: string, expiresAt: string}} SessionBinding */
/** @typedef {import('playwright').BrowserContextOptions['storageState'] & object} StorageState */

/** @param {string} code */
function failure(code = 'GEO_BROWSER_SESSION_UNREADABLE') {
  const messages = /** @type {Record<string, string>} */ ({
    GEO_BROWSER_SESSION_UNREADABLE: '浏览器会话密文无法解密',
    GEO_BROWSER_SESSION_EXPIRED: '浏览器会话已过期',
    DEPENDENCY_UNAVAILABLE: '浏览器会话私钥不可用',
    GEO_BROWSER_SESSION_ACCESS_DENIED: '浏览器会话访问未获授权',
    GEO_BROWSER_SESSION_CONSUMPTION_FAILED: '浏览器会话消费失败',
  });
  return Object.assign(new Error(messages[code]), { code });
}

/**
 * JSON.parse 确认语法后扫描对象键，避免重复键被解析器静默覆盖。
 * @param {string} source
 * @returns {any}
 */
function parseClosedJson(source) {
  const value = JSON.parse(source);
  /** @type {{object: boolean, keys: Set<string>, key: boolean}[]} */
  const stack = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      const start = index;
      for (index += 1; index < source.length; index += 1) {
        if (source[index] === '\\') index += 1;
        else if (source[index] === '"') break;
      }
      const current = stack.at(-1);
      if (current?.object && current.key) {
        const key = JSON.parse(source.slice(start, index + 1));
        if (current.keys.has(key)) throw failure();
        current.keys.add(key);
        current.key = false;
      }
    } else if (character === '{' || character === '[') {
      stack.push({ object: character === '{', keys: new Set(), key: character === '{' });
    } else if (character === '}' || character === ']') {
      stack.pop();
    } else if (character === ',') {
      const current = stack.at(-1);
      if (current?.object) current.key = true;
    }
  }
  return value;
}

/** @param {unknown} value @param {string[]} fields */
function closedObject(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field));
}

/** @param {unknown} value */
function decodeBase64(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw failure();
  }
  const buffer = Buffer.from(value, 'base64');
  if (buffer.toString('base64') !== value) throw failure();
  return buffer;
}

/** @param {any} state @param {number} expiresAt @returns {asserts state is StorageState} */
function validateState(state, expiresAt) {
  if (!closedObject(state, ['cookies', 'origins']) || !Array.isArray(state.cookies)
      || !Array.isArray(state.origins)) throw failure();
  let count = state.cookies.length;
  for (const cookie of state.cookies) {
    if (!closedObject(cookie, ['name', 'value', 'domain', 'path', 'expires', 'httpOnly', 'secure', 'sameSite'])
        || !['name', 'value', 'domain', 'path'].every((field) => typeof cookie[field] === 'string')
        || typeof cookie.httpOnly !== 'boolean' || typeof cookie.secure !== 'boolean'
        || !Number.isFinite(cookie.expires) || (cookie.expires !== -1 && cookie.expires * 1000 < expiresAt)
        || !['Strict', 'Lax', 'None'].includes(cookie.sameSite)) {
      throw failure();
    }
  }
  for (const origin of state.origins) {
    if (!closedObject(origin, ['origin', 'localStorage']) || typeof origin.origin !== 'string'
        || !Array.isArray(origin.localStorage)) throw failure();
    for (const item of origin.localStorage) {
      if (!closedObject(item, ['name', 'value']) || typeof item.name !== 'string'
          || typeof item.value !== 'string') throw failure();
    }
    count += origin.localStorage.length;
  }
  if (!count) throw failure();
}

/**
 * @param {string} envelope
 * @param {string | Buffer} privateKeyPem
 * @param {SessionBinding} expected
 * @returns {StorageState}
 */
function decrypt(envelope, privateKeyPem, expected) {
  /** @type {Buffer[]} */
  const buffers = [];
  try {
    if (typeof envelope !== 'string' || Buffer.byteLength(envelope, 'utf8') > maxEnvelopeBytes
        || !closedObject(expected, ['reference', 'profileId', 'expiresAt'])
        || !uuid.test(expected.reference) || !uuid.test(expected.profileId)) throw failure();
    const parsed = parseClosedJson(envelope);
    if (!closedObject(parsed, envelopeFields) || parsed.version !== 1
        || parsed.algorithm !== 'RSA-OAEP-SHA256+A256GCM'
        || !envelopeFields.filter((field) => field !== 'version').every((field) => typeof parsed[field] === 'string')
        || parsed.reference !== expected.reference || parsed.profile_id !== expected.profileId
        || parsed.expires_at !== expected.expiresAt
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/.test(parsed.expires_at)) throw failure();
    const expires = Date.parse(parsed.expires_at);
    if (!Number.isFinite(expires)
        || new Date(expires).toISOString().slice(0, 23) !== parsed.expires_at.slice(0, 23)) throw failure();
    if (expires <= Date.now()) throw failure('GEO_BROWSER_SESSION_EXPIRED');
    const aad = `partsignal:geo-browser-session:v1:${expected.reference}:${expected.profileId}:${expected.expiresAt}`;
    if (parsed.aad !== aad) throw failure();
    const wrapped = decodeBase64(parsed.wrapped_key);
    const nonce = decodeBase64(parsed.nonce);
    const ciphertext = decodeBase64(parsed.ciphertext);
    buffers.push(wrapped, nonce, ciphertext);
    const privateKey = createPrivateKey(privateKeyPem);
    const bits = privateKey.asymmetricKeyDetails?.modulusLength;
    if (privateKey.asymmetricKeyType !== 'rsa' || !bits || bits < 3072
        || wrapped.length !== Math.ceil(bits / 8) || nonce.length !== 12
        || ciphertext.length <= 16 || ciphertext.length > maxStateBytes + 16) throw failure();
    const key = privateDecrypt({
      key: privateKey, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256',
    }, wrapped);
    buffers.push(key);
    if (key.length !== 32) throw failure();
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(ciphertext.subarray(-16));
    const partial = decipher.update(ciphertext.subarray(0, -16));
    buffers.push(partial);
    const final = decipher.final();
    buffers.push(final);
    const plaintext = Buffer.concat([partial, final]);
    buffers.push(plaintext);
    const state = parseClosedJson(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
    validateState(state, expires);
    return state;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'GEO_BROWSER_SESSION_EXPIRED') {
      throw failure('GEO_BROWSER_SESSION_EXPIRED');
    }
    // crypto/JSON 异常可能含私钥、Cookie 或明文；只保留固定失败摘要。
    throw failure();
  } finally {
    for (const buffer of buffers) buffer.fill(0);
  }
}

/**
 * 只解密已获授权的封装；返回对象的生命周期由直接调用方负责。
 * @param {string} envelope
 * @param {string} privateKeyPem
 * @param {SessionBinding} expected
 * @returns {StorageState}
 */
export function decryptSessionEnvelope(envelope, privateKeyPem, expected) {
  return decrypt(envelope, privateKeyPem, expected);
}

/** @param {string} filename */
function readPrivateKey(filename) {
  /** @type {number[]} */
  const descriptors = [];
  const buffer = Buffer.alloc(16 * 1024 + 1);
  try {
    if (!isAbsolute(filename) || filename.split('/').includes('..')) throw failure();
    const path = parse(filename);
    const parts = path.dir.split('/').filter(Boolean);
    let directory = path.root;
    // 逐级检查配置目录；最终私钥对象另外使用 nofollow 打开。
    for (const part of parts) {
      directory = join(directory, part);
      descriptors.push(openSync(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW));
    }
    const descriptor = openSync(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
    descriptors.push(descriptor);
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0
        || (metadata.mode & 0o400) === 0 || metadata.size === 0 || metadata.size > 16 * 1024) throw failure();
    let length = 0;
    while (length < buffer.length) {
      const received = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (!received) break;
      length += received;
    }
    if (length !== metadata.size) throw failure();
    return buffer.subarray(0, length);
  } catch {
    buffer.fill(0);
    throw failure('DEPENDENCY_UNAVAILABLE');
  } finally {
    for (const descriptor of descriptors.reverse()) closeSync(descriptor);
  }
}

/** @param {StorageState} state */
function clearState(state) {
  if ('cookies' in state) {
    for (const cookie of state.cookies) { cookie.name = ''; cookie.value = ''; }
    state.cookies.length = 0;
  }
  if ('origins' in state) {
    for (const origin of state.origins) {
      for (const item of origin.localStorage) { item.name = ''; item.value = ''; }
      origin.localStorage.length = 0;
    }
    state.origins.length = 0;
  }
}

/**
 * 每次消费均先重新授权，不缓存密文/明文或直接读取专用卷。
 * consumer 必须自行关闭临时 BrowserContext；JavaScript 字符串无法可靠覆写。
 * @template T
 * @param {{authorize: () => Promise<string>, privateKeyFile: string, expected: SessionBinding,
 * consumer: (state: StorageState) => Promise<T>}} options
 * @returns {Promise<T>}
 */
export async function withAuthorizedSession({ authorize, privateKeyFile, expected, consumer }) {
  let envelope;
  try { envelope = await authorize(); }
  catch { throw failure('GEO_BROWSER_SESSION_ACCESS_DENIED'); }
  const privateKey = readPrivateKey(privateKeyFile);
  let state;
  try {
    state = decrypt(envelope, privateKey, expected);
    try { return await consumer(state); }
    catch { throw failure('GEO_BROWSER_SESSION_CONSUMPTION_FAILED'); }
  } finally {
    privateKey.fill(0);
    if (state) clearState(state);
  }
}
