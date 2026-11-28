import type { NextConfig } from 'next';

/**
 * Portail partenaire (D63) : application séparée du client et du back-office.
 * Politique stricte : aucun cadre, aucune ressource tierce ; WebAuthn et
 * géolocalisation (remise au comptoir) limités à la même origine.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(), publickey-credentials-get=(self), publickey-credentials-create=(self)' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cache-Control', value: 'private, no-store' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@achat/ui', '@achat/contracts', '@achat/money'],
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
