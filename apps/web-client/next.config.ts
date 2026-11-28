import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@achat/ui', '@achat/contracts'],
  headers() {
    return Promise.resolve([
      { source: '/:path*', headers: securityHeaders },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'" }] },
      { source: '/offline.html', headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" }] },
    ]);
  },
  rewrites() {
    const apiUrl = process.env['API_INTERNAL_URL'] ?? 'http://127.0.0.1:3000';
    return Promise.resolve([{ source: '/v1/:path*', destination: `${apiUrl}/v1/:path*` }]);
  },
};

export default nextConfig;
