'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, StatusPill, TextField } from '@achat/ui';
import { getDictionary, type Locale } from '../i18n';
import { useEffect, useId, useState, type FormEvent, type ReactElement } from 'react';

export type CounterHandoverPorts = {
  readonly locate: () => Promise<{ readonly latitude: number; readonly longitude: number }>;
  readonly confirm: (body: { readonly code: string; readonly latitude: string; readonly longitude: string }) => Promise<
    { readonly ok: true; readonly agreementId: string; readonly validatedAt: string } | { readonly ok: false; readonly problem: ProblemSummary }
  >;
};
type HandoverLogEntry = { readonly agreementId: string; readonly validatedAt: string; readonly serial?: string };
const CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
const coordinate = (value: number, limit: number): string | null =>
  Number.isFinite(value) && Math.abs(value) <= limit ? value.toFixed(6) : null;

/** F-SET-001 / D63 / 09_… § 4.2 : remise au comptoir à plat, deux contrôles obligatoires et numéro de série. */
export function CounterHandover({ ports, locale = 'fr', requireChecklist = false }: { readonly ports: CounterHandoverPorts; readonly locale?: Locale; readonly requireChecklist?: boolean }): ReactElement {
  const t = getDictionary(locale).counter;
  const codeId = useId();
  const serialId = useId();
  const [code, setCode] = useState('');
  const [checkedId, setCheckedId] = useState(false);
  const [checkedOffer, setCheckedOffer] = useState(false);
  const [serial, setSerial] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [serialError, setSerialError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [done, setDone] = useState<HandoverLogEntry | null>(null);
  const [history, setHistory] = useState<readonly HandoverLogEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const onOffline = (): void => { setOnline(false); };
    const onOnline = (): void => { setOnline(true); };
    setOnline(navigator.onLine);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => { window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline); };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!online || pending) return;
    const compact = code.toUpperCase().replace(/[\s-]/g, '');
    if (!CODE.test(compact)) { setError(t.invalidCode); return; }
    setError(undefined);
    if (requireChecklist && (!checkedId || !checkedOffer || serial.trim().length < 4)) { setSerialError(t.serialInvalid); return; }
    setSerialError(undefined);
    setProblem(null);
    setDone(null);
    setPending(true);
    try {
      let position: { readonly latitude: string; readonly longitude: string } | null = null;
      try {
        const located = await ports.locate();
        const latitude = coordinate(located.latitude, 90);
        const longitude = coordinate(located.longitude, 180);
        position = latitude === null || longitude === null ? null : { latitude, longitude };
      } catch { position = null; }
      if (position === null) { setProblem({ title: t.noPositionTitle, detail: t.noPositionDetail }); return; }
      const result = await ports.confirm({ code: `${compact.slice(0, 5)}-${compact.slice(5)}`, ...position });
      if (result.ok) {
        const entry: HandoverLogEntry = { agreementId: result.agreementId, validatedAt: result.validatedAt, ...(requireChecklist ? { serial: serial.trim() } : {}) };
        setDone(entry);
        setHistory((prev) => [entry, ...prev].slice(0, 10));
        setCode('');
        setCheckedId(false);
        setCheckedOffer(false);
        setSerial('');
      } else { setProblem(result.problem); }
    } catch { setProblem({ title: t.failedTitle, detail: t.failedDetail }); } finally { setPending(false); }
  }

  const fmtTime = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Douala' });

  return (
    <section className="mp-page">
      <header className="mp-top">
        <div><h1>{t.title}</h1><p className="mp-sub">{t.subtitle}</p></div>
        <StatusPill tone={online ? 'ok' : 'bad'}>{t.codeValid}</StatusPill>
      </header>
      {!online ? <p className="mp-banner" role="status">{t.offline}</p> : null}
      {done === null ? null : (
        <p className="mp-banner" role="status">
          {t.doneLead(done.agreementId)}<time dateTime={done.validatedAt}>{fmtTime.format(new Date(done.validatedAt))}</time>{t.doneTail}
          {done.serial === undefined ? null : ` (${done.serial})`}
        </p>
      )}
      {problem === null ? null : <ErrorState problem={problem} />}
      <div className="mp-cols mp-cols--split">
        <div className="mp-panel">
          <form className="mp-form" onSubmit={(event) => void submit(event)} noValidate>
            <TextField id={codeId} label={t.code} autoComplete="off" value={code} error={error} onChange={(event) => { setCode(event.target.value); }} />
            {requireChecklist ? (
              <>
                <label className="mp-chk"><input type="checkbox" checked={checkedId} onChange={(e) => { setCheckedId(e.currentTarget.checked); }} /><span>{t.checkId}</span></label>
                <label className="mp-chk"><input type="checkbox" checked={checkedOffer} onChange={(e) => { setCheckedOffer(e.currentTarget.checked); }} /><span>{t.checkOffer}</span></label>
                <TextField id={serialId} label={t.serialLabel} autoComplete="off" value={serial} error={serialError} onChange={(e) => { setSerial(e.target.value); }} />
              </>
            ) : null}
            <Button type="submit" disabled={pending || !online}>{t.submit}</Button>
          </form>
        </div>
        {history.length > 0 ? (
          <aside className="mp-panel" aria-label={t.sessionLogTitle}>
            <div className="mp-ph"><h2>{t.sessionLogTitle}</h2></div>
            <div className="mp-table-wrap">
              <table className="mp-table"><tbody>{history.map((h) => <tr key={`${h.agreementId}-${h.validatedAt}`}><td><time dateTime={h.validatedAt}>{fmtTime.format(new Date(h.validatedAt))}</time></td><td><strong>{h.agreementId}</strong></td><td className="mp-num">{h.serial ?? '—'}</td></tr>)}</tbody></table>
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
