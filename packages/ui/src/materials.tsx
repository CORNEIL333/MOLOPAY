'use client';

import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { AmountXaf } from './AmountXaf';
import { Badge } from './Badge';
import { cx } from './classnames';
import { molopayTokens } from './tokens';

export type LiquidUniverse = 'home' | 'essentials' | 'technology' | 'housing' | 'mobility' | 'aurora';
export type GlassTone = 'light' | 'dark';

type EffectsCtx = {
  readonly sober: boolean;
  readonly reducedMotion: boolean;
  readonly userSober: boolean;
  readonly setUserSober: (next: boolean) => void;
  readonly glassRegistry: Set<symbol>;
};

const STORAGE_KEY = 'mp_sober_effects';
const VisualEffectsContext = createContext<EffectsCtx | null>(null);

const readMedia = (q: string): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(q).matches;

export function VisualEffectsProvider({
  children,
  defaultSober = false,
}: {
  readonly children: ReactNode;
  readonly defaultSober?: boolean;
}): ReactElement {
  const [userSober, setUserSoberState] = useState<boolean>(() => {
    if (defaultSober || typeof window === 'undefined') return defaultSober;
    try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => readMedia('(prefers-reduced-motion: reduce)'));
  const [reducedTrans, setReducedTrans] = useState<boolean>(() => readMedia('(prefers-reduced-transparency: reduce)'));
  const glassRegistryRef = useRef<Set<symbol>>(new Set());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const tMq = window.matchMedia('(prefers-reduced-transparency: reduce)');
    const onM = (): void => setReducedMotion(mMq.matches);
    const onT = (): void => setReducedTrans(tMq.matches);
    mMq.addEventListener?.('change', onM);
    tMq.addEventListener?.('change', onT);
    return () => { mMq.removeEventListener?.('change', onM); tMq.removeEventListener?.('change', onT); };
  }, []);

  const sober = userSober || reducedMotion || reducedTrans;
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.classList.toggle('mp-sober', sober);
  }, [sober]);

  const setUserSober = (next: boolean): void => {
    setUserSoberState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch { /* mémoire seule */ }
  };

  const value = useMemo<EffectsCtx>(
    () => ({ sober, reducedMotion, userSober, setUserSober, glassRegistry: glassRegistryRef.current }),
    [sober, reducedMotion, userSober],
  );
  return <VisualEffectsContext.Provider value={value}>{children}</VisualEffectsContext.Provider>;
}

export function useVisualEffects(): EffectsCtx {
  const ctx = useContext(VisualEffectsContext);
  if (ctx !== null) return ctx;
  const reduced = readMedia('(prefers-reduced-motion: reduce)');
  return {
    sober: reduced || readMedia('(prefers-reduced-transparency: reduce)'),
    reducedMotion: reduced,
    userSober: false,
    setUserSober: () => undefined,
    glassRegistry: new Set<symbol>(),
  };
}

const UNIVERSE_STOPS: Readonly<Record<LiquidUniverse, readonly string[]>> = {
  home: molopayTokens.gradientHome,
  essentials: molopayTokens.gradientEssentials,
  technology: molopayTokens.gradientTechnology,
  housing: molopayTokens.gradientHousing,
  mobility: molopayTokens.gradientMobility,
  aurora: molopayTokens.gradientAurora,
};

export type LiquidBackgroundProps = {
  readonly universe?: LiquidUniverse;
  readonly frozen?: boolean;
  readonly className?: string;
};

