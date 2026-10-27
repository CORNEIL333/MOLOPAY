export const STATIC_ASSET_PATHS = ['/offline.html', '/offline.css', '/icon.svg', '/manifest.webmanifest'] as const;
export const STATIC_ASSET_PREFIXES = ['/_next/static/'] as const;
export const OFFLINE_PATH = '/offline.html';

export function isStaticAsset(pathname: string): boolean {
  return (STATIC_ASSET_PATHS as readonly string[]).includes(pathname) || STATIC_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function cacheStrategy(method: string, mode: string, pathname: string): 'network-only' | 'cache-first' | 'bypass' {
  if (method !== 'GET') return 'bypass';
  if (mode === 'navigate') return 'network-only';
  return isStaticAsset(pathname) ? 'cache-first' : 'bypass';
}
