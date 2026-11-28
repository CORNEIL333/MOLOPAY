# Compte rendu des décisions — 10 novembre 2026

> **Mandat :** le fondateur a délégué à l'agent, le 10 novembre 2026, la décision de tous les points en attente, avec recherches approfondies.
> **Limites du mandat, appliquées à la lettre :**
> - aucune décision n'affaiblit un invariant d'`AGENTS.md` § 7, ni ne lève un interdit du § 8 ;
> - les choix qui engagent un tiers (agrégateur, financeur, établissement de cantonnement, juriste) sont **décidés en interne**, mais restent **à faire confirmer par ce tiers** : c'est signalé à chaque fois par « ⚖ À faire valider » ;
> - les chiffres réglementaires non trouvés dans un texte officiel sont présentés comme des **valeurs de départ prudentes**, jamais comme des obligations légales.
>
> Registre détaillé : `docs/journal/DECISIONS_EN_ATTENTE.md` (chaque point renvoie ici).

## Synthèse

| # | Sujet | Décision | Tiers à consulter |
|---|---|---|---|
| D26 | Approbation des plans | Nouveau type `PAYMENT_PLAN` : FINANCE prépare, COMPLIANCE approuve ; durée 1–36 mois ; aucun frais ; B fermé jusqu'au lot 13 | — |
| D27 | Annulation, durée, barème | CDC_05 prévaut (annulation depuis ACTIVE seulement) ; durée en **mois** ; barème unique 100 % sans frais | — |
| D29 | Bénéficiaires personnes physiques | Pièce d'identité + preuve du droit sur le bien + compte de règlement à leur nom ; NIU facultatif | ⚖ Juriste |
| D32 | Contrat des objectifs | Contrat aligné sur CDC_05 ; création en deux temps (brouillon, puis activation signée + PIN) | — |
| D38 | Quotas des routes compte | Valeurs fixées (tableau § D38) | — |
| D39 | Paiements | Agrégateurs présélectionnés : NotchPay, CinetPay ; espèces reportées ; reçus numérotés **par client** ; nonces conservés 90 jours | ⚖ Agrégateur (KYB, contrat) |
| D40 | Rapprochement | Relevés ISO 20022 / CSV ; relevé saisi en maker-checker FINANCE ; escalade direction + établissement | ⚖ Établissement de cantonnement |
| D41 | Réclamations | Alignement sur COBAC R-2020/06 : réponse sous 45 jours max (15 jours visés) ; médiateur CNEF | ⚖ Juriste |
| D42 | Comptes des partenaires (lot 12) | Identifiant comptable UUID v7 immuable attribué à la validation | — |
| D43 | Plafonds KYC | Valeurs de départ par niveau (tableau § D43), paramétrées et versionnées | ⚖ Établissement de cantonnement (assujetti LBC/FT) |
| D44 | Financeur modèle B | Critères de sélection fixés ; B reste fermé sans convention signée | ⚖ Financeur |
| D33/D34 | Rappels et notifications | 8 h–20 h (Douala), 1 rappel/jour/projet, 3/semaine/client ; 5 tentatives | — |
| D35/D36 | Déblocage, droits sur les données | Déblocage en maker-checker après vérification renforcée ; réponse aux demandes sous 30 jours | ⚖ Juriste (loi 2024/017) |
| D30, visibilité, revue | Outillage et gouvernance | CI locale obligatoire ; dépôt privé ; session vérificatrice distincte avant fusion | Action du fondateur |

---

## D26 · Circuit d'approbation des plans de paiement

**Question.** Quel type de demande maker-checker, quel contenu de plan, quelle preuve du financeur pour B ?

**Ce que disent les sources.** F-CAT-002 : un partenaire n'active que des plans « approuvés par la plateforme et, pour B, par le financeur ». CDC_05 § 4 : `PaymentPlan (id, model, rhythm, min_amount, max_duration, approved_by)`. I-7 : préparateur ≠ approbateur. I-10 : la plateforme n'octroie aucun crédit. Le contrat OpenAPI existant borne déjà la durée d'un devis à 1–36 mois (`QuoteRequest.durationMonths`).

