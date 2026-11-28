# ADR-0007 · Authentification du personnel interne par WebAuthn

- **Statut :** **Proposé** par l'agent (11 novembre 2026), en attente d'approbation du fondateur. Le code avance selon le régime sprint (option la plus prudente et réversible) ; rien n'est déployé.
- **Date :** 11 novembre 2026
- **Décideur :** Fondateur

## Contexte

Tous les flux du back-office existent côté serveur, avec leurs contrôles de rôles (`assertAuthorized`) et le maker-checker : remboursements, virements, règlements, litiges, classement des écarts, alertes de fraude. Ils n'ont aucune route HTTP, faute d'authentification du personnel (lot 21, fiche des points ouverts).

Exigences : SEC-AUTH-004 demande une MFA résistante à l'hameçonnage (FIDO2/WebAuthn, clés matérielles), au niveau AAL3 pour Finance, Conformité et Administrateur. SEC-AUTH-005 fixe des sessions back-office expirées après 15 min d'inactivité. SEC-AUTHZ-003 impose le maker-checker sur l'octroi de rôles internes. Un OTP SMS ou un TOTP ne répond pas à SEC-AUTH-004.

## Décision proposée

1. **WebAuthn vérifié par l'API elle-même** (`node:crypto`, aucune dépendance ajoutée). Algorithmes ES256 et EdDSA ; présence (UP) **et** vérification de l'utilisateur (UV) exigées ; défi aléatoire à usage unique ; origine et identifiant de partie (RP ID) en liste blanche ; compteur de signature strictement croissant quand l'authentificateur en fournit un (clonage détecté).
2. **Inscription d'une clé** : réservée à un compte personnel créé en maker-checker (SEC-AUTHZ-003). La clé publique est reçue en SPKI (`getPublicKey()` de WebAuthn niveau 2) ; l'identifiant de la clé est vérifié dans les données d'authentificateur.
3. **Sessions courtes** : 15 min d'inactivité au plus, révocables, liées à la clé utilisée.
4. **Rôles internes en base**, attribués en maker-checker ; l'`AdminPrincipal` d'une requête est reconstruit côté serveur depuis la session, jamais fourni par le client.

## Points ouverts

- **Attestation matérielle (AAL3)** : la vérification d'attestation (liste des modèles de clés autorisés, FIDO MDS) n'est pas faite dans la première tranche ; attestation « none » acceptée provisoirement. À trancher : liste des modèles de clés matérielles.
- **Réseau isolé** du back-office (infrastructure, ADR-0004).
- **Alternative** : un fournisseur d'identité externe (OIDC) imposant WebAuthn. Ce choix remplacerait les points 1 à 3 ; le point 4 resterait.

## Conséquences

- Réversible : les flux métier ne dépendent que d'`AdminPrincipal` ; la source de l'authentification peut changer sans toucher aux flux.
- Code de sécurité sensible (L3) : une revue humaine est indispensable avant toute mise en service.
