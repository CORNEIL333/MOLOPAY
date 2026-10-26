# Plateforme d'achat planifié — Cameroun · Dossier documentaire complet

> **Venture :** aVIRA (holding) · **Nom commercial :** à définir (nom de code dépôt : `achat-planifie`)
> **Version du dossier :** 1.0 · **Date :** 26 octobre 2026 · **Propriétaire :** Charles Loïc (fondateur)
> **Langue de référence :** français. En cas de divergence entre une traduction et ce dossier, le français prévaut.

## 1. Objet

Ce dossier contient **tout ce qu'il faut pour concevoir, construire, vérifier et lancer** la plateforme camerounaise d'achat planifié : la documentation projet, le cahier des charges aligné sur les normes internationales, les fichiers d'instruction pour les agents IA qui réaliseront le code, le protocole de collaboration humain–agents avec ses garde-fous, et les annexes (décisions d'architecture, risques, traçabilité, conformité).

## 2. Décision structurante (non négociable)

Le fondateur a tranché le 21 octobre 2026 : **tout ouvre au lancement, rien n'est reporté.**

- **Trois modèles** : A · épargne-achat · B · achat financé · C · dépense planifiée.
- **Quatre univers** : essentiels · technologie et équipement · logement et immobilier · mobilité et activité professionnelle.
- **Deux villes** : Yaoundé et Douala, simultanément.
- **Trois interfaces** : application client (Android, iOS, web léger, USSD) · portail partenaire · back-office interne.

Rien n'ouvre tant que la **porte de lancement unique** n'est pas franchie (voir `04_annexes/checklist_porte_lancement.md`).

## 3. Plan du dossier

| Dossier | Fichier | Contenu | Lecteur principal |
|---|---|---|---|
| racine | `00_LISEZMOI.md` | Ce fichier | Tous |
| `01_projet/` | `01_dossier_projet.md` | Concept, marché, modèle économique, go-to-market, risques, feuille de route | Fondateur, partenaires, investisseurs |
| | `02_etude_MIT_24_etapes.md` | Étude selon *Disciplined Entrepreneurship* (MIT), 24 étapes | Fondateur, investisseurs |
| | `03_analyse_concurrentielle.md` | MoloMolo Pay (CI) et concurrents au Cameroun | Fondateur, équipe produit |
| | `04_glossaire.md` | Vocabulaire métier, financier et technique | Tous, agents IA |
| `02_cahier_des_charges/` | `CDC_00_sommaire_et_referentiel_normatif.md` | Normes appliquées, versions, conventions d'exigences | Tous |
| | `CDC_01_exigences_fonctionnelles.md` | Exigences fonctionnelles identifiées, critères d'acceptation | Produit, agents |
| | `CDC_02_exigences_non_fonctionnelles.md` | Qualité ISO/IEC 25010 : performance, disponibilité, accessibilité… | Architecte, agents |
| | `CDC_03_securite.md` | Sécurité applicative, mobile, identité, cryptographie, modèle de menaces | Sécurité, agents |
| | `CDC_04_integrite_transactionnelle.md` | Grand livre, chaîne de hachage, ancrage, rapprochement | Architecte, finance, auditeurs |
| | `CDC_05_architecture_et_donnees.md` | Architecture C4, modules, modèle de données, machines à états, API | Architecte, agents |
| | `CDC_06_conformite_reglementaire.md` | CEMAC, COBAC, LBC/FT, données personnelles | Conformité, juriste |
| | `CDC_07_verification_et_recette.md` | Stratégie de tests, suites d'attaque, recette | QA, agents |
| | `CDC_08_exploitation_et_continuite.md` | SLO, supervision, sauvegardes, incidents, PCA/PRA | Exploitation |
| `03_agents_ia/` | `AGENTS.md` | **Instructions maîtresses pour harness et agents IA** (standard ouvert AGENTS.md) | Agents IA |
| | `CLAUDE.md` | Pointeur pour Claude Code vers `AGENTS.md` | Claude Code |
| | `COLLABORATION_ET_GARDE_FOUS.md` | Rôles, portes d'approbation, interdits, escalade, sécurité des agents | Fondateur, agents |
| | `PLAN_DE_LOTS.md` | Découpage du build en lots exécutables par agents, dépendances, définition de « terminé » | Fondateur, agents |
| | `PROMPT_MAITRE_QODER.md` | Prompt de lancement du sprint MVP (jour 1) pour Qoder, et réglages préalables | Fondateur, Qoder |
| `04_annexes/` | `adr/ADR-0001…0005` | Décisions d'architecture | Architecte, agents |
| | `registre_des_risques.md` | Risques, cotation, parades, propriétaires | Fondateur |
| | `matrice_de_tracabilite.md` | Exigence → norme → test → preuve | QA, auditeurs |
| | `registre_des_traitements.md` | Traitements de données personnelles (loi 2024/017) | Conformité |
| | `guide_recherche_primaire.md` | Guide d'entretien clients et marchands | Fondateur |
| | `checklist_porte_lancement.md` | Conditions de la porte de lancement unique | Fondateur |
| | `sources.md` | Toutes les sources consultées | Tous |

## 4. Ordre de lecture conseillé

- **Fondateur, partenaires :** `01_dossier_projet` → `02_etude_MIT` → `registre_des_risques` → `checklist_porte_lancement`.
- **Juriste, conformité :** `CDC_06` → `registre_des_traitements` → `CDC_04` (sections fonds cantonnés et rapprochement).
- **Agents IA :** `AGENTS.md` (toujours en premier) → `COLLABORATION_ET_GARDE_FOUS.md` → `PLAN_DE_LOTS.md` → le CDC du lot en cours.

## 5. Statut des contenus

Chaque fichier distingue trois natures d'information :

| Marqueur | Sens |
|---|---|
| **[Établi]** | Fait vérifié auprès d'une source citée dans `sources.md` |
| **[Hypothèse]** | Valeur de travail à valider (recherche primaire, devis, avis juridique) |
| **[Décision]** | Arbitrage pris par le fondateur ; ne se modifie que par une nouvelle décision tracée |

## 6. Règles de gestion du dossier

1. Le dossier vit dans le dépôt de code, sous `docs/`. Toute modification passe par une demande de fusion (PR) relue.
2. Une exigence ne se supprime jamais : elle passe au statut `Retirée` avec motif et date.
3. Toute décision d'architecture nouvelle fait l'objet d'un ADR numéroté.
4. Les chiffres marqués **[Hypothèse]** sont remplacés par des valeurs mesurées dès qu'elles existent, avec la source.

## 7. Avertissement

Ce dossier ne constitue ni un avis juridique ni un conseil financier. Les points réglementaires (qualification des fonds, agréments, crédit) **doivent** être confirmés par un juriste habilité et, le cas échéant, par la COBAC et la BEAC avant toute collecte de fonds auprès du public.
