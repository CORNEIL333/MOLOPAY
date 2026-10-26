# Cahier des charges — 00 · Sommaire et référentiel normatif

> Version 1.0 · 26 octobre 2026 · Structure inspirée d'ISO/IEC/IEEE 29148 (ingénierie des exigences) : spécification des besoins des parties prenantes (StRS) → spécification système/logiciel (SRS).

## 1. Objet et périmètre

Le présent cahier des charges (CDC) spécifie la plateforme d'achat planifié : application client (Android, iOS, web léger, USSD), portail partenaire, back-office interne, API et socle financier. Il couvre **tout le périmètre de lancement** **[Décision du 21/10/2026]** : modèles A, B, C ; quatre univers ; Yaoundé et Douala.

**Hors périmètre de la plateforme** (assuré par des tiers agréés, contractualisés) : la détention des fonds clients (établissement de cantonnement), la décision d'octroi et le portage du crédit du modèle B (financeur), l'exécution des paiements mobile money (agrégateur), l'émission de monnaie électronique.

## 2. Sommaire du CDC

| Fichier | Contenu |
|---|---|
| `CDC_00` | Référentiel normatif, conventions, parties prenantes |
| `CDC_01` | Exigences fonctionnelles |
| `CDC_02` | Exigences non fonctionnelles (qualité ISO/IEC 25010) |
| `CDC_03` | Sécurité |
| `CDC_04` | Intégrité transactionnelle (grand livre, chaîne de hachage, ancrage) |
| `CDC_05` | Architecture et données |
| `CDC_06` | Conformité réglementaire |
| `CDC_07` | Vérification et recette |
| `CDC_08` | Exploitation et continuité |

## 3. Conventions d'écriture des exigences

### 3.1 Mots-clés normatifs

Les mots-clés suivent la RFC 2119 / RFC 8174, en français :

| Mot-clé | Équivalent | Sens |
|---|---|---|
| **DOIT** / **NE DOIT PAS** | MUST / MUST NOT | Obligation absolue ; un écart bloque la recette |
| **DEVRAIT** / **NE DEVRAIT PAS** | SHOULD / SHOULD NOT | Recommandé ; tout écart est justifié par écrit dans un ADR |
| **PEUT** | MAY | Optionnel |

### 3.2 Identifiants

`<Famille>-<Domaine>-<NNN>`, par exemple `F-PAY-004` (fonctionnelle, paiements), `NF-PERF-002`, `SEC-AUTH-010`, `INT-LED-003`, `REG-LBC-002`. Un identifiant n'est **jamais réutilisé**.

### 3.3 Attributs d'une exigence (ISO/IEC/IEEE 29148)

Chaque exigence est : nécessaire, non ambiguë, vérifiable, cohérente, traçable. Elle porte : identifiant, énoncé, justification, **critère d'acceptation vérifiable**, méthode de vérification (Test, Analyse, Inspection, Démonstration), source (partie prenante ou norme), criticité (Critique / Haute / Normale), statut (Proposée / Approuvée / Implémentée / Vérifiée / Retirée).

**Priorité :** toutes les exigences de ce CDC sont **requises au lancement**. La criticité ne sert qu'à ordonner le travail et la profondeur de vérification, jamais à reporter une exigence.

### 3.4 Critères d'acceptation

Rédigés au format *Étant donné / Quand / Alors* (Gherkin) lorsqu'ils portent sur un comportement, et transformés en tests automatisés (voir `CDC_07`).

## 4. Parties prenantes

| Partie prenante | Intérêts principaux |
|---|---|
| Client particulier | Payer sans dette, ne pas perdre son argent, être servi vite |
| Client diaspora | Financer un proche avec preuve d'usage |
| Marchand / bénéficiaire | Vendre plus, être réglé sûrement et vite |
| Établissement de cantonnement | Fonds traçables, rapprochement quotidien, conformité LBC/FT |
| Financeur (modèle B) | Dossiers structurés, décision propre, recouvrement responsable |
| Agrégateur de paiement | Intégration conforme, webhooks fiables |
| Régulateurs (BEAC, COBAC, ministère des Finances, ANIF, autorité de protection des données) | Conformité, traçabilité, protection du public |
| Fondateur / aVIRA | Viabilité, réputation, maîtrise du risque |
| Équipe interne (opérations, finance, conformité, support) | Outils fiables, séparation des tâches |
| Agents IA de développement | Instructions précises, périmètre sûr (voir `03_agents_ia/`) |

