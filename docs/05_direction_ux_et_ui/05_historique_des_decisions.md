# Historique des décisions UX et UI

> Version 1.0 · 20 novembre 2026

| Date | Étape | Décision ou résultat |
|---|---|---|
| 19 nov. 2026 | Inventaire | 39 écrans réels, 98 composants React, 36 widgets Flutter sur les branches d'agents ; deux palettes divergentes (vert-or sur le web, orange-brun sur le mobile) |
| 19 nov. 2026 | Analyse | Interfaces et composants insuffisants pour le lancement : environ 25 écrans et 15 composants à ajouter (`01_inventaire_et_analyse.md`) |
| 19 nov. 2026 | Cadrage | [Décision] Nouvelle direction (ni la palette web ni la palette mobile) ; personnalité **sérieuse, dynamique et chaleureuse** ; périmètre : couleurs et typographie, composants, ton, logo et nom |
| 19 nov. 2026 | Trois pistes | A « Indigo Ndop », B « Pétrole et mangue », C « Cobalt et hibiscus » : **rejetées** par le fondateur |
| 20 nov. 2026 | Inspirations | Références fournies (`03_inspirations.md`) |
| 20 nov. 2026 | Direction retenue | [Décision] « Noir, lumière, et une couleur par projet » : base noir et blanc, 4 couleurs d'univers, Outfit + Inter, anneau de cotisation |
| 20 nov. 2026 | Marketplace mobile | 5 écrans ajoutés (catalogue, filtres, fiche produit, boutique, comparaison) : **validés** |
| 20 nov. 2026 | Écrans web | Portail partenaire, PWA, back-office, CRM : **validés** |
| 20 nov. 2026 | Site public | [Décision] Ajout d'un site public marketplace pour les visiteurs non inscrits ; intégré au plan (lot 26, ADR-0008, F-PUB, NF-PUB) |
| 20 nov. 2026 | Animations | [Décision] Charte d'animation (`06_animations.md`) : jetons Material 3, « l'argent avance sûrement, il ne rebondit pas », aucun faux succès, WCAG 2.3.3 (AAA) visé, pas de Lottie ni de Rive au lancement ; bouton pause ajouté au site public (WCAG 2.2.2) |
| 20 nov. 2026 | Recherche | Rapport `07_psychologie_de_marque_et_ux.md` : sciences comportementales au service du client, 15 pratiques interdites ; l'identité est confirmée (aplats colorés sous texte noir, anneau rempli seulement par de l'argent réellement versé) et doit ajouter des preuves de solidité |
| 20 nov. 2026 | Recherche n° 2 | Rapport `08_ux_inclusive_et_publics_cibles.md` : montants affichés de quatre façons et relus avant le PIN, USSD en GSM-7 sans PIN MoMo, KYC « juste à temps » sous réserve juridique, diaspora sans promesse d'instantané, bailleurs payés en une fois avec quittances ventilées |
| 21 nov. 2026 | Parcours inclusifs | Maquette `parcours-inclusifs.html` et règles d'identité issues de la recherche ajoutées à `02_identite_visuelle.md` |
| 21 nov. 2026 | Parcours crédit | Prototype du modèle B : opt-in actif, contrôle de capacité, consentement séparé, décision du seul financeur, offre ferme avec échéancier et rétractation, recouvrement responsable, pas de célébration sur une dette |
| 21 nov. 2026 | Écrans complémentaires | Acceptation par le proche, validation partenaire, vérification bailleur, rapports régulateur, abonnements : tous les parcours sont maquettés |
| 25 nov. 2026 | Marketplace, suite | Recherche vocale et tolérante, favoris sans promesse de prix, réservation en 4 étapes remplaçant le panier (un projet par réservation) |
| 25 nov. 2026 | Préparation MVP 0.0.1 | `09_passage_maquettes_mvp_0.0.1.md`, jetons générés et textes FR/EN ; périmètre proposé : modèles A et C sans encaissement (D92), inscription en agence (C13), restyle de tous les écrans existants |
| 26 nov. 2026 | Exploration « liquide » | Dégradés liquides et verre flou proposés (`maquettes/exploration-direction-liquide.html`) |
| 26 nov. 2026 | Matières adoptées | [Décision] « ok continue » du fondateur : mode Liquide adopté, Sobre en repli automatique. Jetons `glass.*`, `gradient.*`, M-56 ; `02` § Matières, `06` § 7.1, `09` F8 ; prompts Gemini à jour. Les maquettes antérieures restent à plat : on applique les matières selon `02` § Matières |
| 26 nov. 2026 | Maquettes du MVP repeintes | `identite-app-mobile.html`, `marketplace-suite.html`, `parcours-inclusifs.html` passent aux matières liquide et verre, avec un interrupteur Liquide / Sobre ; les autres maquettes (web, crédit, compléments, site public) restent à plat |
| 27 nov. 2026 | Recherche n° 3 | Rapport `10_marketplace_epargne_achat.md` : chaque couple ville × univers est un petit marché à remplir ; épargne cantonnée et remise en boutique contre la peur de l'avance perdue ; règles proposées pour la garantie de prix (durée maximale par catégorie, baisse répercutée, stock réservé à 80 %), avis vérifiés, classement publié, commission basse |
| 20 nov. 2026 | Corrections | Le frigo et l'électroménager relèvent de « Technologie et équipement », pas de « Logement » ; MoloMolo Pay est un concurrent **ivoirien** |

## Points ouverts

| Point | Responsable | Échéance |
|---|---|---|
| Disponibilité du nom « MoloPay » à l'OAPI (proche de « MoloMolo Pay ») ; sinon choisir un autre nom (pistes : Kotiz, Pas à Pas, Objekti, non vérifiées) | Fondateur + conseil en propriété industrielle (H8) | Avant le dessin final du logo |
| Validation de l'ADR-0008 (site public) | Fondateur | Avant le lot 26 |
| **TVA sur les acomptes** (loi de finances 2026) : s'applique-t-elle à l'épargne affectée à un achat ? | Fondateur + fiscaliste | **Bloquant avant tout versement réel** |
| Règles de garantie de prix (durées par catégorie, réservation à 80 %, hausse à la charge du partenaire) et formulation « prix garanti jusqu'au [date] » au lieu de « prix figé » (loi 2011/012) | Fondateur + juriste + partenaires | Avant le test fermé |
| Régime KYC applicable (règlement CEMAC 02/24, qui abroge le 01/16 cité dans `CDC_06`) : inscription à distance en vigilance renforcée (art. 22) vs premier versement immédiat ; options art. 55, 57(c), 58 | Fondateur + juriste CEMAC | Avant les lots 06 et 07 |
| Tests des maquettes auprès de clients à Douala et Yaoundé | Fondateur (H5) | Avec la recherche primaire |
