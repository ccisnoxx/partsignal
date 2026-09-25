import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const fixtureSecretLabels = {
  aiChannelCreateApiKey: 'ai-channel-create-api-key',
  aiChannelReplacementApiKey: 'ai-channel-replacement-api-key',
  aiChannelSecretHeader: 'ai-channel-secret-header',
  authCsrf: 'auth-csrf',
  authFirstNewPassword: 'auth-first-new-password',
  authInitialPassword: 'auth-initial-password',
  authSecondNewPassword: 'auth-second-new-password',
  legacyCsrf: 'legacy-csrf',
  legacyLoginPassword: 'legacy-login-password',
  postRunLeak: 'post-run-leak',
  usersCreatePassword: 'users-create-password',
  usersResetPassword: 'users-reset-password',
} as const;

function loadFixtureSecretKey(): Buffer {
  const keyPath = process.env.PARTSIGNAL_E2E_SECRET_KEY_FILE;
  if (!keyPath) {
    throw new Error('缺少 PARTSIGNAL_E2E_SECRET_KEY_FILE，fixture Playwright 必须通过敏感产物扫描入口运行');
  }
  const key = readFileSync(keyPath);
  if (key.byteLength !== 32) throw new Error('fixture Playwright 敏感值派生密钥长度无效');
  return key;
}

const fixtureSecretKey = loadFixtureSecretKey();

function deriveFixtureSecret(label: string): string {
  const digest = createHmac('sha256', fixtureSecretKey)
    .update(`partsignal-fixture-secret:v1:${label}`)
    .digest('base64url');
  return `Aa1!${digest.slice(0, 28)}`;
}

const fixtureArtifactSecrets = Object.freeze(Object.fromEntries(
  Object.entries(fixtureSecretLabels).map(([name, label]) => [name, deriveFixtureSecret(label)]),
) as { [Name in keyof typeof fixtureSecretLabels]: string });

const allFixtureArtifactSecrets = Object.freeze(Object.values(fixtureArtifactSecrets));

export { allFixtureArtifactSecrets, fixtureArtifactSecrets };