## 5. Référentiel normatif

Versions vérifiées le **26 octobre 2026** sauf mention « à confirmer ». Les obligations légales (section 5.1) priment sur les normes volontaires.

### 5.1 Droit applicable (obligatoire)

| Texte | Objet | Application |
|---|---|---|
| Règlement n° 04/18/CEMAC/UMAC/COBAC du 21 déc. 2018 | Services de paiement dans la CEMAC | Qualification des flux, adossement à un établissement agréé |
| Règlement n° 03/16/CEMAC/UMAC/CM du 21 déc. 2016 | Systèmes, moyens et incidents de paiement ; monnaie électronique | Pas d'émission de monnaie électronique par la plateforme |
| Règlement n° 01/17/CEMAC/UMAC/COBAC | Activité de microfinance | Cadre des EMF partenaires |
| Règlement n° 01/CEMAC/UMAC/CM du 11 avril 2016 (révision validée par la BEAC, numéro du texte révisé **à confirmer**) | Prévention et répression du blanchiment, du financement du terrorisme et de la prolifération | KYC, vigilance, déclarations de soupçon via le partenaire assujetti |
| Règlement COBAC R-2023/01 (en vigueur au 1er juillet 2024 pour les acteurs bancaires) | Diligences LBC/FT des assujettis | Exigences reprises contractuellement par les partenaires |
| Loi n° 2024/017 du 23 déc. 2024 (en vigueur au 23 juin 2026) | Protection des données à caractère personnel | Registre, bases légales, droits, notification de violation, transferts hors Cameroun |
| Loi n° 2010/012 du 21 déc. 2010 | Cybersécurité et cybercriminalité | Obligations de sécurité, preuve électronique |
| Loi de finances 2025 | Droit de 4 FCFA par transaction mobile money ; taxe sur jeux de hasard | Modèle économique ; interdiction des mécaniques de type loterie |
| Acte uniforme OHADA (sociétés commerciales, droit commercial général, sûretés) | Constitution, contrats, garanties | Structure juridique, contrats partenaires |

### 5.2 Sécurité de l'information et risques

| Norme | Version | Usage dans le CDC |
|---|---|---|
| ISO/IEC 27001 | 2022 | Système de management de la sécurité (SMSI) ; certification visée à terme |
| ISO/IEC 27002 | 2022 | Catalogue de mesures (93 mesures, 4 thèmes) |
| ISO/IEC 27701 | à confirmer (2019 ou révision 2025) | Extension vie privée |
| ISO 31000 | 2018 | Méthode de gestion des risques |
| ISO 22301 | 2019 | Continuité d'activité |
| NIST Cybersecurity Framework | 2.0 (2024) | Gouverner, Identifier, Protéger, Détecter, Répondre, Rétablir |
| NIST SP 800-61 | Rév. 3 (à confirmer) | Gestion des incidents |
| NIST SP 800-63 | Rév. 4 (à confirmer) | Identité numérique, niveaux d'assurance |
| PCI DSS | v4.0.1 | **Hors périmètre direct** : aucune donnée de carte n'est saisie ni stockée par la plateforme ; paiement carte uniquement via page hébergée de l'agrégateur |

### 5.3 Sécurité applicative et chaîne logicielle