**Décision.**
1. Nouveau type de demande `PAYMENT_PLAN` (ADR-0007 à rédiger), plutôt que de réutiliser `FINANCIAL_SETTING` : l'audit reste lisible et la matrice des rôles est explicite.
2. Contenu d'un plan, en liste blanche : `model` (A ou C ; B plus tard), `rhythm` (DAILY, WEEKLY, MONTHLY, FREE), `min_amount_xaf` (> 0), `max_duration_months` (1 à 36). **Aucun champ de frais ni de taux** : les modèles A et C sont sans frais.
3. Circuit : **FINANCE prépare, COMPLIANCE approuve**, deux personnes distinctes (I-7) ; validité de la demande 7 jours (plafond existant, D18).
4. Modèle B : refusé tant que le lot 13 n'existe pas. La preuve du financeur sera la référence de décision signée par le financeur (identifiant du financeur, référence de décision, date, empreinte des conditions), vérifiée à l'activation.

**Pourquoi.** C'est le circuit le plus restrictif compatible avec les sources ; il ne crée aucune condition financière non prévue.

**Effet sur le code.** Migration admin (`APPROVAL_KINDS += PAYMENT_PLAN`), persistance des plans dans `catalog`, puis activation d'offres A et C.

---

## D27 · Accords A/C : annulation, unité de durée, barème

**Conflit signalé.** CDC_05 § 5.2 n'autorise l'annulation client que depuis `ACTIVE` ; CDC_01 F-PLN-004 dit « annuler avant règlement » (donc aussi depuis `FUNDED` pour C).

**Décision.**
1. **CDC_05 prévaut** : l'ordre de priorité d'`AGENTS.md` § 2 place CDC_05 (architecture) avant CDC_01 (fonctionnel). L'annulation reste possible depuis `ACTIVE` uniquement.
   - Un client dont l'objectif C est `FUNDED` et qui veut récupérer ses fonds passe par une réclamation, puis un litige, puis un remboursement à 100 % (chemin `FUNDED → DISPUTED → REFUNDED`, lot 12). Il n'est donc jamais bloqué.
   - Une PR de documentation proposera d'ajouter `FUNDED → CANCELLED_BY_CUSTOMER` pour C dans CDC_05 ; le fondateur pourra l'accepter.
2. **Unité de durée : le mois** (1 à 36), comme le devis OpenAPI et D26. La colonne existante `duration_days` sera complétée par `duration_months` (migration additive) ; l'échéance se calcule en mois calendaires.
3. **Barème de restitution : uniquement « 100 %, sans frais »** (`FULL_NO_FEE`). Tout autre barème serait une condition financière défavorable au client, non prévue par les sources.

---

## D29 · Bénéficiaires personnes physiques (modèle C)

**Question.** Un bailleur particulier n'a pas de RCCM : quelles pièces exiger ?

**Décision.** Un bénéficiaire personne physique est accepté avec :
- une pièce d'identité officielle en cours de validité (CNI ou passeport), vérifiée ;
- une preuve de son droit sur le bien ou le service : titre foncier ou attestation de propriété pour un bailleur, mandat écrit pour une agence, attestation d'inscription pour une école ;
- des coordonnées de règlement **à son nom** (aucun paiement à un tiers) ;
- le NIU s'il en a un (facultatif pour une personne physique).

La validation reste en maker-checker (SEC-AUTHZ-003). Les cinq catégories actuelles sont confirmées : `LANDLORD`, `AGENCY`, `SCHOOL`, `MATERIALS_SELLER`, `LAND_SELLER`.

⚖ **À faire valider** par un juriste camerounais : liste exacte des pièces acceptées pour prouver la propriété (titre foncier, certificat de propriété, acte notarié).

---

## D32 · Routes HTTP des objectifs

