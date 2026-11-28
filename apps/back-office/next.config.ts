import type { NextConfig } from 'next';

/**
 * Back-office (D62, ADR-0007 proposé) : application séparée du client, à
 * servir sur un réseau isolé. Politique de sécurité stricte : aucun cadre,
 * aucune ressource tierce, connexions vers la même origine uniquement.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), publickey-credentials-get=(self), publickey-credentials-create=(self)' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cache-Control', value: 'private, no-store' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@achat/ui', '@achat/contracts'],
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
  // Exploitation : les réécritures sont figées au build ; API_INTERNAL_URL doit
  // être défini AU MOMENT DE `next build` (et non seulement au démarrage).
  rewrites() {
    const apiUrl = process.env['API_INTERNAL_URL'] ?? 'http://127.0.0.1:3000';
    return Promise.resolve([{ source: '/v1/:path*', destination: `${apiUrl}/v1/:path*` }]);
  },
};

export default nextConfig;