| Norme | Version | Usage |
|---|---|---|
| OWASP ASVS | **5.0.0 (mai 2025)** | Niveau 3 pour grand livre, paiements, authentification, back-office ; niveau 2 pour le reste |
| OWASP MASVS + MASTG + MASWE | MASVS v2 ; **MASTG v2.0 (juin 2026)** ; **MASWE v1.0 (août 2026)** | Applications mobiles : MASVS-L2 + MASVS-R (résilience) |
| OWASP Top 10 (web) et API Security Top 10 | Dernières éditions | Sensibilisation, revue |
| NIST SP 800-218 (SSDF) | **v1.1 (finale) ; v1.2 en projet public (déc. 2025)** | Pratiques de développement sécurisé |
| NIST SP 800-218A | Finale (juillet 2024) | Développement assisté par IA générative |
| SLSA | v1.x | Provenance des builds, niveau visé : Build L3 |
| CycloneDX | Dernière version | SBOM de chaque livrable |
| OpenSSF Scorecard | — | Hygiène du dépôt |

### 5.4 Agents IA et gouvernance de l'IA

| Référence | Version | Usage |
|---|---|---|
| AGENTS.md | Standard ouvert, stewardé par l'Agentic AI Foundation (Linux Foundation) depuis déc. 2025 | Format du fichier d'instructions agents |
| OWASP Top 10 for Agentic Applications | **2026 (publié le 9 déc. 2025)** | Risques ASI01–ASI10 et parades (voir `COLLABORATION_ET_GARDE_FOUS.md`) |
| OWASP Top 10 for LLM Applications | 2025 | Injection de prompt, fuite de données, etc. |
| ISO/IEC 42001 | 2023 | Système de management de l'IA (référence de bonnes pratiques) |
| NIST AI RMF | 1.0 | Gestion des risques de l'IA |

### 5.5 Intégrité, cryptographie et données

| Norme | Usage |
|---|---|
| FIPS 180-4 (SHA-2), FIPS 186-5 (signatures, Ed25519) | Empreintes et signatures du grand livre |
| FIPS 140-3 | Modules cryptographiques (HSM/KMS) pour les clés de signature et de chiffrement |
| RFC 8446 (TLS 1.3) | Transport |
| RFC 8785 (JSON Canonicalization Scheme) | Sérialisation déterministe avant hachage |
| RFC 6962 / RFC 9162 (arbres de Merkle, Certificate Transparency) | Preuves d'inclusion et de cohérence |
| RFC 3161 | Horodatage par autorité tierce |
| RFC 9562 | UUID v7 (identifiants ordonnés dans le temps) |
| RFC 9457 | Format d'erreur des API (Problem Details) |
| ISO 4217 | Devise XAF, 0 décimale |
| ISO 20022 | Vocabulaire des messages de paiement (alignement des champs, à terme échanges bancaires) |
| ISO 8601 | Dates et heures (UTC en stockage, Africa/Douala à l'affichage) |
| E.164 | Numéros de téléphone |

### 5.6 Qualité, accessibilité, ingénierie

| Norme | Usage |
|---|---|
| ISO/IEC/IEEE 29148:2018 | Ingénierie des exigences (ce CDC) |
| ISO/IEC 25010:2023 | Modèle de qualité produit (`CDC_02`) |
| ISO/IEC/IEEE 12207:2017 | Processus du cycle de vie logiciel |
| ISO/IEC/IEEE 42010:2022 | Description d'architecture ; modèle C4 pour les vues |
| WCAG 2.2, niveau AA | Accessibilité des interfaces web et mobiles |
| OpenAPI 3.1 | Contrat des API |
| Semantic Versioning 2.0, Conventional Commits 1.0 | Versions et messages de commit |

## 6. Traçabilité

Chaque exigence de `CDC_01` à `CDC_08` est reliée à sa source, à sa norme et à son test dans `04_annexes/matrice_de_tracabilite.md`. Une exigence sans test associé n'est pas « Vérifiée ».

## 7. Gestion des changements

Toute modification d'exigence passe par une PR qui met à jour : l'exigence, la matrice de traçabilité, les tests concernés et, si l'architecture change, un ADR. Les exigences de sécurité (`SEC-*`) et d'intégrité (`INT-*`) exigent l'approbation explicite du fondateur.