**Décision.** La recommandation déjà faite est adoptée :
1. le contrat suit CDC_05 (statuts du § 5.2, booléen `locked`) ;
2. création en deux temps : `POST /v1/goals` crée un brouillon à partir d'un plan approuvé, puis `POST /v1/goals/{goalId}/activation` avec signature de l'appareil et PIN (INT-NR-001, SEC-AUTH-002) ; idem pour `/cancellation` et `/lock` ;
3. `GoalRequest = { offerId | beneficiaryId, planId, durationMonths }` ;
4. `Idempotency-Key` obligatoire, erreurs RFC 9457.

Le socle HTTP (session, origine, idempotence, quotas) existe déjà : les routes peuvent être écrites dès que les plans existent (D26).

---

## D38 · Quotas des routes compte (SEC-API-003)

**Recherches.** OWASP ASVS 4.0 (exigence 2.2.1) : au plus 100 échecs d'authentification par heure et par compte. NIST SP 800-63B : au plus 100 échecs consécutifs ; c'est un plafond, et la pratique courante retient 5 à 10 avec délais croissants. Ces repères concernent l'authentification ; nos routes sont déjà authentifiées, on vise donc la lutte contre l'abus, pas le verrouillage.

**Décision (politique version 1, fenêtre glissante) :**

| Action | Fenêtre | Par compte | Par appareil |
|---|---|---|---|
| `SECURITY_READ` (consulter sa sécurité) | 1 h | 60 | 60 |
| `REVOKE_OTHERS` (fermer les autres sessions) | 1 h | 5 | 5 |
| `DATA_RIGHTS_READ` (lire ses demandes) | 1 h | 30 | 30 |
| `DATA_RIGHTS_SUBMIT` (déposer une demande) | 24 h | 5 | 5 |

Insertion par migration revue (jamais par une route). Les limites par adresse IP et par numéro de téléphone (OTP, inscription) seront ajoutées au lot 24 avec les routes non authentifiées. Les compteurs expirés seront purgés après 7 jours (données non financières).

---

## D39 · Paiements

### 1. Agrégateur

**Recherches.**
- Les deux opérateurs (MTN MoMo, Orange Money) sont émetteurs de monnaie électronique ; un agrégateur intervient sous contrat avec eux. Cadre : Règlement n° 04/18/CEMAC/UMAC/COBAC du 21 décembre 2018 relatif aux services de paiement.
- **NotchPay** : webhooks signés en HMAC-SHA256 (en-tête `x-notch-signature`, clé dédiée distincte des clés d'API, corps brut), clés de test et de production séparées. **Pas d'horodatage ni de nonce** dans la signature.
- **CinetPay** : notification avec en-tête `x-token` en HMAC-SHA256, puis appel de l'API de vérification de la transaction, recommandé par la documentation.
- CamPay : API de collecte documentée, mais aucune documentation de signature des webhooks trouvée.
- L'agrément BEAC de chaque agrégateur **n'a pas pu être vérifié** dans une source officielle.

**Décision.**
1. Présélection : **NotchPay et CinetPay** (signature documentée, API de vérification, MTN + Orange). Choix final après vérification KYB : agrément ou mandat d'un établissement agréé, contrat, conditions de reversement sur le compte cantonné.
2. **Adaptation de SEC-API-002 aux formats réels** : ces prestataires n'envoient ni horodatage ni nonce. On applique donc :
   - signature HMAC vérifiée en temps constant sur le corps brut (déjà codé) ;
   - « nonce » = identifiant de transaction du prestataire + statut annoncé (déduplication en base) ;
   - fenêtre de ± 5 min seulement si le prestataire fournit un horodatage signé ;
   - **contrôle compensatoire obligatoire, déjà en place** : aucune écriture sans interrogation de l'API du prestataire (F-PAY-003) et une transaction ne crédite qu'une fois (`UNIQUE (channel, provider_tx_id)`).

⚖ **À faire valider :** contrat et agrément de l'agrégateur retenu ; liste d'adresses IP de ses webhooks, si fournie.

### 2. Plan de comptes de la confirmation
Réglé par CDC_04 § 2.2 (débit 1200, crédit 2100) : déjà appliqué (migration 0027).

### 3. Trop-perçu
L'option déjà appliquée est confirmée : une tentative supérieure au reste dû est refusée. Le trop-perçu résiduel (deux paiements simultanés) sera remboursé à 100 % au lot 12.

### 4. Espèces (F-PAY-005)
**Reportées après l'ouverture.** Le canal exige un réseau de partenaires habilités, un reçu signé et un rapprochement sous 24 h, qui n'existent pas encore. La confirmation des espèces reste refusée en base ; réactivation par une tranche dédiée.

### 5. Numérotation des reçus (F-PAY-006)
**Conflit résolu.** F-PAY-006 exige une « numérotation continue, vérifiable au grand livre » ; `AGENTS.md` § 8 interdit les identifiants séquentiels exposés. Un numéro global révélerait le volume d'activité.
**Décision :** numéro **continu par client** (reçu n° 1, 2, 3… du client), accompagné des 8 premiers caractères de l'empreinte de l'écriture du grand livre. La continuité est vérifiable pour le client, et le volume global n'est pas révélé.

### 6. Conservation des nonces de webhooks
**90 jours**, puis purge. Ce sont des données techniques non financières ; la déduplication durable repose sur la contribution, conservée sans limite.

---

## D40 · Rapprochement

**Recherches.** F-REP-001 prévoit des exports CSV « alignés ISO 20022 lorsque pertinent » ; le relevé bancaire ISO 20022 standard est le message `camt.053`.

**Décision.**
1. Relevé de l'établissement de cantonnement : `camt.053` si l'établissement le fournit, sinon CSV signé ; relevé de l'agrégateur : rapport de règlement CSV du prestataire retenu.
2. Saisie du solde de relevé en **maker-checker** : un membre de FINANCE saisit, un autre membre de FINANCE ou de COMPLIANCE valide.
3. Classement des écarts (INT-REC-003) : proposé par FINANCE, approuvé par COMPLIANCE ; correction uniquement par écriture de régularisation approuvée.
4. Escalade après 48 h (INT-REC-004) : direction (fondateur) et établissement de cantonnement, par message tracé.
5. Règlements en transit : saisie manuelle jusqu'au lot 12, puis compte dédié proposé par ADR (le plan minimal de CDC_04 § 2.1 n'en prévoit pas).

