import type { BeneficiaryOutcome, BeneficiaryPorts } from '../components/beneficiary-actions';
import { browserApi } from './browser-api';
import { problemFrom } from './problem';

/**
 * Appels réels aux routes D48/D58, même origine, cookies de session inclus.
 * Une clé d'idempotence par intention : un double envoi n'a d'effet qu'une fois.
 */
export function browserBeneficiaryPorts(goalId: string, errorTitle: string): BeneficiaryPorts {
  const path = { params: { path: { goalId } } } as const;
  return {
    async submitDocument(input): Promise<BeneficiaryOutcome> {
      const result = await browserApi().POST('/v1/goals/{goalId}/beneficiary-documents', {
        params: { path: { goalId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: input,
        cache: 'no-store',
      });
      return result.response.status === 201 ? { ok: true } : { ok: false, problem: problemFrom(result.error, result.response, errorTitle) };
    },
    async payBeneficiary(pin): Promise<BeneficiaryOutcome> {
      const result = await browserApi().POST('/v1/goals/{goalId}/beneficiary-payment', {
        params: { ...path.params, header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { pin },
        cache: 'no-store',
      });
      return result.response.status === 200 ? { ok: true } : { ok: false, problem: problemFrom(result.error, result.response, errorTitle) };
    },
  };
}
