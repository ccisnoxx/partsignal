import { registerArtifactSecrets } from './secret-artifact';

export default async function registerFixtureArtifactSecrets() {
  if (process.env.PARTSIGNAL_E2E_REAL_STACK === '1') return;
  const { allFixtureArtifactSecrets } = await import('./fixture-secrets');
  await registerArtifactSecrets(allFixtureArtifactSecrets);
}
