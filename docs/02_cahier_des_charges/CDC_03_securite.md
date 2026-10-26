# Cahier des charges — 03 · Sécurité

> Version 1.0 · 26 octobre 2026 · Référentiels : OWASP ASVS 5.0.0, OWASP MASVS v2 / MASTG v2.0 / MASWE v1.0, NIST SSDF (SP 800-218), ISO/IEC 27001/27002:2022, NIST CSF 2.0.

## 1. Principes

1. **Le serveur est le périmètre.** L'interface n'est jamais une protection : toute règle d'autorisation et toute règle métier financière est vérifiée côté serveur, et les écritures critiques sont en plus contraintes **par la base de données elle-même**.
2. **Refus par défaut.** Toute route, tout champ modifiable, toute permission est fermée tant qu'elle n'est pas explicitement autorisée (listes blanches, jamais listes noires).
3. **Moindre privilège et séparation des tâches.** Nul ne prépare et n'approuve la même opération sensible.
4. **Défense en profondeur.** Chaque contrôle critique a au moins deux couches indépendantes (application + base ; signature + rapprochement).
5. **Ce qui est déployé se lit, il ne se déduit pas.** L'état réel de la production se vérifie par lecture directe, jamais d'après un message de déploiement.
6. **Sécurité par construction, pas par mémoire.** Une protection qui dépend de « penser à » un cas est remplacée par une contrainte structurelle.

## 2. Niveaux de vérification exigés

| Composant | OWASP ASVS 5.0 | OWASP MASVS |
|---|---|---|
| Grand livre, paiements, règlements, authentification, back-office | **Niveau 3** | — |
| Catalogue, portail partenaire (hors règlements), contenus | Niveau 2 | — |
| Application client Android/iOS | Niveau 2 pour les API appelées | **MASVS-L2 + MASVS-R** (résilience) |

La conformité est démontrée par une liste de contrôle ASVS/MASVS renseignée, exigence par exigence, avec preuve (test, revue, rapport de pentest) dans `04_annexes/matrice_de_tracabilite.md`.

## 3. Modèle de menaces

Méthode **STRIDE** par composant et par flux, complétée par **LINDDUN** pour la vie privée. Le modèle DOIT être mis à jour à chaque nouveau flux ou prestataire, et relu avant la porte de lancement.

| Menace (STRIDE) | Exemple ici | Parades principales |
|---|---|---|
| Usurpation (Spoofing) | Faux webhook « paiement confirmé » ; SIM swap | Signature HMAC + horodatage + nonce, mTLS si offert, re-vérification API ; liaison appareil + PIN, détection de changement de SIM via opérateur si disponible |
| Altération (Tampering) | Modification d'un solde en base par un administrateur | Grand livre en ajout seul imposé par la base, chaîne de hachage, ancrage externe (`CDC_04`) |
| Répudiation | Marchand qui nie une remise | Code de remise à usage unique, horodatage, journal signé |
| Divulgation | Fuite de pièces d'identité | Chiffrement par enveloppe, accès journalisé avec motif, minimisation, durée de conservation |
| Déni de service | Saturation USSD, rafale d'OTP | Limitation de débit par numéro, appareil et IP ; quotas d'OTP ; WAF |
| Élévation de privilège | Vendeur qui déclenche un règlement | RBAC + ABAC (partenaire, boutique), tests d'autorisation exhaustifs, champs modifiables en liste blanche |

## 4. Exigences

### 4.1 Authentification et sessions (SEC-AUTH)

