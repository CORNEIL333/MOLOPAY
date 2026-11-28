# Fiche : points ouverts au 10 novembre 2026

> Fiche de décision pour le fondateur. Pour chaque point : **situation** (ce qui est vrai aujourd'hui dans le dépôt), **contexte** (pourquoi la question se pose, sources), **possibilités** (options, avec la recommandation en premier).
> Détail complet : `docs/journal/DECISIONS_EN_ATTENTE.md` (D26, D30, D32, D38).
> Branche : `sprint/integration-t01urw`. Rien de ce qui suit n'est en production.

| # | Point | Bloque | Qui décide |
|---|---|---|---|
| 1 | D26 · Approbation des plans de paiement | Persistance des plans, lots 11–13 | Fondateur (ADR) |
| 2 | D32 · Routes des objectifs (modèle C / accords) | Toute route HTTP d'accord | Fondateur |
| 3 | D38 · Valeurs des quotas | 4 routes compte (répondent 503) | Fondateur + sécurité |
| 4 | Dépôt GitHub public | Confidentialité du code et des docs | Fondateur (action manuelle) |
| 5 | D30 · GitHub Actions bloquées | CI automatique sur GitHub | Fondateur (facturation) |
| 6 | Revue indépendante et humaine | Fusion de la tranche quotas | Vérificateur + humain |

---

## 1. D26 · Circuit d'approbation des plans de paiement

**Situation**
- Le code métier est prêt : `activatePartnerPlan` et sa journalisation `activatePartnerPlanAudited` (`CATALOG_ACTION`).
- Les plans **ne sont pas enregistrés en base** : un plan reste une donnée fournie par le serveur appelant. Aucun plan ne peut être approuvé aujourd'hui.

**Contexte**
- F-CAT-002 exige des plans « approuvés par la plateforme et, pour B, par le financeur ».
- Aucune source ne précise :
  - le **type de demande maker-checker** (la liste `APPROVAL_KINDS` ne contient pas `PAYMENT_PLAN`) ;
  - le **contenu d'un plan** (rythme, minimum, durée, frais) ;
  - la **preuve d'approbation du financeur** pour le modèle B (invariant I-10 : la plateforme n'octroie jamais de crédit).
- Lié à D27 : l'unité de durée n'est pas fixée (le domaine a retenu des **jours**, le contrat OpenAPI des **mois**).

**Possibilités**
1. **Recommandé.** Ajouter un type `PAYMENT_PLAN` par ADR. Le plan est défini par la plateforme : modèle, rythme, montant minimum, durée max de 1 à 36 mois, **sans frais**. FINANCE prépare, COMPLIANCE approuve (I-7). Le modèle B reste refusé jusqu'au lot 13 (financeur).
   - Avantage : circuit traçable et propre. Inconvénient : demande un ADR et une migration (module `admin`).
2. Réutiliser le type existant `FINANCIAL_SETTING`.
   - Avantage : pas de nouveau type. Inconvénient : mélange réglages et plans, audit moins lisible.
3. Laisser ouvert.
   - Conséquence : pas de plans en base, donc pas de paiements réels sur accords (lot 11) ni de règlements (lot 12).

**À trancher en même temps :** l'unité de durée (mois recommandés, comme le devis) et, pour B, la forme de la référence du financeur.

---

## 2. D32 · Routes HTTP des objectifs / accords

**Situation**
- **Aucune route d'accord ou d'objectif n'est exposée.**
- Le socle HTTP manquant à l'époque existe maintenant (`apps/api/src/http/`) : connexion base, garde de session, garde d'origine, clé d'idempotence, erreurs RFC 9457, quotas.

**Contexte : conflit entre deux sources**
- Contrat `packages/contracts/openapi.json` : `Goal.status` = `ACTIVE | LOCKED | COMPLETED | CANCELLED | FROZEN` ; `POST /v1/goals` crée l'objectif **en un seul appel**, sans signature d'appareil ni PIN ; durée en mois (1–36).
- `CDC_05` § 5.2 : états `DRAFT → ACTIVE → FUNDED → …`, et « `LOCKED` est un attribut, pas un état ».
- INT-NR-001 et SEC-AUTH-002 exigent **signature d'appareil + PIN** pour accepter ou annuler.
- Règle d'AGENTS.md : en cas de conflit entre sources, l'agent n'arbitre pas.

**Possibilités**
1. **Recommandé.** Aligner le contrat sur CDC_05 :
   - statuts du § 5.2 + booléen `locked` ;
   - création en deux temps : `POST /v1/goals` crée un **brouillon**, puis `POST /v1/goals/{goalId}/activation` avec signature + PIN (idem `/cancellation`, `/lock`) ;
   - `GoalRequest {offerId, planId, durationMonths}` ; la réponse ne contient que des données qui existent déjà.
2. Garder le contrat actuel tel quel.
   - Inconvénient : contredit CDC_05 et les exigences de non-répudiation (INT-NR-001). **Déconseillé.**
3. Reporter.
   - Conséquence : l'app ne peut pas créer d'objectif ; les tests restent au niveau domaine et base.

**Dépend de D26** : un objectif référence un plan approuvé.

---

## 3. D38 · Valeurs des quotas (SEC-API-003)

**Situation**
- Mécanisme livré (migration `0025_identity_customer_quota.sql`) sur 4 routes :
  - `GET /v1/me/security` (`SECURITY_READ`) ;
  - `POST /v1/me/security/revoke-other-sessions` (`REVOKE_OTHERS`) ;
  - lecture et dépôt des demandes de droits sur les données (`DATA_RIGHTS_READ`, `DATA_RIGHTS_SUBMIT`).
