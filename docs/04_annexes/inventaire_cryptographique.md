# Inventaire cryptographique (SEC-CRY-006)

> État relevé dans le code le 19 novembre 2026 (branche d'intégration du sprint), pour préparer une migration post-quantique et la revue de sécurité. À tenir à jour à chaque ajout ou changement de primitive. Les emplacements de clés de **production** (HSM/KMS) ne sont pas encore décidés (ADR-0003, ADR-0004, D5) : aucune clé réelle n'existe dans le dépôt.

| Usage | Primitive et paramètres | Emplacement dans le code | Clé ou secret | Exposition post-quantique |
|---|---|---|---|---|
| Chaînage du grand livre et du journal d'audit (INT-HASH) | SHA-256 sur JSON canonique (JCS, RFC 8785) | `packages/chain` (`jcs.ts`, chaînage), `ledger/entry.store.ts`, `audit/` | — | Faible (marge de 128 bits face à Grover) |
| Arbres de Merkle des lots (INT-ANC) | SHA-256, RFC 6962/9162 | `packages/chain/src/merkle.ts` ; vérificateur Rust `tools/verifier` (`sha2` 0.10.9) | — | Faible |
| Tête d'arbre signée (INT-ANC) | Ed25519 (`node:crypto`, `sign(null, …)`) ; vérification Rust `ed25519-dalek` 2.1.1 | `packages/chain/src/sth.ts`, `tools/verifier` | Clé de journal : configuration ; production en HSM (D5, SEC-CRY-003) | **Élevée** (signature à courbe elliptique : à migrer, ex. ML-DSA) |
| Horodatage (RFC 3161) | Empreinte SHA-256, nonce 16 octets aléatoires | `packages/chain/src/tsa.ts` | Certificat de l'autorité d'horodatage (externe) | Dépend de l'autorité |
| Instructions de sortie de fonds (règlement, remboursement, virement C) | Ed25519 sur document canonique | `settlement/execution.store.ts`, `refund.store.ts`, `beneficiary-payout.store.ts` | `platformSigningKey` (configuration ; HSM en production, D5) | **Élevée** |
| Signature de transaction par l'appareil du client (SEC-AUTH-002) | Ed25519 (clé publique SPKI enregistrée) | `agreements/agreement.store.ts`, `identity/domain.ts` | Clé privée dans l'appareil (Keystore / Secure Enclave) | **Élevée** |
| Authentification du personnel et des partenaires (SEC-AUTH-004/006) | WebAuthn : ES256 (ECDSA P-256 + SHA-256) ou EdDSA (Ed25519) ; UP et UV exigés | `admin/webauthn.ts` (partagé par `workflows/partner-auth.ts`) | Clé de l'authentificateur matériel | **Élevée** (dépend de l'évolution FIDO) |
| PIN client (SEC-AUTH-003) | Argon2id, 19 456 Kio, 2 itérations, parallélisme 1, poivre secret | `identity/domain.ts` (`@node-rs/argon2`) | Poivre PIN : configuration (KMS/HSM en production) | Faible |
| Preuve OTP, code de remise (D45), signature des webhooks prestataires | HMAC-SHA-256 poivré ou à secret partagé, comparaison en temps constant | `identity/domain.ts`, `settlement/handover-code.ts`, `payments/domain.ts` | Poivres et secrets : configuration | Faible |
| Jetons de session (client, personnel, partenaire), jetons d'enrôlement | 32 octets aléatoires (`randomBytes`), seule l'empreinte SHA-256 est conservée | `identity/`, `admin/staff.store.ts`, `catalog/partner-user.store.ts` | — | Faible |
| Identifiants (UUID v7), défis WebAuthn, nonces | `randomBytes` / `randomUUID` (générateur cryptographique) | `ledger/domain.ts`, stores | — | — |
| Empreinte des pièces du bénéficiaire (D48) | SHA-256 calculé dans le navigateur (`crypto.subtle`) | `apps/web-client/src/components/beneficiary-actions.tsx` | — | Faible |
| Liste ONU importée (D66) | SHA-256 du fichier (unicité de l'import) | `kyc/sanctions.store.ts` | — | Faible |
| Transport (SEC-CRY-001) | TLS 1.3 attendu en exploitation | Hors code (infrastructure, ADR-0004) | Certificats : à décider | Échange de clés à migrer (ML-KEM hybride) |
| Chiffrement au repos des champs sensibles (SEC-CRY-002) | **Non implémenté** : aucune pièce d'identité n'est stockée (références opaques seulement) ; le nom légal (D68) est en clair en base | — | KMS/HSM à décider | — |

## Contrôles automatiques

- `tools/crypto-randomness.test.ts` (SEC-CRY-005) : aucun `Math.random` dans le code de production.
- `pnpm verify:ledger` : recalcul indépendant (Rust) du chaînage, des arbres et des signatures.

## Points ouverts

- Emplacement des clés de production (HSM/KMS), rotation annuelle et clé racine hors ligne (SEC-CRY-003, D5).
- Chiffrement par enveloppe du nom légal du client et des futurs champs sensibles (SEC-CRY-002).
- Plan de migration post-quantique des signatures Ed25519/ECDSA (journal, instructions, appareils, WebAuthn).
