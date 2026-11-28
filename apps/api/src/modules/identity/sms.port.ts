/**
 * F-ACC-001 / SEC-AUTH-001 : envoi des codes OTP par SMS. Port seulement :
 * aucun prestataire n'est encore choisi (D1) et aucune simulation n'est
 * admise. Sans implémentation configurée, l'inscription répond 503
 * SMS_UNCONFIGURED. L'adaptateur réel suivra la documentation officielle du
 * prestataire retenu, contre son environnement de test.
 */
export type SmsSender = {
  /**
   * Envoie le texte au numéro E.164 ; rend la référence opaque du prestataire
   * (jamais le texte ni le numéro) ; lève une erreur s'il refuse ou ne répond pas.
   */
  send(input: { readonly phone: string; readonly text: string }): Promise<{ readonly providerRef: string }>;
};

export const SMS_SENDER = Symbol('SMS_SENDER');

/** Poivre des codes OTP (configuration, KMS/HSM en production) ; null : inscription fermée. */
export const OTP_PEPPER = Symbol('OTP_PEPPER');

/** Texte du SMS : le code seulement, sa durée, et la consigne de ne jamais le communiquer. */
export function otpSmsText(code: string): string {
  return `MoloPay : votre code est ${code}. Il expire dans 5 minutes. Ne le communiquez à personne, même à un agent MoloPay.`;
}
