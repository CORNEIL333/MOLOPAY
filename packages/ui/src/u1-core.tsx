'use client';

import { parseXaf, toCanonicalString } from '@achat/money';
import { type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { AmountXaf } from './AmountXaf';
import { cx } from './classnames';
import { BrandRing } from './FlatWorkspace';
import { formatXaf } from './format';
import { useVisualEffects } from './materials';

export type MpIconName =
  | 'search' | 'heart' | 'home' | 'grid' | 'target' | 'user' | 'volume'
  | 'check' | 'alert' | 'wifiOff' | 'arrowRight' | 'close' | 'lock' | 'qr';

const ICON_PATHS: Readonly<Record<MpIconName, ReactNode>> = {
  search: <><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></>,
  heart: <path d="M8 13.5S2 9.8 2 5.6A3.1 3.1 0 0 1 8 4.2a3.1 3.1 0 0 1 6 1.4c0 4.2-6 7.9-6 7.9Z" />,
  home: <><path d="M2.5 7 8 2.5 13.5 7v6.5h-11Z" /><path d="M6.5 13.5v-4h3v4" /></>,
  grid: <><rect x="2" y="2" width="5" height="5" rx="1.4" /><rect x="9" y="2" width="5" height="5" rx="1.4" /><rect x="2" y="9" width="5" height="5" rx="1.4" /><rect x="9" y="9" width="5" height="5" rx="1.4" /></>,
  target: <><circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="2.5" /></>,
  user: <><circle cx="8" cy="5.5" r="2.6" /><path d="M3 13.8c.7-2.8 2.5-4 5-4s4.3 1.2 5 4" /></>,
  volume: <><path d="M2.5 6.5v3h2.2L8.5 13V3L4.7 6.5Z" /><path d="M11 5.5a3.5 3.5 0 0 1 0 5" /></>,
  check: <path d="m3.2 8.3 3.1 3.1 6.5-6.6" />,
  alert: <><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5M8 11.2h.01" /></>,
  wifiOff: <><path d="M1.8 5.2a8.5 8.5 0 0 1 12.4 0M4 7.6a5.2 5.2 0 0 1 8 0M2 2l12 12" /></>,
  arrowRight: <path d="M3 8h10M9 4l4 4-4 4" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  lock: <><rect x="3" y="7" width="10" height="6.5" rx="1.8" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>,
  qr: <><path d="M2.5 5.5V2.5h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3M5 8h6" /></>,
};

/** F4 : icône SVG au trait 1,6 px, coins arrondis, aucune police externe. */
export function MpIcon({ name, size = 18, className }: { readonly name: MpIconName; readonly size?: number; readonly className?: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {ICON_PATHS[name]}
    </svg>
  );
}

/** 09_… § 3 #4 / M-01 : bouton d'icône rond 44 px, `ariaLabel` obligatoire. */
export function IconButton({
  icon,
  ariaLabel,
  pressed,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> & {
  readonly icon: MpIconName;
  readonly ariaLabel: string;
  readonly pressed?: boolean;
}): ReactElement {
  if (ariaLabel.trim().length === 0) throw new Error('ICON_BUTTON_LABEL_REQUIRED');
  return (
    <button {...rest} type={rest.type ?? 'button'} aria-label={ariaLabel} aria-pressed={pressed} data-mp-motion="M-01" className={cx('mp-icon-btn', pressed && 'mp-icon-btn--active', className)}>
      <MpIcon name={icon} />
    </button>
  );
}

/** 09_… § 3 #5 / M-04 : pastille de choix avec `aria-pressed`. */
export function ChoiceChip({
  pressed,
  disabled,
  onClick,
  className,
  children,
}: {
  readonly pressed: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly className?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <button type="button" disabled={disabled} aria-pressed={pressed} data-mp-motion="M-04" className={cx('mp-chip', pressed && 'mp-chip--on', className)} onClick={onClick}>
      {children}
    </button>
  );
}

/** 09_… § 3 #8 / M-04 : pastilles de montant canoniques XAF (aucune saisie flottante libre). */
export function AmountChips({
  label,
  amounts,
  value,
  onSelect,
}: {
  readonly label: string;
  readonly amounts: readonly string[];
  readonly value: string | null;
  readonly onSelect: (amountXaf: string) => void;
}): ReactElement {
  const formatted = amounts.map((a) => [a, formatXaf(a)] as const);
  return (
    <div role="group" aria-label={label} className="mp-tabs">
      {formatted.map(([raw, display]) => (
        <ChoiceChip key={raw} pressed={value === raw} onClick={() => { onSelect(raw); }}>
          <span className="achat-amount">{display}</span>
        </ChoiceChip>
      ))}
    </div>
  );
}

/** 09_… § 3 #6 / M-36, M-27 : champ PIN ou OTP à 6 chiffres ASCII, sans stockage. */
export function PinOtpField({
  id,
  label,
  value,
  onChange,
  length = 6,
  mode = 'pin',
  error,
  disabled = false,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (digits: string) => void;
  readonly length?: number;
  readonly mode?: 'pin' | 'otp';
  readonly error?: string;
  readonly disabled?: boolean;
}): ReactElement {
  const { sober, reducedMotion } = useVisualEffects();
  const isReduced = sober || reducedMotion;
  const errId = error !== undefined ? `${id}-error` : undefined;
  return (
    <div data-mp-motion={error !== undefined ? 'M-27' : 'M-36'} data-mp-reduced={isReduced ? 'true' : 'false'} className={cx('achat-field', error !== undefined && !isReduced && 'mp-pin--error')}>
      <label className="achat-field__label" htmlFor={id}>{label}</label>
      <input
        id={id}
        type={mode === 'pin' ? 'password' : 'text'}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={length}
        autoComplete={mode === 'otp' ? 'one-time-code' : 'off'}
        disabled={disabled}
        value={value}
        aria-invalid={error !== undefined ? 'true' : undefined}
        aria-describedby={errId}
        className="mp-pin-input"
        onChange={(e) => { onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, length)); }}
      />
      {error !== undefined ? <p id={errId} role="alert" className="achat-field__error">{error}</p> : null}
    </div>
  );
}