| ID | Exigence |
|---|---|
| SEC-AUTH-001 | Clients : OTP par SMS à l'inscription et sur nouvel appareil ; ensuite PIN + appareil enregistré (clé asymétrique générée dans le Keystore/Secure Enclave). Niveau d'assurance visé équivalent AAL2 (NIST SP 800-63B). |
| SEC-AUTH-002 | Toute opération financière (versement à partir d'un solde, annulation, règlement C, changement de numéro) exige une signature de transaction par la clé de l'appareil après saisie du PIN. |
| SEC-AUTH-003 | PIN : 6 chiffres, refus des suites triviales, 5 essais puis blocage temporaire progressif ; jamais stocké en clair (dérivation Argon2id côté serveur avec sel et poivre en HSM/KMS). |
| SEC-AUTH-004 | Personnel interne et administrateurs : MFA résistante à l'hameçonnage (FIDO2/WebAuthn, clés matérielles) obligatoire ; AAL3 pour les rôles Finance, Conformité et Administrateur. |
| SEC-AUTH-005 | Sessions : jetons d'accès courts (≤ 15 min), rafraîchissement lié à l'appareil, révocation immédiate ; sessions back-office expirées après 15 min d'inactivité. |
| SEC-AUTH-006 | Partenaires : comptes nominatifs, MFA obligatoire pour le gérant, TOTP ou WebAuthn pour les vendeurs. |
| SEC-AUTH-007 | Récupération de compte : jamais par simple OTP sur un nouveau numéro ; exige KYC renforcé et délai de sécurité de 24 h pour les comptes ayant un solde. |

### 4.2 Autorisation (SEC-AUTHZ)

| ID | Exigence |
|---|---|
| SEC-AUTHZ-001 | Contrôle d'accès centralisé (politique déclarative), évalué côté serveur pour chaque requête ; RBAC (rôle) + ABAC (partenaire, boutique, ville, montant). |
| SEC-AUTHZ-002 | Les mises à jour d'entités n'acceptent que des champs explicitement autorisés par opération (liste blanche) ; tout autre champ est rejeté. |
| SEC-AUTHZ-003 | Maker-checker obligatoire pour : règlements et remboursements au-dessus du seuil, validation des partenaires et bénéficiaires, contre-passations, changements de paramètres financiers, octroi de rôles internes. Le système refuse qu'une même identité prépare et approuve. |
| SEC-AUTHZ-004 | Matrice d'autorisations testée de façon exhaustive : pour chaque rôle × chaque action, un test « autorisé » et un test « refusé ». |
| SEC-AUTHZ-005 | Accès « bris de glace » à la production : demande motivée, approbation par un second administrateur, durée limitée (≤ 2 h), enregistrement intégral de la session. |

### 4.3 Cryptographie et secrets (SEC-CRY)

| ID | Exigence |
|---|---|
| SEC-CRY-001 | TLS 1.3 obligatoire (TLS 1.2 toléré pour un prestataire qui l'impose, suites AEAD uniquement) ; HSTS ; épinglage de certificat dans l'application mobile avec rotation planifiée. |
| SEC-CRY-002 | Chiffrement au repos AES-256-GCM ; chiffrement par enveloppe des champs sensibles (pièces d'identité, numéros complets) avec clés gérées dans un KMS/HSM validé FIPS 140-3. |
| SEC-CRY-003 | Clés de signature du grand livre (Ed25519) et des instructions de règlement non exportables, détenues en HSM ; rotation annuelle documentée ; clé de racine hors ligne. |
| SEC-CRY-004 | Aucun secret dans le code, les images, les journaux ou l'application mobile ; coffre-fort de secrets ; analyse automatique des secrets à chaque commit (blocage du commit). |
| SEC-CRY-005 | Générateurs aléatoires cryptographiques uniquement (codes de remise, OTP, nonces). |
| SEC-CRY-006 | Inventaire cryptographique tenu à jour (algorithmes, longueurs, emplacements) pour préparer une migration post-quantique. |

### 4.4 API et intégrations (SEC-API)

| ID | Exigence |
|---|---|
| SEC-API-001 | Validation stricte des entrées par schéma (OpenAPI) ; rejet des champs inconnus. |
| SEC-API-002 | Webhooks entrants : signature HMAC-SHA256 vérifiée en temps constant, horodatage ± 5 min, nonce mémorisé contre le rejeu, liste blanche d'IP du prestataire si fournie ; puis confirmation par appel API sortant avant toute écriture. |
| SEC-API-003 | Limitation de débit et quotas par client, appareil, numéro, IP et partenaire ; protection contre l'énumération (réponses uniformes). |
| SEC-API-004 | Aucun identifiant séquentiel exposé ; UUID v7 côté API. |
| SEC-API-005 | En-têtes de sécurité web (CSP stricte, X-Content-Type-Options, Referrer-Policy, frame-ancestors none) sur portail et back-office. |

### 4.5 Application mobile (SEC-MOB) — MASVS v2

| ID | Exigence |
|---|---|
| SEC-MOB-001 | MASVS-STORAGE : aucune donnée sensible hors du stockage sécurisé de la plateforme ; pas de données sensibles dans les captures d'écran du sélecteur d'applications. |
| SEC-MOB-002 | MASVS-CRYPTO : clés d'appareil dans Android Keystore (StrongBox si disponible) / iOS Secure Enclave. |
| SEC-MOB-003 | MASVS-NETWORK : épinglage de certificat, refus du trafic en clair. |
| SEC-MOB-004 | MASVS-RESILIENCE : détection de root/jailbreak, d'instrumentation et d'émulateur ; attestation d'intégrité (Play Integrity, App Attest) vérifiée côté serveur ; en cas d'échec, opérations financières refusées et consultation autorisée. |
| SEC-MOB-005 | MASVS-CODE : dépendances analysées ; version minimale imposée par le serveur pour corriger rapidement une faille. |
| SEC-MOB-006 | MASVS-PRIVACY : permissions minimales ; aucune lecture de contacts, de SMS ou de journal d'appels ; aucun SDK publicitaire. |

### 4.6 Chaîne logicielle et développement (SEC-SDLC) — NIST SSDF

| ID | Exigence |
|---|---|
| SEC-SDLC-001 | Dépôt protégé : branche principale protégée, revue obligatoire, commits signés, historique linéaire. |
| SEC-SDLC-002 | Pipeline CI : tests, analyse statique (SAST), analyse des dépendances (SCA), analyse des secrets, analyse d'images, tests d'API dynamiques (DAST) en préproduction. Toute vulnérabilité critique ou haute bloque la fusion. |
| SEC-SDLC-003 | SBOM CycloneDX produit pour chaque livrable ; artefacts signés ; provenance SLSA Build L3. |
| SEC-SDLC-004 | Dépendances épinglées par empreinte ; mises à jour via PR automatisées relues ; délai de correction : critique ≤ 72 h, haute ≤ 14 j. |
| SEC-SDLC-005 | Code produit par des agents IA soumis aux mêmes contrôles, plus les règles de `03_agents_ia/COLLABORATION_ET_GARDE_FOUS.md` (SP 800-218A). |
| SEC-SDLC-006 | Tests d'intrusion par un tiers indépendant avant la porte de lancement (web, API, mobile, back-office, USSD), puis annuels et à chaque changement majeur ; correction des failles critiques et hautes avant ouverture. |
| SEC-SDLC-007 | Programme de divulgation responsable (`security.txt`, adresse dédiée) dès l'ouverture. |

### 4.7 Fraude (SEC-FRD)

| ID | Exigence |
|---|---|
| SEC-FRD-001 | Règles explicables (pas de score opaque au lancement) : vélocité de versements, multiples comptes par appareil, remises anormales par boutique, annulations répétées, changements de numéro suivis de retrait. |
| SEC-FRD-002 | Chaque alerte ouvre un dossier avec décision tracée (Conformité/Risque) ; aucune sanction automatique irréversible sans revue humaine. |
| SEC-FRD-003 | Collusion marchand–client : contrôle par échantillonnage des remises (preuve photo optionnelle, appel de vérification). |

### 4.8 Journalisation de sécurité (SEC-LOG)

| ID | Exigence |
|---|---|
| SEC-LOG-001 | Journal d'audit de sécurité (connexions, échecs, changements de droits, accès aux données sensibles, actions back-office) en ajout seul, chaîné par hachage comme le grand livre, conservé ≥ 10 ans **[Hypothèse, à aligner sur l'obligation légale applicable]**. |
| SEC-LOG-002 | Centralisation dans un outil de détection (SIEM) avec règles d'alerte ; revue hebdomadaire. |
| SEC-LOG-003 | Horloges synchronisées (NTP sécurisé) sur tous les composants. |

### 4.9 Réponse aux incidents (SEC-INC)

| ID | Exigence |
|---|---|
| SEC-INC-001 | Plan de réponse aux incidents (NIST SP 800-61) : rôles, astreinte, arbres de décision, modèles de communication. |
| SEC-INC-002 | Violation de données : notification à l'autorité de protection des données et aux personnes concernées dans les délais de la loi 2024/017 ; information des partenaires agréés selon les conventions. |
| SEC-INC-003 | Interrupteur d'arrêt des flux financiers sortants (règlements, remboursements), activable par deux personnes, sans couper la consultation. |
| SEC-INC-004 | Exercice de crise au moins semestriel, dont un avant la porte de lancement. |
