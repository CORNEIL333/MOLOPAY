import http from 'k6/http';
import { check } from 'k6';

/**
 * Q7 (NF-PERF, CDC_07 § charge) : scénario de charge **local seulement**.
 * Refuse tout hôte qui n'est pas la boucle locale : jamais une base Neon, un
 * environnement partagé ni un partenaire. Lancer :
 *   k6 run tests/load/charge-locale.js
 * ou, contre une autre instance locale :
 *   BASE_URL=http://127.0.0.1:8080 k6 run tests/load/charge-locale.js
 * k6 n'est pas installé sur le poste de développement Qoder : ce scénario est
 * livré avec la procédure, il n'a pas été exécuté ici (voir la PR Q7).
 */
const base = __ENV.BASE_URL || 'http://127.0.0.1:8080';
const host = new URL(base).hostname;
const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
if (!LOCAL.has(host)) {
  throw new Error(`LOAD_TARGET_REFUSED: « ${host} » n'est pas un hôte local`);
}

export const options = {
  scenarios: {
    lecture_publique: { executor: 'constant-vus', vus: 20, duration: '2m' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<300'],
  },
};

export default function lecturePublique(): void {
  const health = http.get(`${base}/health`);
  check(health, { 'health 200': (response) => response.status === 200 });
  const ready = http.get(`${base}/health/ready`);
  check(ready, { 'ready 200': (response) => response.status === 200 });
  const offers = http.get(`${base}/v1/offers`);
  check(offers, { 'offres 200': (response) => response.status === 200 });
}