⚖ **À faire valider** avec l'établissement de cantonnement : format et fréquence des relevés, canal de remise.

---

## D41 · Réclamations et litiges

**Recherches.**
- **Règlement COBAC R-2020/06 du 30 juillet 2020**, pris en application du Règlement n° 01/20/CEMAC/UMAC/COBAC du 3 juillet 2020 sur la protection des consommateurs. Il s'applique notamment aux établissements de paiement et de microfinance.
- Délais : accusé de réception sous **10 jours ouvrables**, réponse écrite sous **45 jours**.
- Recours : médiation (médiateur du Comité national économique et financier, applicable depuis le 1er janvier 2023), puis juridictions.
- Obligations : service indépendant, traitement gratuit, information dans les langues officielles, rapport annuel à la COBAC.
- Deux sources concordantes (un cabinet juridique et une banque qui cite le texte). Le texte officiel n'a pas été consulté directement.

**Décision.**
1. Délais publiés : accusé de réception **immédiat** (déjà fait : numéro et heure serveur) ; réponse visée sous **15 jours** ; **45 jours au plus**. Au-delà de 15 jours, envoi d'une réponse d'attente motivée.
2. Contenu d'une réclamation : catégorie fermée (`PAYMENT`, `HANDOVER`, `REFUND`, `ACCOUNT`, `OTHER`) et texte libre de 1 000 caractères au plus, avec un avertissement visible de ne jamais saisir PIN, code ou numéro de pièce. Pièces jointes reportées.
3. Rôles : **SUPPORT_N2 ouvre** un litige ; **OPERATIONS ou COMPLIANCE le lève**, une autre personne (déjà imposé en base).
4. Voies de recours publiées : service réclamations, puis médiateur du CNEF, puis juridictions ; textes en français et en anglais.
5. Rapport annuel des réclamations : export prévu au lot 23.
6. Conservation : 5 ans après clôture (valeur prudente).

