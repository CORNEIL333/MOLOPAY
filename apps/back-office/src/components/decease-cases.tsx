'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, StatusPill, TextField } from '@achat/ui';
import { useId, useState, type FormEvent, type ReactElement } from 'react';

type DeceaseCase = components['schemas']['DeceaseCase'];
type DeceaseCaseRequest = components['schemas']['DeceaseCaseRequest'];
type DeceaseDecision = components['schemas']['DeceaseDecision'];
type DeceaseDecisionRequest = components['schemas']['DeceaseDecisionRequest'];
type Failure = { readonly ok: false; readonly problem: ProblemSummary };

export type DeceaseCasesPorts = {
  readonly declareCase: (accountId: string, body: DeceaseCaseRequest) => Promise<{ readonly ok: true; readonly deceaseCase: DeceaseCase } | Failure>;
  readonly decideCase: (caseId: string, body: DeceaseDecisionRequest) => Promise<{ readonly ok: true; readonly decision: DeceaseDecision } | Failure>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX64 = /^[0-9a-f]{64}$/;

const COPY = {
  fr: {
    title: 'Déclaration et décision de décès',
    subtitle: 'F-ACC-007 : déclaration motivée (Support N2 ou Conformité), puis décision par une autre personne de la Conformité.',
    makerChecker: 'Vous ne pouvez pas approuver une opération que vous avez préparée.',
    declareHeading: '1. Déclarer un dossier',
    accountLabel: 'Identifiant du compte client',
    dateLabel: 'Date du décès (AAAA-MM-JJ)',
    digestLabel: 'Empreinte de l’acte de décès (64 hex minuscules, pièce hors base)',
    reasonLabel: 'Motif de la déclaration',
    declareBtn: 'Déclarer le dossier',
    decideHeading: '2. Décider un dossier (2e personne)',
    caseLabel: 'Identifiant du dossier de décès',
    decisionLabel: 'Décision',
    approveOpt: 'Approuver (blocage définitif et gel des objectifs)',
    rejectOpt: 'Rejeter (motif obligatoire)',
    decisionReasonLabel: 'Motif de la décision (obligatoire si rejet)',
    decideBtn: 'Enregistrer la décision',
    errUuid: 'Identifiant UUID invalide.',
    errDate: 'Date AAAA-MM-JJ requise, jamais dans le futur.',
    errDigest: 'Empreinte hexadécimale minuscule de 64 caractères requise.',
    errReason: 'Motif obligatoire (3 caractères au moins).',
    declaredStatus: (id: string): string => `Dossier ${id} enregistré en attente d’une seconde personne. Aucun objectif n’est gelé avant approbation.`,
    decidedStatus: (id: string, dec: string, frozen: number): string =>
      dec === 'APPROVED' ? `Dossier ${id} approuvé · objectifs actifs gelés : ${frozen.toString()}.` : `Dossier ${id} rejeté.`,
    netTitle: 'Action non confirmée',
    netDetail: 'Connexion interrompue. Vérifiez l’état du dossier avant toute nouvelle tentative.',
  },
  en: {
    title: 'Customer decease declaration and decision',
    subtitle: 'F-ACC-007: reasoned declaration (Support L2 or Compliance), followed by a second Compliance officer decision.',
    makerChecker: 'You cannot approve an operation you prepared.',
    declareHeading: '1. Declare a case',
    accountLabel: 'Customer account ID',
    dateLabel: 'Date of death (YYYY-MM-DD)',
    digestLabel: 'Death certificate digest (64 lowercase hex chars, file kept off-database)',
    reasonLabel: 'Declaration reason',
    declareBtn: 'Declare case',
    decideHeading: '2. Decide a case (2nd person)',
    caseLabel: 'Decease case ID',
    decisionLabel: 'Decision',
    approveOpt: 'Approve (permanent block and freeze active goals)',
    rejectOpt: 'Reject (reason required)',
    decisionReasonLabel: 'Decision reason (required when rejecting)',
    decideBtn: 'Record decision',
    errUuid: 'Invalid UUID.',
    errDate: 'Valid non-future YYYY-MM-DD date required.',
    errDigest: '64-character lowercase hex digest required.',
    errReason: 'Reason required (at least 3 characters).',
    declaredStatus: (id: string): string => `Case ${id} recorded and awaiting a second officer. No goal is frozen before approval.`,
    decidedStatus: (id: string, dec: string, frozen: number): string =>
      dec === 'APPROVED' ? `Case ${id} approved · frozen active goals: ${frozen.toString()}.` : `Case ${id} rejected.`,
    netTitle: 'Action not confirmed',
    netDetail: 'Connection interrupted. Check case status before retrying.',
  },
} as const;

export function DeceaseCasesPanel({
  ports,
  locale = 'fr',
  todayIso = new Date().toISOString().slice(0, 10),
}: {
  readonly ports: DeceaseCasesPorts;
  readonly locale?: 'fr' | 'en';
  readonly todayIso?: string;
}): ReactElement {
  const t = COPY[locale];
  const ids = { acc: useId(), dt: useId(), dig: useId(), r1: useId(), cid: useId(), dec: useId(), r2: useId() };
  const [accountId, setAccountId] = useState('');
  const [deathDate, setDeathDate] = useState('');
  const [digest, setDigest] = useState('');
  const [reason, setReason] = useState('');
  const [declErr, setDeclErr] = useState<Partial<Record<'acc' | 'dt' | 'dig' | 'r1', string>>>({});
  const [caseId, setCaseId] = useState('');
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [decReason, setDecReason] = useState('');
  const [decErr, setDecErr] = useState<Partial<Record<'cid' | 'r2', string>>>({});
  const [declared, setDeclared] = useState<DeceaseCase | null>(null);
  const [decided, setDecided] = useState<DeceaseDecision | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);

  async function onDeclare(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const errs = {
      ...(UUID.test(accountId) ? {} : { acc: t.errUuid }),
      ...(ISO_DATE.test(deathDate) && deathDate <= todayIso ? {} : { dt: t.errDate }),
      ...(HEX64.test(digest) ? {} : { dig: t.errDigest }),
      ...(reason.trim().length >= 3 ? {} : { r1: t.errReason }),
    };
    setDeclErr(errs);
    if (Object.keys(errs).length > 0) return;
    setPending(true);
    setProblem(null);
    setDeclared(null);
    try {
      const res = await ports.declareCase(accountId, { deathDate, certificateSha256: digest, reason: reason.trim() });
      if (res.ok) { setDeclared(res.deceaseCase); setCaseId(res.deceaseCase.caseId); } else setProblem(res.problem);
    } catch { setProblem({ title: t.netTitle, detail: t.netDetail }); } finally { setPending(false); }
  }

  async function onDecide(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const errs = {
      ...(UUID.test(caseId) ? {} : { cid: t.errUuid }),
      ...(decision === 'APPROVED' || decReason.trim().length >= 3 ? {} : { r2: t.errReason }),
    };
    setDecErr(errs);
    if (Object.keys(errs).length > 0) return;
    setPending(true);
    setProblem(null);
    setDecided(null);
    try {
      const body: DeceaseDecisionRequest = decReason.trim().length >= 3 ? { decision, reason: decReason.trim() } : { decision };
      const res = await ports.decideCase(caseId, body);
      if (res.ok) setDecided(res.decision); else setProblem(res.problem);
    } catch { setProblem({ title: t.netTitle, detail: t.netDetail }); } finally { setPending(false); }
  }

  return (
    <section className="mp-page">
      <header className="mp-top">
        <div><h1>{t.title}</h1><p className="mp-sub">{t.subtitle}</p></div>
        <StatusPill tone="warn">F-ACC-007</StatusPill>
      </header>
      <p className="mp-banner">{t.makerChecker}</p>
      {problem === null ? null : <ErrorState problem={problem} />}
      {declared === null ? null : <p className="mp-banner" role="status">{t.declaredStatus(declared.caseId)}</p>}
      {decided === null ? null : <p className="mp-banner" role="status">{t.decidedStatus(decided.caseId, decided.decision, decided.frozenGoals)}</p>}

      <div className="mp-cols mp-cols--split">
        <form className="mp-panel mp-form" onSubmit={(e) => void onDeclare(e)} noValidate>
          <div className="mp-ph"><h2>{t.declareHeading}</h2></div>
          <TextField id={ids.acc} label={t.accountLabel} autoComplete="off" value={accountId} error={declErr.acc} onChange={(e) => { setAccountId(e.target.value.trim()); }} />
          <TextField id={ids.dt} label={t.dateLabel} autoComplete="off" value={deathDate} error={declErr.dt} onChange={(e) => { setDeathDate(e.target.value.trim()); }} />
          <TextField id={ids.dig} label={t.digestLabel} autoComplete="off" value={digest} error={declErr.dig} onChange={(e) => { setDigest(e.target.value.trim()); }} />
          <TextField id={ids.r1} label={t.reasonLabel} value={reason} error={declErr.r1} onChange={(e) => { setReason(e.target.value); }} />
          <Button type="submit" disabled={pending}>{t.declareBtn}</Button>
        </form>

        <form className="mp-panel mp-form" onSubmit={(e) => void onDecide(e)} noValidate>
          <div className="mp-ph"><h2>{t.decideHeading}</h2></div>
          <TextField id={ids.cid} label={t.caseLabel} autoComplete="off" value={caseId} error={decErr.cid} onChange={(e) => { setCaseId(e.target.value.trim()); }} />
          <div className="achat-field">
            <label className="achat-field__label" htmlFor={ids.dec}>{t.decisionLabel}</label>
            <select id={ids.dec} className="mp-select" value={decision} onChange={(e) => { setDecision(e.target.value as 'APPROVED' | 'REJECTED'); }}>
              <option value="APPROVED">{t.approveOpt}</option>
              <option value="REJECTED">{t.rejectOpt}</option>
            </select>
          </div>
          <TextField id={ids.r2} label={t.decisionReasonLabel} value={decReason} error={decErr.r2} onChange={(e) => { setDecReason(e.target.value); }} />
          <Button type="submit" variant={decision === 'REJECTED' ? 'danger' : 'primary'} disabled={pending}>{t.decideBtn}</Button>
        </form>
      </div>
    </section>
  );
}
