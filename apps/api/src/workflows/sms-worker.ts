import type { Pool } from 'pg';
import { revealPhone, type PiiKeys } from '../modules/identity/phone-key';
import type { SmsSender } from '../modules/identity/sms.port';
import { claimedSmsRecipient, claimSmsNotification, completeNotification, retryNotification } from '../modules/notifications/dispatch.store';
import { renderNotification, type NotificationEvent } from '../modules/notifications/domain';

/**
 * D121, tranche 2 : distribution des SMS. Une itération prend au plus une
 * notification SMS (bail commité), déchiffre le numéro du destinataire au
 * dernier moment, envoie le texte du gabarit dans la langue de la
 * notification, puis confirme avec la référence du prestataire ; tout échec
 * rend la notification reprenable après délai (aucun texte libre enregistré).
 * Ni le numéro ni le texte ne sont journalisés ou renvoyés.
 */
export type SmsDispatchDeps = {
  readonly pool: Pick<Pool, 'connect'>;
  readonly sms: SmsSender;
  readonly piiKeys: PiiKeys;
};

export type SmsDispatchOutcome = 'IDLE' | 'SENT' | 'RETRY' | 'ERROR';

/** Texte du SMS : le corps du gabarit validé (F-NOT-001/002), sans aucune donnée interpolée. */
export function smsText(event: NotificationEvent, locale: 'fr' | 'en'): string {
  return renderNotification({ event, locale, channel: 'SMS' }).body;
}

export async function dispatchNextSms(deps: SmsDispatchDeps): Promise<SmsDispatchOutcome> {
  const claim = await claimSmsNotification(deps.pool);
  if (claim === null) return 'IDLE';
  let providerRef: string;
  try {
    const recipient = await claimedSmsRecipient(deps.pool, claim.claimId);
    if (recipient === null) throw new Error('NOTIFICATION_RECIPIENT_UNAVAILABLE');
    const phone = await revealPhone(recipient, deps.piiKeys);
    ({ providerRef } = await deps.sms.send({ phone, text: smsText(claim.event, claim.locale) }));
  } catch {
    await retryNotification(deps.pool, claim.claimId);
    return 'RETRY';
  }
  // Après acceptation par le prestataire : confirmation (une notification confirmée n'est plus reprise).
  await completeNotification(deps.pool, claim.claimId, providerRef);
  return 'SENT';
}

/**
 * Boucle du travailleur : enchaîne les envois tant qu'il y en a, attend
 * `idleDelayMs` sinon ; s'arrête proprement sur le signal (SIGTERM). Une
 * erreur de base (ou une confirmation refusée après envoi) ne fait pas tomber
 * le processus : elle est signalée (`ERROR`, sans détail) et suivie d'une
 * attente. Distribution « au moins une fois » : si la confirmation échoue
 * après l'envoi, le bail expire et le SMS peut repartir une fois.
 */
export async function runSmsWorker(
  deps: SmsDispatchDeps & { readonly signal: AbortSignal; readonly idleDelayMs: number; readonly onOutcome?: (outcome: SmsDispatchOutcome) => void },
): Promise<void> {
  while (!deps.signal.aborted) {
    let outcome: SmsDispatchOutcome;
    try {
      outcome = await dispatchNextSms(deps);
    } catch {
      outcome = 'ERROR';
    }
    deps.onOutcome?.(outcome);
    if (outcome === 'IDLE' || outcome === 'ERROR') {
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(resolveWait, deps.idleDelayMs);
        deps.signal.addEventListener('abort', () => { clearTimeout(timer); resolveWait(); }, { once: true });
      });
    }
  }
}