/** F8 / M-56 : fond liquide en dégradés radiaux pré-calculés, animé en `transform` seul. */
export function LiquidBackground({ universe = 'home', frozen = false, className }: LiquidBackgroundProps): ReactElement {
  const { sober, reducedMotion } = useVisualEffects();
  const isFrozen = frozen || universe === 'aurora' || sober || reducedMotion;
  return (
    <div
      aria-hidden="true"
      data-mp-motion="M-56"
      data-mp-universe={universe}
      data-mp-frozen={isFrozen ? 'true' : 'false'}
      className={cx('mp-liquid', isFrozen && 'mp-liquid--frozen', universe === 'aurora' && 'mp-liquid--aurora', className)}
    >
      {UNIVERSE_STOPS[universe].map((stop, idx) => (
        <span
          key={`${universe}-${String(idx)}`}
          className={`mp-liquid__blob mp-liquid__blob--${String((idx % 4) + 1)}`}
          style={{ background: `radial-gradient(closest-side, ${stop} 0%, transparent 100%)` }}
        />
      ))}
      {!sober && universe !== 'aurora' ? <span className="mp-grain" /> : null}
    </div>
  );
}

function hasFinancialChild(node: ReactNode): boolean {
  let found = false;
  Children.forEach(node, (child) => {
    if (found || !isValidElement(child)) return;
    if (child.type === AmountXaf || child.type === Badge) { found = true; return; }
    const p = child.props as { readonly children?: ReactNode; readonly 'data-mp-financial'?: string | boolean };
    if (p['data-mp-financial'] === 'true' || p['data-mp-financial'] === true) { found = true; return; }
    if (p.children !== undefined && hasFinancialChild(p.children)) found = true;
  });
  return found;
}

export type GlassSurfaceProps = {
  readonly tone?: GlassTone;
  readonly as?: 'div' | 'nav' | 'header' | 'span';
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly children: ReactNode;
};

/** F8 : surface de verre (≤ 2 par écran, interdite sous un montant ou un statut, repli Sobre 94 %). */
export function GlassSurface({ tone = 'light', as: Tag = 'div', className, ariaLabel, children }: GlassSurfaceProps): ReactElement {
  if (hasFinancialChild(children)) throw new Error('MP_GLASS_FINANCIAL_FORBIDDEN');
  const ctx = useContext(VisualEffectsContext);
  const idRef = useRef<symbol | null>(null);
  if (idRef.current === null) idRef.current = Symbol('mp-glass');
  if (ctx !== null && !ctx.glassRegistry.has(idRef.current)) {
    if (ctx.glassRegistry.size >= 2) throw new Error('MP_GLASS_BUDGET_EXCEEDED');
    ctx.glassRegistry.add(idRef.current);
  }
  useEffect(() => {
    const id = idRef.current;
    const reg = ctx?.glassRegistry;
    if (reg !== undefined && id !== null && !reg.has(id)) reg.add(id);
    return () => { if (reg !== undefined && id !== null) reg.delete(id); };
  }, [ctx]);
  const sober = ctx?.sober ?? false;
  return (
    <Tag
      aria-label={ariaLabel}
      data-mp-glass={tone}
      data-mp-sober={sober ? 'true' : 'false'}
      className={cx('mp-glass', tone === 'dark' ? 'mp-glass--dark' : 'mp-glass--light', sober && 'mp-glass--sober', className)}
    >
      {children}
    </Tag>
  );
}

export type SoberEffectsToggleProps = { readonly label: string; readonly description?: string; readonly className?: string };

export function SoberEffectsToggle({ label, description, className }: SoberEffectsToggleProps): ReactElement {
  const { userSober, setUserSober } = useVisualEffects();
  const descId = useId();
  return (
    <div className={cx('mp-sober-setting', className)}>
      <div className="mp-sober-setting__text">
        <span className="mp-sober-setting__label">{label}</span>
        {description !== undefined ? <span id={descId} className="mp-sober-setting__desc">{description}</span> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={userSober}
        aria-label={label}
        aria-describedby={description !== undefined ? descId : undefined}
        className={cx('mp-switch', userSober && 'mp-switch--checked')}
        onClick={() => setUserSober(!userSober)}
      >
        <span className="mp-switch__thumb" aria-hidden="true" />
      </button>
    </div>
  );
}