const FR_U = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const FR_T = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];
const EN_U = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_T = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function under1000Fr(n: number): string {
  if (n === 0) return '';
  const h = Math.floor(n / 100);
  const r = n % 100;
  const hPart = h === 0 ? '' : h === 1 ? 'cent' : `${FR_U[h] ?? ''} cent${r === 0 ? 's' : ''}`;
  let rPart = '';
  if (r > 0 && r < 20) rPart = FR_U[r] ?? '';
  else if (r >= 20) {
    const t = Math.floor(r / 10);
    const u = r % 10;
    const sub = t === 7 || t === 9 ? 10 + u : u;
    const base = FR_T[t] ?? '';
    rPart = sub === 0 ? (t === 8 ? 'quatre-vingts' : base) : sub === 1 && t < 8 ? `${base} et un` : `${base}-${FR_U[sub] ?? ''}`;
  }
  return [hPart, rPart].filter(Boolean).join(' ');
}

function under1000En(n: number): string {
  if (n === 0) return '';
  const h = Math.floor(n / 100);
  const r = n % 100;
  const hPart = h === 0 ? '' : `${EN_U[h] ?? ''} hundred`;
  const rPart = r === 0 ? '' : r < 20 ? (EN_U[r] ?? '') : `${EN_T[Math.floor(r / 10)] ?? ''}${r % 10 > 0 ? `-${EN_U[r % 10] ?? ''}` : ''}`;
  return [hPart, rPart].filter(Boolean).join(' ');
}

/** Convertit un montant XAF entier en toutes lettres (FR ou EN) via `@achat/money` (`bigint`). */
export function amountInWords(amountXaf: string, locale: 'fr' | 'en' = 'fr'): string {
  const v = BigInt(toCanonicalString(parseXaf(amountXaf)));
  if (v === 0n) return locale === 'en' ? 'zero CFA francs' : 'zéro franc CFA';
  const scales = locale === 'en'
    ? ([[1_000_000_000n, 'billion'], [1_000_000n, 'million'], [1_000n, 'thousand']] as const)
    : ([[1_000_000_000n, 'milliard'], [1_000_000n, 'million'], [1_000n, 'mille']] as const);
  let rem = v;
  const parts: string[] = [];
  for (const [unit, word] of scales) {
    if (rem >= unit) {
      const q = Number(rem / unit);
      rem %= unit;
      if (locale === 'fr' && unit === 1_000n && q === 1) parts.push('mille');
      else {
        const chunk = locale === 'en' ? under1000En(q) : under1000Fr(q).replace(/cents$/, 'cent').replace(/quatre-vingts$/, 'quatre-vingt');
        const plural = locale === 'fr' && unit >= 1_000_000n && q > 1 ? 's' : '';
        parts.push(`${chunk} ${word}${plural}`);
      }
    }
  }
  if (rem > 0n) parts.push(locale === 'en' ? under1000En(Number(rem)) : under1000Fr(Number(rem)));
  return `${parts.join(' ')} ${locale === 'en' ? 'CFA francs' : v > 1n ? 'francs CFA' : 'franc CFA'}`;
}