- **Aucune valeur d'exploitation n'est insérée** : sans politique, ces routes répondent **503**. Seuls les tests posent des seuils.
- Une politique ne se modifie pas : une nouvelle version ouvre de nouveaux budgets.

**Contexte**
- SEC-API-003 demande des limites de débit, mais aucune source ne donne de chiffres. Inventer des valeurs est interdit (AGENTS.md § 8).
- Limites actuelles :
  - seules les dimensions compte et appareil sont couvertes (pas l'IP, le numéro de téléphone ni le partenaire) ;
  - les compteurs ne sont jamais purgés ;
  - le coût sous charge n'est pas mesuré.

**Possibilités**
1. **Recommandé.** Le fondateur fixe, pour chaque action : une fenêtre (secondes), un plafond par compte, un plafond par appareil. L'insertion passe par une migration revue, pas par une route d'administration.
   - Exemple de forme à compléter (pas une recommandation de chiffres) : `SECURITY_READ : fenêtre ___ s, compte ___, appareil ___`.
2. Ajouter ensuite les dimensions IP et numéro de téléphone (piste de travail indépendante), puis une purge des compteurs expirés.
3. Retirer le décorateur `CustomerQuota` d'une route pour la rouvrir sans limite.
   - **Déconseillé** : affaiblit SEC-API-003.

---

## 4. Dépôt GitHub public

**Situation**
- `github.com/CORNEIL333/MOLOPAY` est **public**.
- Il contient le code, les cahiers des charges, les décisions et les journaux. Le scan de secrets passe : aucun secret détecté.

**Contexte**
- Le code d'un système financier, le modèle de menaces et les suites d'attaque (`tests/attack/`) sont lisibles par tous.
- AGENTS.md § 12 : une faille de sécurité ne se publie pas dans un espace public.
- Aucun agent ne peut changer la visibilité du dépôt : c'est une action manuelle du propriétaire.

**Possibilités**
1. **Recommandé.** Passer le dépôt en privé : *Settings → General → Danger Zone → Change repository visibility → Private*. Les branches et l'historique sont conservés.
2. Le laisser public en connaissance de cause (par exemple pour une démonstration).
   - Il faut alors considérer tout le contenu comme déjà publié, y compris l'historique.

**Point d'attention** : sur un compte gratuit, les minutes GitHub Actions sont illimitées pour un dépôt public mais plafonnées pour un dépôt privé. À vérifier sur la page de facturation GitHub (voir point 5).

---

## 5. D30 · GitHub Actions bloquées (facturation)

**Situation**
- Les jobs de `.github/workflows/ci.yml` ne démarrent pas : « account is locked due to a billing issue ».
- Le workflow n'est pas modifié ; il reprendra seul au déblocage.
- Remplacement en place : `tools/ci-local.ts` (`pnpm ci:local`) rejoue les mêmes étapes, sans en sauter.
- Passage complet du 10 novembre en session cloud : 1019 unitaires, 343 PostgreSQL, 38 attaques, 1 E2E, `verify:ledger` OK, SCA OK.

**Contexte**
- Sans CI sur GitHub, rien n'empêche automatiquement de fusionner du code rouge. La preuve repose sur les sorties jointes à chaque PR.

**Possibilités**
1. **Recommandé (sans budget).** Continuer avec `ci:local`, sortie jointe à chaque PR. Ne fusionner qu'avec cette preuve et une revue humaine.
2. Régler le blocage de facturation (*Settings → Billing and plans*). Souvent un moyen de paiement à mettre à jour, même pour un usage gratuit. C'est à vérifier sur la page, je ne peux pas le confirmer.
3. Utiliser un exécuteur auto-hébergé (*self-hosted runner*) sur un poste du fondateur.
   - Demande une machine allumée, et engage la sécurité de ce poste.

---

## 6. Revue indépendante (quotas) et revue humaine avant fusion

**Situation**
- La tranche quotas (migration 0025, `apps/api/src/http/customer-quota.ts`, décorateur sur 4 routes) est commitée et testée. Elle n'a **pas** été relue par un vérificateur indépendant.
- La correction D37 (rotation de session) demande aussi cette revue.
- Rien n'est fusionné dans `main` / `master`.

**Contexte**
- AGENTS.md § 10–11 : un implémenteur ne relit jamais son propre travail. Le vérificateur travaille dans une session distincte, sans le contexte de l'implémenteur.
- Régime sprint (§ 13) : la revue humaine a lieu **avant la fusion**, pas avant le code.
- La tranche touche la sécurité (SEC-API-003) : niveau de risque L2, donc approbation humaine obligatoire.

**Possibilités**
1. **Recommandé.** Lancer une **nouvelle session** Claude Code avec le rôle vérificateur, sur la branche, avec pour consigne :
   - relire 0025, `customer-quota.ts` et la correction D37 ;
   - rejouer `ci:local` ;
   - chercher les tests verts pour la mauvaise raison ;
   - ne rien corriger, seulement rapporter.
   
   Ensuite, ouvrir une PR `sprint/integration-t01urw → sprint/integration` avec le gabarit § 9, que le fondateur relit et fusionne lui-même.
2. Revue humaine seule, sans vérificateur IA.
   - Possible, mais plus longue, et ne remplace pas l'exigence du § 10.
3. Laisser la tranche non fusionnée tant que D38 n'est pas tranché.
   - Sans valeurs, les routes répondent 503 de toute façon ; la fusion n'apporte rien d'utilisable avant D38.

---

## Ordre suggéré
1. Passer le dépôt en privé (point 4), en vérifiant l'impact facturation (point 5).
2. Trancher D26, puis D32 (D32 en dépend).
3. Donner les valeurs de D38.
4. Revue indépendante, puis PR vers `sprint/integration` et revue humaine.
