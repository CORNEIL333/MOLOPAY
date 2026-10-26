# Cahier des charges — 06 · Conformité réglementaire

> Version 1.0 · 26 octobre 2026 · **Ce chapitre n'est pas un avis juridique.** Chaque exigence REG-* est à confirmer par un juriste habilité ; les points marqués « à confirmer » DOIVENT être tranchés par écrit avant la porte de lancement.

## 1. Qualification des activités

| Activité de la plateforme | Qualification probable | Montage retenu |
|---|---|---|
| Catalogue, mise en relation, logiciel partenaire | Commerce et services numériques | Exercée directement par la société |
| Réception des versements A et C | Service de paiement (règl. 04/18) ; risque de requalification en collecte de dépôts — **à confirmer** | Fonds reçus et détenus par l'établissement de cantonnement agréé ; la plateforme tient le registre |
| Règlements aux partenaires et bénéficiaires | Service de paiement | Exécutés par l'établissement de cantonnement sur instruction signée |
| Crédit du modèle B | Opération de crédit réservée aux établissements agréés COBAC | Octroyé et porté par le financeur ; la plateforme est apporteur/distributeur |
| Contributions depuis l'étranger | Transfert international | Via un canal agréé ; contrôles LBC/FT et change chez le partenaire |
| Émission de monnaie électronique | — | **Exclue** |

## 2. Exigences

### 2.1 Montage et agréments (REG-AGR)

| ID | Exigence |
|---|---|
| REG-AGR-001 | Avant tout encaissement public, la société DOIT détenir un avis juridique écrit sur la qualification des modèles A, B, C et la liste des autorisations nécessaires. |
| REG-AGR-002 | Convention avec l'établissement de cantonnement : compte ouvert au nom de l'établissement pour le compte des clients (ou montage équivalent validé), insaisissabilité au regard des créanciers de la plateforme à confirmer, relevés quotidiens, réception des têtes signées (`CDC_04`). |
| REG-AGR-003 | Convention avec le financeur B : critères d'octroi, décision propre, partage des données avec consentement, rémunération d'apport, charte de recouvrement, réception des têtes signées. |
| REG-AGR-004 | Dossier d'agrément d'établissement de paiement propre (exigé des fintechs depuis mai 2025 selon le ministère des Finances) déposé en parallèle, si l'avis juridique le requiert. |
| REG-AGR-005 | Le nom et l'agrément de chaque partenaire réglementé DOIVENT être affichés dans l'application et sur le site. |

### 2.2 LBC/FT (REG-LBC)

Cadre : règlement n° 01/CEMAC/UMAC/CM du 11 avril 2016 (et sa révision validée par la BEAC, à confirmer) ; règlement COBAC R-2023/01 pour les assujettis ; recommandations du GAFI.

| ID | Exigence |
|---|---|
| REG-LBC-001 | KYC à niveaux, plafonds par niveau (montants à fixer avec les partenaires assujettis) : niveau 1 numéro vérifié + nom ; niveau 2 pièce d'identité officielle + selfie de vivacité ; niveau 3 justificatif d'adresse et origine des fonds. |
| REG-LBC-002 | Filtrage des clients et partenaires contre les listes de sanctions (ONU, nationales) et identification des personnes politiquement exposées, à l'entrée et à chaque mise à jour de listes. |
| REG-LBC-003 | Surveillance des opérations (fractionnement, vélocité, origine étrangère, remboursements atypiques) et transmission des alertes au responsable conformité du partenaire assujetti, qui effectue les déclarations de soupçon à l'ANIF. |
| REG-LBC-004 | Interdiction d'informer le client d'une déclaration de soupçon (« tipping-off ») : aucune notification ni message ne la révèle. |
| REG-LBC-005 | Conservation des données d'identification et des opérations pendant la durée légale (≥ 10 ans à confirmer) ; non effaçables par une demande de droit à l'oubli pendant cette durée. |
| REG-LBC-006 | Désignation d'un responsable conformité LBC/FT dans l'équipe ; formation annuelle de l'équipe et des partenaires. |

