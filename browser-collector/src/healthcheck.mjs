try {
  const response = await fetch('http://127.0.0.1:8090/health', {
    signal: AbortSignal.timeout(4000),
  });
  const health = await response.json();
  if (!response.ok || health.status !== 'ok' || typeof health.browser_runtime !== 'string') {
    throw new Error('BROWSER_RUNTIME_UNAVAILABLE');
  }
} catch {
  console.error('BROWSER_RUNTIME_UNAVAILABLE');
  process.exitCode = 1;
}
