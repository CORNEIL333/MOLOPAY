'use client';

import type { components } from '@achat/contracts/api';
import { AmountXaf, Button, ErrorState, TextField } from '@achat/ui';
import type { ProblemSummary } from '@achat/contracts/client';
import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import type { Locale } from '../i18n';
import { browserApi } from '../lib/browser-api';
import { formatDate, formatDateTime } from '../lib/date';
import { problemFrom } from '../lib/problem';
import type { Offer, OfferModel } from './offer-card';

type QuoteRequest = components['schemas']['QuoteRequest'];
export type Quote = components['schemas']['Quote'];
type Rhythm = components['schemas']['Rhythm'];

export type QuoteOutcome =
  | { readonly ok: true; readonly quote: Quote }
  | { readonly ok: false; readonly problem: ProblemSummary };

export type QuoteLabels = {
  readonly quoteTitle: string;
  readonly quoteDescription: string;
  readonly chooseModel: string;
  readonly requestQuote: string;
  readonly quoteErrorTitle: string;
  readonly total: string;
  readonly fees: string;
  readonly downPayment: string;
  readonly installments: string;
  readonly installmentNumber: string;
  readonly dueDate: string;
  readonly expiresAt: string;
  readonly rhythmLabel: string;
  readonly durationLabel: string;
  readonly startTitle: string;
  readonly termsLabel: string;
  readonly termsRequired: string;
  readonly startButton: string;
  readonly startErrorTitle: string;
  readonly loginToStart: string;
  readonly models: Readonly<Record<OfferModel, string>>;
  readonly rhythms: Readonly<Record<Rhythm, string>>;
};

const RHYTHMS: readonly Rhythm[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'FREE'];
const DURATION_MONTHS = /^(?:[1-9]|[12][0-9]|3[0-6])$/;

async function requestDefaultQuote(
  offerId: string,
  input: QuoteRequest,
  fallbackTitle: string,
): Promise<QuoteOutcome> {
  try {
    const response = await browserApi().POST('/v1/offers/{offerId}/quotes', {
      params: { path: { offerId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: input,
    });
    if (response.data !== undefined) {
      return { ok: true, quote: response.data };
    }
    return {
      ok: false,
      problem: problemFrom(response.error, response.response, fallbackTitle),
    };
  } catch {
    return { ok: false, problem: { title: fallbackTitle } };
  }
}

export function QuotePanel({
  offer,
  labels,
  locale,
  requestQuote,
}: {
  readonly offer: Offer;
  readonly labels: QuoteLabels;
  readonly locale: Locale;
  readonly requestQuote?: (input: QuoteRequest) => Promise<QuoteOutcome>;
}): ReactElement {
  const initialModel = offer.models[0] ?? 'SAVE_THEN_BUY';
  const [model, setModel] = useState<OfferModel>(initialModel);
  const [rhythm, setRhythm] = useState<Rhythm>('MONTHLY');
  const [duration, setDuration] = useState('12');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);

  const durationValid = DURATION_MONTHS.test(duration);
  const canSubmit = durationValid && !pending;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setPending(true);
    setProblem(null);
    const input: QuoteRequest = {
      model,
      rhythm,
      durationMonths: Number(duration),
    };
    const outcome =
      requestQuote === undefined
        ? await requestDefaultQuote(
            offer.offerId,
            input,
            labels.quoteErrorTitle,
          )
        : await requestQuote(input);
    if (outcome.ok) {
      setQuote(outcome.quote);
    } else {
      setProblem(outcome.problem);
      setQuote(null);
    }
    setPending(false);
  }

  return (
    <section className="quote-panel" aria-labelledby="quote-title">
      <h2 id="quote-title" className="page-title">
        {labels.quoteTitle}
      </h2>
      <p className="page-subtitle">{labels.quoteDescription}</p>

      <form className="quote-form" onSubmit={(event) => void submit(event)}>
        <div className="achat-field">
          <label className="achat-field__label" htmlFor="quote-model">
            {labels.chooseModel}
          </label>
          <select
            id="quote-model"
            className="achat-field__input"
            value={model}
            onChange={(event) =>
              setModel(event.currentTarget.value as OfferModel)
            }
          >
            {offer.models.map((option) => (
              <option key={option} value={option}>
                {labels.models[option]}
              </option>
            ))}
          </select>
        </div>
        <div className="achat-field">
          <label className="achat-field__label" htmlFor="quote-rhythm">
            {labels.rhythmLabel}
          </label>
          <select
            id="quote-rhythm"
            className="achat-field__input"
            value={rhythm}
            onChange={(event) =>
              setRhythm(event.currentTarget.value as Rhythm)
            }
          >
            {RHYTHMS.map((option) => (
              <option key={option} value={option}>
                {labels.rhythms[option]}
              </option>
            ))}
          </select>
        </div>
        <TextField
          id="quote-duration"
          label={labels.durationLabel}
          type="number"
          inputMode="numeric"
          min={1}
          max={36}
          value={duration}
          onChange={(event) => setDuration(event.currentTarget.value)}
        />
        <Button type="submit" disabled={!canSubmit}>
          {labels.requestQuote}
        </Button>
      </form>

      {problem === null ? null : (
        <ErrorState problem={problem} retryLabel={labels.requestQuote} />
      )}

      {quote === null ? null : (
        <div className="quote-result" aria-live="polite">
          <h3 className="quote-result__title">{labels.quoteTitle}</h3>
          <dl className="quote-result__amounts">
            <div>
              <dt>{labels.total}</dt>
              <dd>
                <AmountXaf amount={quote.totalXaf} />
              </dd>
            </div>
            <div>
              <dt>{labels.fees}</dt>
              <dd>
                <AmountXaf amount={quote.feesXaf} />
              </dd>
            </div>
            {quote.downPaymentXaf === undefined ? null : (
              <div>
                <dt>{labels.downPayment}</dt>
                <dd>
                  <AmountXaf amount={quote.downPaymentXaf} />
                </dd>
              </div>
            )}
          </dl>
          <h4 className="quote-result__subtitle">{labels.installments}</h4>
          <ol className="quote-result__installments">
            {quote.installments.map((installment, index) => (
              <li key={`${installment.dueDate}-${index.toString()}`}>
                <span>
                  {labels.installmentNumber} {(index + 1).toString()} ·{' '}
                  {labels.dueDate} {formatDate(installment.dueDate, locale)}
                </span>{' '}
                <AmountXaf amount={installment.amountXaf} />
              </li>
            ))}
          </ol>
          <p className="quote-result__expiry">
            {labels.expiresAt} {formatDateTime(quote.expiresAt, locale)}
          </p>
        </div>
      )}
    </section>
  );
}
