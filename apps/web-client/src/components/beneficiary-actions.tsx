'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { AmountXaf, Button, ErrorState, TextField } from '@achat/ui';
import { useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { getDictionary, type Locale } from '../i18n';
import { formatDateTime } from '../lib/date';

type Goal = components['schemas']['Goal'];
type Receipt = components['schemas']['BeneficiaryReceipt'];
type DocumentKind = components['schemas']['BeneficiaryDocumentRequest']['kind'];
export type BeneficiaryOutcome = { readonly ok: true } | { readonly ok: false; readonly problem: ProblemSummary };

/** Appels serveur injectés (navigateur : `browserBeneficiaryPorts`). */
export type BeneficiaryPorts = {
  readonly submitDocument: (input: { readonly kind: DocumentKind; readonly sha256: string }) => Promise<BeneficiaryOutcome>;
  readonly payBeneficiary: (pin: string) => Promise<BeneficiaryOutcome>;
};

const PIN_PATTERN = /^\d{6}$/;

/** F-PLN-002 / D48 : l'empreinte est calculée sur l'appareil ; seul le hachage est transmis. */
async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * F-PLN-002/003 : objectif C du client. Financé : dépôt de la pièce puis
 * règlement sous PIN. Réglé : reçu du virement (D58) ou exécution en cours.
 */
export function BeneficiaryActions({
  goal,
  receipt,
  locale,
  ports,
}: {
  readonly goal: Goal;
  readonly receipt: Receipt | null;
  readonly locale: Locale;
  readonly ports: BeneficiaryPorts;
}): ReactElement | null {
  const labels = getDictionary(locale).goals.beneficiary;
  const ids = { kind: useId(), file: useId(), pin: useId() };
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [kind, setKind] = useState<DocumentKind>('LEASE');
  const [pin, setPin] = useState('');
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const [pinError, setPinError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [done, setDone] = useState<'DOCUMENT' | 'PAID' | null>(null);
  const [pending, setPending] = useState(false);

  if (goal.model !== 'PLANNED_EXPENSE') {
    return null;
  }

  if (goal.status === 'PAID_TO_BENEFICIARY' || goal.status === 'CLOSED') {
    return (
      <section className="achat-beneficiary">
        <h2>{labels.receiptTitle}</h2>
        {receipt === null ? (
          <p role="status">{labels.receiptPending}</p>
        ) : (
          <dl>
            <div>
              <dt>{labels.receiptAmount}</dt>
              <dd>
                <AmountXaf amount={receipt.amountXaf} />
              </dd>
            </div>
            <div>
              <dt>{labels.receiptBeneficiary}</dt>
              <dd>{receipt.beneficiaryId}</dd>
            </div>
            <div>
              <dt>{labels.receiptExecutedAt}</dt>
              <dd>
                <time dateTime={receipt.executedAt}>{formatDateTime(receipt.executedAt, locale)}</time>
              </dd>
            </div>
            <div>
              <dt>{labels.receiptReference}</dt>
              <dd>{receipt.bankReference}</dd>
            </div>
            <div>
              <dt>{labels.receiptEntry}</dt>
              <dd>
                <code>{receipt.entryHashPrefix}</code>
              </dd>
            </div>
          </dl>
        )}
      </section>
    );
  }

  if (goal.status !== 'FUNDED') {
    return null;
  }

  async function run(action: () => Promise<BeneficiaryOutcome>, success: 'DOCUMENT' | 'PAID'): Promise<void> {
    setPending(true);
    setProblem(null);
    try {
      const outcome = await action();
      if (outcome.ok) {
        setDone(success);
      } else {
        setProblem(outcome.problem);
      }
    } catch {
      setProblem({ title: labels.error, detail: labels.network });
    } finally {
      setPending(false);
    }
  }

  async function submitDocument(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (file === undefined) {
      setFileError(labels.documentMissing);
      return;
    }
    setFileError(undefined);
    const sha256 = await sha256Hex(file);
    await run(() => ports.submitDocument({ kind, sha256 }), 'DOCUMENT');
  }

  async function pay(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!PIN_PATTERN.test(pin)) {
      setPinError(labels.pinInvalid);
      return;
    }
    setPinError(undefined);
    const entered = pin;
    setPin('');
    await run(() => ports.payBeneficiary(entered), 'PAID');
  }

  return (
    <section className="achat-beneficiary">
      <h2>{labels.title}</h2>
      {problem === null ? null : <ErrorState problem={problem} headingLevel={3} />}
      {done === 'PAID' ? <p role="status">{labels.paid}</p> : null}
      <form onSubmit={(event) => void submitDocument(event)} noValidate>
        <h3>{labels.documentTitle}</h3>
        <p>{labels.documentHelp}</p>
        <div className="achat-field">
          <label className="achat-field__label" htmlFor={ids.kind}>
            {labels.documentKind}
          </label>
          <select
            id={ids.kind}
            className="achat-field__input"
            value={kind}
            onChange={(event) => { setKind(event.target.value === 'LAND_TITLE' ? 'LAND_TITLE' : 'LEASE'); }}
          >
            <option value="LEASE">{labels.documentKindLease}</option>
            <option value="LAND_TITLE">{labels.documentKindLandTitle}</option>
          </select>
        </div>
        <div className="achat-field">
          <label className="achat-field__label" htmlFor={ids.file}>
            {labels.documentFile}
          </label>
          <input
            id={ids.file}
            ref={fileInput}
            type="file"
            className="achat-field__input"
            aria-invalid={fileError === undefined ? undefined : true}
            aria-describedby={fileError === undefined ? undefined : `${ids.file}-error`}
          />
          {fileError === undefined ? null : (
            <p className="achat-field__error" id={`${ids.file}-error`}>
              {fileError}
            </p>
          )}
        </div>
        <Button type="submit" disabled={pending}>
          {labels.documentSubmit}
        </Button>
        {done === 'DOCUMENT' ? <p role="status">{labels.documentSubmitted}</p> : null}
      </form>
      <form onSubmit={(event) => void pay(event)} noValidate>
        <h3>{labels.payTitle}</h3>
        <p>{labels.payHelp}</p>
        <TextField
          id={ids.pin}
          label={labels.pin}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          error={pinError}
          onChange={(event) => { setPin(event.target.value); }}
        />
        <Button type="submit" disabled={pending}>
          {labels.paySubmit}
        </Button>
      </form>
    </section>
  );
}
