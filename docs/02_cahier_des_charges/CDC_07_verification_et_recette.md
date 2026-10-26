# Cahier des charges — 07 · Vérification et recette

> Version 1.0 · 26 octobre 2026

## 1. Principes

1. **Un test qui passe pour la mauvaise raison est un échec.** Chaque test négatif DOIT vérifier le motif exact du refus (code d'erreur métier attendu), pas seulement qu'il y a eu une erreur.
2. **Tester l'attaque, pas seulement le chemin heureux.** Chaque règle de sécurité a ses tests « refuse » avec un acteur légitime par ailleurs (même partenaire, rôle voisin).
3. **Les tests sont écrits avant ou avec le code**, jamais après coup pour « valider » un comportement existant.
4. **Zéro simulation** : aucun faux prestataire ni bouchon dans les tests d'intégration ; base PostgreSQL réelle, API réelles en environnement de test officiel.
5. **Aucun test n'est désactivé** sans ADR ou ticket ouvert, daté et assigné.

## 2. Pyramide de tests

| Niveau | Contenu | Outils indicatifs | Seuil |
|---|---|---|---|
| Unitaires | Calculs, règles, transitions | Jest/Vitest, Dart test | Voir NF-MNT-002 |
| Propriétés | Invariants financiers sur données aléatoires | fast-check | 10⁶ cas en nuit, 10⁴ en CI |
| Intégration base | Contraintes SQL, ajout seul, équilibre, unicités | Testcontainers PostgreSQL | 100 % des contraintes `INT-*` |
| Contrat | API vs OpenAPI ; intégrations testées contre les environnements de test officiels des prestataires (aucun simulateur) | Schemathesis | Toutes les routes |
| Bout en bout | Parcours A, B, C ; portail ; back-office | Playwright, Flutter integration_test | Tous les parcours `CDC_01` |
| Sécurité | SAST, SCA, secrets, DAST, MASTG | Semgrep, OSV, gitleaks, ZAP, MobSF | 0 critique/haute ouverte |
| Charge | NF-PERF | k6 | Cibles × 3 |
| Chaos | Prestataire lent, coupé, messages dupliqués/désordonnés | Injecteur de fautes | Aucune perte, aucun double crédit |
| Mutation | Module `ledger` | Stryker | Score ≥ 80 % |

## 3. Suites d'attaque obligatoires

| Suite | Cas minimaux |
|---|---|
| Grand livre | UPDATE/DELETE par chaque rôle → refus base ; écriture déséquilibrée → refus à la validation ; trou de séquence impossible ; altération d'une ligne en base de test → détectée par le vérificateur indépendant |
| Paiements | Webhook sans signature, signature fausse, horodatage expiré, nonce rejoué, montant différent de l'API, devise différente, `provider_tx_id` déjà vu, message `FAILED` après `CONFIRMED` → aucun effet comptable |
| Autorisations | Matrice complète rôle × action ; accès inter-partenaires ; vendeur → règlement ; support → données KYC sans motif |
| Maker-checker | Même identité prépare et approuve ; approbation après expiration ; contournement par appel API direct |
| Identité | Bruteforce PIN ; rafale d'OTP ; récupération de compte sans KYC ; appareil non attesté ; SIM changée |
| USSD | Coupure à chaque étape ; rejeu de session ; saisies hors bornes |
| Concurrence | 1 000 versements simultanés sur un objectif ; double remise simultanée du même code |
| Agents IA | Instruction injectée dans un fichier de données, un ticket ou une réponse d'outil → ignorée et signalée (voir `COLLABORATION_ET_GARDE_FOUS.md`) |

## 4. Recette

| Étape | Contenu | Validation |
|---|---|---|
| Recette technique | Tous les tests verts sur préproduction ; vérificateur indépendant OK sur 7 jours de données synthétiques | Agent vérificateur + fondateur |
| Recette fonctionnelle | Scénarios `CDC_01` joués par des humains, en français et en anglais, sur appareils d'entrée de gamme | Fondateur + 5 utilisateurs tests |
| Recette sécurité | Rapport de test d'intrusion indépendant ; failles critiques et hautes corrigées et re-testées | Fondateur |
| Recette partenaires | Établissement de cantonnement et financeur : flux de test, réception des têtes signées, exports | Partenaires (procès-verbal signé) |
| Test fermé | 50 clients réels, catalogue réduit, montants plafonnés | Indicateurs de l'étude MIT, étape 23 |
| Exercice de crise | Incident simulé (fuite, panne prestataire, rupture de chaîne) | Procès-verbal |

## 5. Preuves

Chaque exigence vérifiée renvoie à une preuve : identifiant du test, journal d'exécution CI horodaté, rapport ou procès-verbal. Les preuves sont archivées par version livrée et référencées dans la matrice de traçabilité.
