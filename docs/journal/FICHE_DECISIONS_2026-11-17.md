# Fiche de décisions — 17 novembre 2026 (D63 à D73)

> Une ligne par question, réponse attendue fermée. En attendant, l'option indiquée (la plus prudente) est appliquée et tout reste **fermé par défaut**. Détails : `DECISIONS_EN_ATTENTE.md` (référence Dnn).

## A. Urgent : bloque la compilation et un test

| # | Question | Option appliquée en attendant |
|---|---|---|
| D64 | Autorisez-vous la montée épinglée **`next@16.4.5`** (correctif de sécurité, client web, back-office, portail partenaire) ? **Oui / Non** | Aucune montée ; `next build` refusé, bout en bout du back-office bloqué. |

## B. Portail partenaire (lot 20)

| # | Question | Option appliquée |
|---|---|---|
| D63 | RP ID et origine du portail partenaire (ex. `partenaires.molopay.cm`) ? | Aucune ; routes partenaires en 503. |
| D63 | Session de 15 min au comptoir : **conserver / allonger (durée ?)** | 15 min. |
| D63 | Le partenaire peut-il **modifier lui-même** offres et stocks ? **Oui (avec validation du personnel) / Non** | Non : lecture seule. |
| D63 | Afficher au partenaire le **nom (ou les initiales)** du client à 100 % ? **Nom / Initiales / Rien** | Rien. |
| D63 | Ajouter un **périmètre partenaire** aux rôles du personnel (création des gérants au back-office) ? **Oui / Non** | Non : création des gérants impossible en HTTP. |
| D63 | Export CSV des commandes aussi pour les vendeurs ? **Oui / Non** | Non (gérant seul). |

## C. Back-office (lot 21)

| # | Question | Option appliquée |
|---|---|---|
| ADR-0007 | Approuvez-vous l'authentification du personnel par WebAuthn vérifié par l'API ? **Oui / Préférer un fournisseur d'identité** | Proposé, fermé par défaut. |
| D65 | Enregistrer la **ville du client** à la création de l'accord (indicateurs par ville exacts) ? **Oui / Non** | Ville de l'offre utilisée. |
| D67 | Valeurs de limitation des défis de connexion (par IP, par identifiant) et WAF ? | Aucune limite applicative (déni ciblé évité) ; routes fermées. |

## D. KYC et conformité (lot 07)

| # | Question | Option appliquée |
|---|---|---|
| D66 | Import de la liste ONU en exploitation : **téléchargement par le serveur depuis l'URL officielle** (hôte autorisé en sortie) ? **Oui / Autre** | Aucun import en exploitation. |
| D66 | Source **PPE** et listes nationales (gel des avoirs CEMAC/ANIF) ? | Aucune. |
| D66 | Subordonner la **validation d'un partenaire** à un filtrage sans rapprochement (ou faux positif examiné) ? **Oui / Non** | Non (filtrage disponible, non obligatoire). |
| D68 | Client déjà `BASIC` dont une nouvelle déclaration de nom correspond à la liste : **conserver / rétrograder / geler** ? | Conserver, examen en attente. |
| D68/D72 | Quotas : nom légal **3 / 24 h**, réclamations **5 / 24 h** : **Valider / Modifier** | Appliqués (méthode D60). |

## E. Client et contrat

| # | Question | Option appliquée |
|---|---|---|
| D69 | Retirer du contrat les routes `/v1/admin/*` du brouillon (remplacées par `/v1/backoffice/*`) ? **Oui / Non** | Conservées, non implémentées. |
| D69 | Code de remise : il n'est conservé qu'en empreinte et **ne peut pas être réaffiché** ; remplacer `GET …/handover-code` par une **nouvelle émission explicite** ? **Oui / Non** | Route non implémentée. |
| D70 | Délai de réponse aux réclamations à publier : **15 j cible / 45 j max** ? **Valider / Modifier** | Non affiché. |
| D71 | Connexion client : **PIN + appareil à clé** (SEC-AUTH-001) au lieu du brouillon « téléphone + PIN » ? **Oui** (recommandé) **/ Non** | Non implémentée (inscription par SMS bloquée). |

## F. Outillage (18 novembre)

| # | Question | Option appliquée |
|---|---|---|
| D75 | Délai cible d'examen d'un rapprochement sanctions et escalade (comme les 48 h des écarts) ? | Aucun délai ; rapprochements listés dans la file. |
| D77 | Informer le client de son **niveau KYC** sans révéler un rapprochement (accord différé pour tous ? message unique ?) — avis Conformité | Réponse neutre unique ; niveau jamais affiché. |
| D78 | Écartement d'un rapprochement à **deux personnes** aussi pour les partenaires (déjà appliqué aux clients) ? **Oui / Non** | Clients seulement. |
| D79 | Portail partenaire : identifiants préfixés par partenaire ? jeton d'enrôlement remis au vendeur seul ? sessions coupées à la défaillance du marchand ? | Inchangé, consigné. |
| D80 | Liste ONU : qui détient le rôle d'**import** (`kyc_list_importer`) ; import confirmé par une seconde personne ? Noms arabes **vocalisés** acceptés ? | Rôle sans titulaire ; noms vocalisés refusés. |
| D81 | Envoi des codes SMS : **5 par numéro et par heure**, code valable 5 min, 5 essais : **Valider / Modifier** ; limite par IP ? | Appliqué. |
| D71 | (Appliqué le 20 novembre conformément à SEC-AUTH-001 : appareil + PIN.) Confirmer ? | — |
| D82 | **Nouveau téléphone** sur le même numéro : **A** approbation par l'ancien téléphone + OTP / **B** OTP + délai 24 h / **C** agence ou support avec contrôle d'identité (recommandé : A + C) | Aucun ajout d'appareil possible. |
| D83 | **Blocage d'un compte client** par : support N1/N2 et risque (appliqué) — **Valider / Modifier** ; SMS au client lors du blocage ? procédure de déblocage ? | Appliqué ; aucun déblocage possible. |
| D84 | **Gel des flux sortants** (SEC-INC-003) demandé et confirmé par deux personnes parmi finance, conformité, risque ; confirmation dans l'heure — **Valider / Modifier** ; alerte au fondateur lors d'un gel ? | Appliqué ; aucune alerte. |
| D85 | Client en cours d'examen de sanctions : refus de versement par **message neutre « vérification en cours »** identique pour tous (recommandé) / plafond minimal pendant l'examen | Aucun versement possible (agrégateur non branché). |
| D86 | **Nombre maximal d'objectifs actifs** par client (NF-SAFE-002) : **3** (recommandé) / autre ; compter aussi les objectifs financés non remis ? | Aucune activation tant que le paramètre n'est pas publié. |
| D76 | Ajouter `@vitest/coverage-v8` (épinglé) et Stryker pour mesurer NF-MNT-002 ? **Oui / Non** | Aucune mesure de couverture. |

## G. Accès externes toujours attendus

Prestataire SMS et agrégateur de paiement (identifiants d'environnement de test), établissement de cantonnement (instructions, relevés), financeur B, témoins d'ancrage, prestataire de vérification de pièce et de vivacité (KYC niveaux 2–3).
