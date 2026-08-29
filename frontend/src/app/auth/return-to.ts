const RETURN_TO_ORIGIN = 'https://partsignal.invalid';
const MAX_DECODE_PASSES = 4;

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

function approvedReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';

  let decoded = value;
  let stable = false;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    if (/\\|%2f|%5c/i.test(decoded)) return '/';
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return '/';
    }
    if (next === decoded) {
      stable = true;
      break;
    }
    decoded = next;
  }

  if (!stable) return '/';

  if (!decoded.startsWith('/') || decoded.startsWith('//') || hasControlCharacter(decoded)) {
    return '/';
  }
  if (/^\/(?:javascript|data):/i.test(decoded)) return '/';

  try {
    const url = new URL(value, RETURN_TO_ORIGIN);
    if (url.origin !== RETURN_TO_ORIGIN || url.username || url.password) return '/';
    const pathname = new URL(decoded, RETURN_TO_ORIGIN).pathname.toLowerCase();
    if (pathname === '/login' || pathname === '/login/') return '/';
    return value;
  } catch {
    return '/';
  }
}

export { approvedReturnTo };