export type BanknoteCount = { readonly denomination: 10000 | 5000 | 2000 | 1000 | 500; readonly count: number };

/** Décompose un montant XAF en coupures CEMAC exactes (`bigint`, sans flottant). */
export function cemacBanknotes(amountXaf: string): readonly BanknoteCount[] {
  let rem = BigInt(toCanonicalString(parseXaf(amountXaf)));
  const out: BanknoteCount[] = [];
  for (const d of [10000, 5000, 2000, 1000, 500] as const) {
    const bigD = BigInt(d);
    if (rem >= bigD) {
      out.push({ denomination: d, count: Number(rem / bigD) });
      rem %= bigD;
    }
  }
  return out;
}

/** 09_… § 3 #7 / M-21 : montant en 4 représentations (chiffres tabulaires, lettres, coupures CEMAC, voix). */
export function InclusiveAmount({
  amount,
  locale = 'fr',
  size = 'md',
}: {
  readonly amount: string;
  readonly locale?: 'fr' | 'en';
  readonly size?: 'md' | 'lg';
}): ReactElement {
  const words = amountInWords(amount, locale);
  const notes = cemacBanknotes(amount);
  const listenLabel = locale === 'en' ? 'Listen' : 'Écouter';
  function speak(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(words);
      u.lang = locale === 'en' ? 'en-GB' : 'fr-FR';
      window.speechSynthesis.speak(u);
    }
  }
  return (
    <div data-mp-motion="M-21" data-mp-financial="true" className={cx('mp-amount-inclusive', size === 'lg' && 'mp-amount-inclusive--lg')}>
      <div className="mp-amount-inclusive__head">
        <span className="mp-amount-inclusive__digits"><AmountXaf amount={amount} /></span>
        <button type="button" className="mp-chip" onClick={speak}><MpIcon name="volume" size={15} /><span>{listenLabel}</span></button>
      </div>
      <p className="mp-amount-inclusive__words">{words}</p>
      {notes.length > 0 ? (
        <ul className="mp-amount-inclusive__notes" aria-label={locale === 'en' ? 'CEMAC banknotes' : 'Coupures CEMAC'}>
          {notes.map((n) => <li key={String(n.denomination)} className="mp-st mp-st--plain">{`${n.count.toString()} × ${formatXaf(String(n.denomination)).replace(/\s*FCFA$/, '')}`}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

/** 09_… § 3 #10 / M-20, M-24 : anneau de cotisation avec texte équivalent « {filled} sur 8 ». */
export function CotisationRing({
  filled,
  waiting = false,
  size = 48,
  tone = 'light',
  locale = 'fr',
}: {
  readonly filled: number;
  readonly waiting?: boolean;
  readonly size?: number;
  readonly tone?: 'light' | 'dark';
  readonly locale?: 'fr' | 'en';
}): ReactElement {
  const { sober, reducedMotion } = useVisualEffects();
  const clamped = Math.max(0, Math.min(8, Math.trunc(filled)));
  const spin = waiting && !sober && !reducedMotion;
  const label = locale === 'en' ? `${clamped.toString()} of 8` : `${clamped.toString()} sur 8`;
  return (
    <span role="img" aria-label={label} data-mp-motion={waiting ? 'M-24' : 'M-20'} data-mp-waiting={spin ? 'true' : 'false'} className={cx('mp-cotisation-ring', spin && 'mp-cotisation-ring--spin')}>
      <BrandRing filled={clamped} size={size} tone={tone} />
    </span>
  );
}
