import type { ProblemSummary } from '@achat/contracts/client';
import type { CrmFile, CrmInteractionInput, CrmPorts, CrmResult, CrmTaskInput, CrmTransition } from './crm-ports';

const BASE = '/v1/backoffice/crm';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Problème RFC 9457 : seuls le titre et le détail sont affichés. */
function problemOf(error: unknown, status: number): ProblemSummary {
  const body = isRecord(error) ? error : {};
  return {
    title: typeof body['title'] === 'string' ? body['title'] : `Erreur ${status.toString()}`,
    status,
    ...(typeof body['detail'] === 'string' ? { detail: body['detail'] } : {}),
  };
}

/** Le serveur est la seule source ; on vérifie la forme minimale avant l'affichage. */
function asFile(value: unknown): CrmFile | null {
  if (!isRecord(value) || typeof value['accountId'] !== 'string' || typeof value['phoneMasked'] !== 'string'
    || typeof value['memberSince'] !== 'string' || typeof value['legalNameDeclared'] !== 'boolean'
    || !Array.isArray(value['agreements']) || !Array.isArray(value['interactions']) || !Array.isArray(value['tasks'])) {
    return null;
  }
  return value as unknown as CrmFile;
}

async function send(path: string, body: Readonly<Record<string, unknown>>): Promise<CrmResult<null>> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (response.ok) {
    return { ok: true, value: null };
  }
  return { ok: false, problem: problemOf(await response.json().catch(() => ({})), response.status) };
}

/**
 * Q5 / F-SUP-001 : appels réels du back-office (même origine, cookie de
 * session httpOnly). Aucune route n'est hors du préfixe /v1/backoffice/crm.
 */
export const browserCrmPorts: CrmPorts = {
  async file(accountId, reason) {
    const response = await fetch(`${BASE}/customers/${encodeURIComponent(accountId)}?${new URLSearchParams({ reason }).toString()}`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) {
      return { ok: false, problem: problemOf(await response.json().catch(() => ({})), response.status) };
    }
    const file = asFile(await response.json().catch(() => null));
    return file === null
      ? { ok: false, problem: { title: 'Réponse inattendue', status: response.status } }
      : { ok: true, value: file };
  },
  recordInteraction(accountId: string, input: CrmInteractionInput): Promise<CrmResult<null>> {
    return send(`${BASE}/customers/${encodeURIComponent(accountId)}/interactions`, { ...input });
  },
  createTask(accountId: string, input: CrmTaskInput): Promise<CrmResult<null>> {
    return send(`${BASE}/customers/${encodeURIComponent(accountId)}/tasks`, { ...input });
  },
  transitionTask(taskId: string, kind: CrmTransition, note: string): Promise<CrmResult<null>> {
    return send(`${BASE}/tasks/${encodeURIComponent(taskId)}/transitions`, { kind, note });
  },
};