⚖ **À faire valider** par un juriste : application de R-2020/06 à notre statut (nous ne sommes pas nous-mêmes établissement assujetti : l'établissement de cantonnement l'est) et durée de conservation.

---

## D42 · Comptes comptables des partenaires (débloque le lot 12)

**Problème.** Le grand livre identifie le propriétaire d'un compte 2200 par un UUID ; les partenaires du catalogue ont un identifiant texte (`partner-1`).

**Décision.** À la **première validation** d'un partenaire, le catalogue lui attribue un **identifiant comptable UUID v7 immuable** (table en ajout seul, une ligne par partenaire, jamais réattribuée). Le règlement (lot 12) crée le compte 2200 avec cet identifiant. On ne change ni l'identifiant texte existant ni le schéma du grand livre.

---

## D43 · Plafonds KYC par niveau (REG-LBC-001, lot 07)

**Recherches.**
- REG-LBC-001 fixe les trois niveaux (1 : numéro vérifié + nom ; 2 : pièce officielle + selfie ; 3 : justificatif d'adresse + origine des fonds) et renvoie les montants « aux partenaires assujettis ».
- Le cadre LBC/FT est le Règlement n° 01/16/CEMAC/UMAC/CM du 11 avril 2016 (seuils aux articles 29 et 32, montants non retrouvés dans les extraits consultés).
- Une grille de marché de la monnaie électronique en zone CEMAC (200 000 / 1 000 000 / 5 000 000 FCFA de solde) circule, mais seulement dans une source commerciale non vérifiable.
- À titre de comparaison, la BCEAO (autre zone) relève le plafond d'un compte de monnaie électronique identifié à 4 000 000 FCFA à partir du 2 novembre 2026.

**Décision (valeurs de départ, paramétrées et versionnées, jamais codées en dur) :**

| Niveau | Fonds détenus (Σ projets) | Versements par mois |
|---|---|---|
| 1 : numéro vérifié + nom | 200 000 FCFA | 500 000 FCFA |
| 2 : pièce officielle + selfie | 2 000 000 FCFA | 2 000 000 FCFA |
| 3 : adresse + origine des fonds | 10 000 000 FCFA | 10 000 000 FCFA |
| Au-delà | examen manuel COMPLIANCE | — |

Les objectifs logement et terrain dépassent souvent 2 000 000 FCFA : ils exigent le niveau 3. Le contrôle est fait côté serveur à la création d'une tentative (refus `KYC_LIMIT_EXCEEDED`, avec le niveau requis indiqué au client).

⚖ **À faire valider** par l'établissement de cantonnement, assujetti LBC/FT, qui peut imposer des plafonds plus bas.

---

## D44 · Financeur du modèle B (lot 13)

**Recherches.**
- 385 établissements de microfinance sont agréés au Cameroun en 2026.
- La COBAC a ouvert 7 procédures d'administration provisoire d'établissements de microfinance dans la CEMAC en 2025 ; les microfinances camerounaises ont perdu 6,87 milliards FCFA en 2025.
- TEG moyen des prêts aux particuliers : 38,47 % en 2025 (Comité national économique et financier).
- TEG et usure : Règlement n° 04/19/CEMAC/UMAC/CM ; protection du consommateur : Règlement n° 01/20.

**Décision.** Le modèle B reste **fermé** tant qu'aucune convention n'est signée. Critères de choix du financeur :
1. agrément COBAC pour le crédit aux particuliers (banque, ou établissement de microfinance de catégorie autorisée à prêter au public) ;
2. pas sous administration provisoire, ratios prudentiels publiés ;
3. TEG sous le taux d'usure en vigueur, communiqué avant signature (F-FIN-003) ;
4. décision transmise par canal authentifié et signée (I-10) ;
5. charte de recouvrement compatible avec F-FIN-005.

⚖ **Décision du fondateur requise** pour signer une convention : l'agent ne peut pas choisir un partenaire financier réel.

---

## D33 / D34 · Rappels et notifications

**Décision.**
- **Plage d'envoi :** 8 h 00 à 20 h 00, heure de Douala. Rien le dimanche pour les rappels d'échéance ; les notifications transactionnelles (versement confirmé) partent à toute heure.
- **Fréquence :** au plus 1 rappel par jour et par projet, et au plus 3 rappels par semaine et par client.
- **Réservations :** une réservation non utilisée expire après 24 h.
- **Consommation :** au plus 5 tentatives par message, délai de reprise exponentiel à partir de 60 s, bail de traitement de 60 s.
- **Conservation :** messages traités conservés 90 jours (sans contenu sensible).

Ces valeurs sont prudentes vis-à-vis de la charte de recouvrement (F-FIN-005 : rappels limités en nombre et en horaires).

---

## D35 / D36 · Déblocage de compte, droits sur les données

**D35.** Le déblocage se fait en maker-checker : SUPPORT_N2 vérifie l'identité (pièce + selfie, comme SEC-AUTH-007), COMPLIANCE approuve. Délai de 24 h si le compte détient des fonds. Ré-enrôlement d'un nouvel appareil à l'issue.

**D36.** Réponse aux demandes d'accès, de rectification, d'opposition et d'effacement sous **30 jours**. Ce délai figure déjà dans l'exigence d'export ; je n'ai pas trouvé de délai chiffré dans les sources consultées sur la loi camerounaise n° 2024/017 du 23 décembre 2024. Identité vérifiée par session + PIN. L'effacement est limité par les obligations de conservation financière (écritures conservées, données d'identification pseudonymisées).

