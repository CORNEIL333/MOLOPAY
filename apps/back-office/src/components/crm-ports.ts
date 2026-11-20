import type { ProblemSummary } from '@achat/contracts/client';

export type CrmInteractionView = {
  readonly interactionId: string;
  readonly channel: string;
  readonly direction: string;
  readonly summary: string;
  readonly outcome: string | null;
  readonly actorId: string;
  readonly occurredAt: string;
};

export type CrmTaskView = {
  readonly taskId: string;
  readonly title: string;
  readonly details: string | null;
  readonly priority: string;
  readonly assigneeId: string;
  readonly dueAt: string | null;
  readonly status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
};

export type CrmAgreementView = {
  readonly agreementId: string;
  readonly model: string;
  readonly status: string;
  readonly targetXaf: string;
};

export type CrmFile = {
  readonly accountId: string;
  readonly phoneMasked: string;
  readonly memberSince: string;
  readonly legalNameDeclared: boolean;
  readonly agreements: readonly CrmAgreementView[];
  readonly interactions: readonly CrmInteractionView[];
  readonly tasks: readonly CrmTaskView[];
};

export type CrmResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: ProblemSummary };

export type CrmInteractionInput = {
  readonly channel: string;
  readonly direction: string;
  readonly summary: string;
  readonly outcome: string | null;
  readonly occurredAt: string;
};

export type CrmTaskInput = {
  readonly title: string;
  readonly details: string | null;
  readonly priority: string;
  readonly assignee: string;
  readonly dueAt: string | null;
};

export type CrmTransition = 'COMPLETED' | 'CANCELLED';

/**
 * Q5 / F-SUP-001 : appels injectés de l'écran CRM. Lecture motivée (le motif
 * est obligatoire côté serveur et journalisé) ; écritures en ajout seul avec
 * une clé d'idempotence par intention.
 */
export type CrmPorts = {
  readonly file: (accountId: string, reason: string) => Promise<CrmResult<CrmFile>>;
  readonly recordInteraction: (accountId: string, input: CrmInteractionInput) => Promise<CrmResult<null>>;
  readonly createTask: (accountId: string, input: CrmTaskInput) => Promise<CrmResult<null>>;
  readonly transitionTask: (taskId: string, kind: CrmTransition, note: string) => Promise<CrmResult<null>>;
};