### 2.3 Protection des données personnelles (REG-DPD) — loi n° 2024/017

| ID | Exigence |
|---|---|
| REG-DPD-001 | Registre des traitements tenu à jour (`04_annexes/registre_des_traitements.md`). |
| REG-DPD-002 | Formalités préalables auprès de l'Autorité de protection des données à caractère personnel, selon les catégories de traitements (à confirmer avec le juriste). |
| REG-DPD-003 | Minimisation : aucune collecte de contacts, SMS, journaux d'appels, localisation continue ; la géolocalisation se limite à la boutique lors d'une remise. |
| REG-DPD-004 | Hébergement : un transfert ou un hébergement hors du Cameroun exige un niveau de protection équivalent et l'autorisation préalable de l'autorité ; le choix d'hébergement est tranché dans l'ADR-0004. |
| REG-DPD-005 | Analyse d'impact (DPIA) avant lancement pour : KYC biométrique (selfie), partage de l'historique avec le financeur, profilage anti-fraude. |
| REG-DPD-006 | Notification des violations dans les délais légaux ; procédure intégrée au plan d'incident (SEC-INC-002). |
| REG-DPD-007 | Désignation d'un délégué à la protection des données (DPO), au minimum externe, dès le lancement. |
| REG-DPD-008 | Consentement distinct, explicite et révocable au partage de l'historique d'épargne avec un financeur. |

### 2.4 Protection du consommateur et transparence (REG-CON)

| ID | Exigence |
|---|---|
| REG-CON-001 | Coût total, échéancier, frais (0 par défaut) et, pour B, TEG et coût total du crédit affichés avant engagement, conformément aux règles COBAC sur le TEG et au taux d'usure applicable. |
| REG-CON-002 | CGU, conditions de chaque modèle, barèmes de sortie et charte de recouvrement publiés, versionnés, accessibles hors connexion. |
| REG-CON-003 | Procédure de réclamation publiée, avec délais et voies de recours (médiation, autorités). |
| REG-CON-004 | Interdiction de toute mécanique de jeu de hasard (tickets, tirages) liée aux paiements, sauf autorisation spécifique et fiscalité correspondante — décision : **exclue**. |

### 2.5 Fiscalité et comptabilité (REG-FIS)

| ID | Exigence |
|---|---|
| REG-FIS-001 | Le droit de 4 FCFA par transaction mobile money (loi de finances 2025) DOIT être modélisé dans le calcul des coûts et ne jamais être refacturé de façon cachée. |
| REG-FIS-002 | La comptabilité de la société (SYSCOHADA révisé) DOIT distinguer les fonds de tiers des produits ; le grand livre fournit les états nécessaires à l'expert-comptable. |
| REG-FIS-003 | Facturation des commissions et abonnements avec TVA selon le régime applicable (à confirmer). |

### 2.6 Modèle C — immobilier et scolarité (REG-PLN)

| ID | Exigence |
|---|---|
| REG-PLN-001 | Contrat type tripartite (client, bénéficiaire, plateforme) validé par le juriste pour : loyer et caution, frais scolaires, matériaux, terrain. |
| REG-PLN-002 | Terrain : vérification du titre foncier auprès des services compétents avant tout règlement ; la plateforme n'est jamais partie à la vente. |
| REG-PLN-003 | Agences immobilières : vérification de l'immatriculation et de l'habilitation professionnelle. |

## 3. Responsabilités

| Sujet | Responsable | Appui |
|---|---|---|
| Avis juridique, contrats | Fondateur | Juriste habilité |
| LBC/FT | Responsable conformité | Partenaires assujettis |
| Données personnelles | DPO | Juriste, équipe technique |
| Comptabilité, fiscalité | Direction financière | Expert-comptable |
| Relations BEAC/COBAC/ministère | Fondateur | Partenaires agréés |