⚖ **À faire valider** par un juriste : délai légal exact et durées de conservation au titre de la loi 2024/017 (période transitoire de 18 mois close le 23 juin 2026).

---

## Autres décisions ouvertes (techniques)

| # | Décision |
|---|---|
| D1 | Vérificateur en **Rust** validé définitivement (ADR-0001 autorise Go ou Rust). |
| D4 | Commits signés par **clé SSH** dès que le fondateur en fournit une ; en attendant, non signés et consignés. |
| D6 | TSA DigiCert conservée pour les tests ; en production, TSA sous contrat avec URL HTTPS. ⚖ Contrat. |
| D7 | Digests d'images revus **mensuellement**. |
| D9 | Extraction du vérificateur vers un dépôt dédié **avant la recette** (lot 25). |
| D10 | Lecture de l'audit : AUDIT et COMPLIANCE ; conservation 10 ans (SEC-LOG-001). |
| D11 | Liste des types d'écriture figée par ADR au lot 12, avec leur règle de contre-passation. |
| D13 | Agents internes authentifiés par OIDC + MFA (lot 21). |
| D21 | Identifiants d'univers et de villes actuels confirmés. |
| D22 | Base de test : nom en `_test` obligatoire. |
| D23, D25 | Textes juridiques (CGU, conditions d'offre) : ⚖ **juriste obligatoire**, rien n'est rédigé par l'agent. Revalidation d'un partenaire obligatoire si changent : coordonnées de règlement, représentant, identifiants légaux, type. |
| D30 | CI locale (`ci:local`) obligatoire, sortie jointe à chaque PR, jusqu'au déblocage de la facturation GitHub. |
| Visibilité | Passer le dépôt en **privé** (action du fondateur). |
| Revue | Avant toute fusion, une **session vérificatrice distincte** relit les tranches L2/L3, puis le fondateur approuve. |

---

## Ce que l'agent fait ensuite

Dans cet ordre, chaque tranche testée puis commitée :
1. D26 : type `PAYMENT_PLAN`, persistance des plans ;
2. D27/D32 : durée en mois et routes des objectifs ;
3. D42 puis lot 12 : remise et règlement ;
4. D38 : migration des valeurs de quotas ;
5. D43 : plafonds KYC sur les tentatives ;
6. D39 : numérotation des reçus par client.

## Sources

- [Règlement COBAC R-2020/06 — analyse du cabinet Kalieu-Elongo](https://kalieu-elongo.com/traitement-des-litiges-bancaires-et-financiers-par-voie-de-reclamation-ce-que-prevoit-la-reglementation-bancaire-cemac/)
- [BCI Congo — procédure de réclamation citant R-2020/06](https://www.bcicongo.com/?page_id=6127)
- [Règlement n° 04/18/CEMAC/UMAC/COBAC relatif aux services de paiement (sgg.cg)](https://www.sgg.cg/txts-droit-reg/cemac-reglement-2018-04-services-paiement.pdf)
- [BEAC — instructions, circulaires et règlements des systèmes de paiement](https://www.beac.int/systemes-paiement/instructions-circulaires-reglements/)
- [GABAC — évaluation mutuelle Gabon 2023 (Règlement 01/16 LBC/FT)](https://www.fatf-gafi.org/content/dam/fatf-gafi/fsrb-mer/GABAC-MER-Gabon-2023-Fre.pdf.coredownload.pdf)
- [COBAC R-2023/01, article 16 (renvoi aux articles 29 et 32 du Règlement 01/16)](https://basereglementaire.com/article_reglementair/article-16-cobac-r-2023-01-2/)
- [Simiz — grille de plafonds KYC (source commerciale, non vérifiée)](https://simiz.io/blog/plafonds-kyc-mobile-money-gabon-2026)
- [BCEAO — plafond de monnaie électronique porté à 4 millions FCFA (zone UMOA, comparaison)](https://www.osiris.sn/monnaie-electronique-la-bceao-fixe-a-4-millions-de-fcfa-le-plafond-des-avoirs.html)
- [NotchPay — vérification des webhooks](https://developer.notchpay.co/get-started/webhooks/verify)
- [CinetPay — HMAC](https://docs.cinetpay.com/api/1.0-en/checkout/hmac) et [page de notification](https://docs.cinetpay.com/api/1.0-en/checkout/notification)
- [CamPay — documentation API (Postman)](https://documenter.getpostman.com/view/2391374/T1LV8PVA)
- [Simiz — guide du paiement mobile au Cameroun](https://simiz.io/blog/guide-paiement-mobile-cameroun-2026) ; [Vadevise — passerelles de paiement au Cameroun](https://vadevise.com/en/guides/payment-gateways-cameroon/)
- [Village Justice — loi camerounaise 2024/017 en 10 questions](https://www.village-justice.com/articles/cameroun-comprendre-questions-nouvelle-loi-sur-protection-des-donnees-caractere,52122.html) ; [CIO Mag — lecture de la loi du 23 décembre 2024](https://cio-mag.com/la-protection-des-donnees-a-caractere-personnel-au-cameroun-a-la-lecture-de-la-loi-du-23-decembre-2024/)
- [OWASP ASVS 4.0 — exigence 2.2.1](https://owasp-aasvs4.readthedocs.io/en/latest/2.2.1.html) ; [discussion ASVS sur les limites d'essais](https://github.com/OWASP/ASVS/issues/906)
- [Investir au Cameroun — microfinance](https://www.investiraucameroun.com/finance/1512-22889-microfinance-le-cameroun-concentre-57-6-des-credits-dans-la-cemac-malgre-une-legere-baisse-des-depots) ; [Ecomatin — pertes des microfinances 2025](https://ecomatin.net/cameroun-les-microfinances-basculent-dans-le-rouge-avec-69-milliards-fcfa-de-pertes-en-2025) ; [Cameroun24 — 385 établissements agréés en 2026](https://cameroun24.net/article/72658-microfinance-au-cameroun-385-etablissements-agrees-en-2026-un-secteur-sous-haute-surveillance-mais-moteur-du-credit.html)
- [Droit Médias Finance — taux d'usure en zone CEMAC](https://droitmediasfinance.com/index.php/dmf-conseils/protection-du-consommateur-financier/1284-cemac-financement-par-credits-comment-se-determine-le-taux-dusure-en-zone-cemac) ; [BEAC — Instruction n° 004/2021 (Règlement 04/19)](https://www.beac.int/wp-content/uploads/2021/12/Instruction-du-Gouverneur-N°004-2021_compressed.pdf)
