# Cahier des charges — 02 · Exigences non fonctionnelles

> Version 1.0 · 26 octobre 2026 · Organisé selon les caractéristiques du modèle de qualité ISO/IEC 25010:2023. Les cibles chiffrées sont des **[Hypothèse]** de départ, révisées après mesure en recette.

## 1. Adéquation fonctionnelle (NF-FUN)

| ID | Exigence | Critère |
|---|---|---|
| NF-FUN-001 | Tout montant DOIT être un entier en XAF (ISO 4217, 0 décimale) ; aucun calcul monétaire en virgule flottante. | Analyse statique : aucun type flottant dans les modules `ledger`, `payments`, `pricing`. |
| NF-FUN-002 | Les arrondis (répartition d'un prix en versements, commissions) DOIVENT suivre une règle unique documentée (reste affecté au dernier versement ; commission arrondie à l'unité inférieure). | Tests de propriété : somme des parts = total, pour 10⁶ cas aléatoires. |

## 2. Efficacité de performance (NF-PERF)

| ID | Exigence | Cible |
|---|---|---|
| NF-PERF-001 | Latence API (p95) pour les lectures | ≤ 300 ms côté serveur |
| NF-PERF-002 | Latence API (p95) pour une écriture financière (hors attente du prestataire) | ≤ 800 ms |
| NF-PERF-003 | Application client utilisable sur un smartphone d'entrée de gamme (2 Go de RAM) en 3G | Premier écran interactif ≤ 3 s ; taille de l'APK ≤ 30 Mo |
| NF-PERF-004 | Pas d'action USSD au-delà de la limite de session de l'opérateur | Chaque écran USSD répond en ≤ 2 s |
| NF-PERF-005 | Charge de dimensionnement initial | 200 versements/s en pointe, 5 000 utilisateurs simultanés, testés à 3× |

## 3. Compatibilité (NF-COMP)

| ID | Exigence |
|---|---|
| NF-COMP-001 | Android 8.0+ ; iOS 15+ ; navigateurs à jour (Chrome, Safari, Firefox, Edge, deux dernières versions). |
| NF-COMP-002 | Interopérabilité : API publique décrite en OpenAPI 3.1 ; erreurs au format RFC 9457. |
| NF-COMP-003 | Abstraction des prestataires : une interface `PaymentProvider` unique ; ajouter un agrégateur NE DOIT PAS modifier le cœur financier. |

## 4. Capacité d'interaction / utilisabilité (NF-UX)

| ID | Exigence |
|---|---|
| NF-UX-001 | Accessibilité WCAG 2.2 niveau AA (contrastes, tailles tactiles ≥ 44 px, lecteurs d'écran). |
| NF-UX-002 | Français et anglais au lancement ; textes externalisés ; montants affichés « 25 000 FCFA ». |
| NF-UX-003 | Une information clé (solde de l'objectif, prochain versement) DOIT être lisible en moins de 2 secondes sur l'écran d'accueil. |
| NF-UX-004 | Mode hors ligne en lecture (dernier état connu affiché avec sa date) ; aucune opération financière hors ligne. |
| NF-UX-005 | Toute action irréversible (annulation, règlement C) DOIT demander une confirmation explicite avec résumé des conséquences. |

## 5. Fiabilité (NF-REL)

| ID | Exigence | Cible |
|---|---|---|
| NF-REL-001 | Disponibilité mensuelle de l'API et des paiements | ≥ 99,9 % (hors maintenance annoncée ≤ 4 h/mois, de nuit) |
| NF-REL-002 | Objectif de point de reprise (RPO) du grand livre | 0 perte d'écriture validée (réplication synchrone) |
| NF-REL-003 | Objectif de temps de reprise (RTO) | ≤ 4 h pour l'ensemble ; ≤ 1 h pour la consultation des soldes |
| NF-REL-004 | Indisponibilité d'un prestataire | Dégradation contrôlée : file d'attente, message clair, aucun double débit |
| NF-REL-005 | Traitements asynchrones | Livraison « au moins une fois » + consommateurs idempotents ; file des messages en échec surveillée |

## 6. Sécurité

Voir `CDC_03_securite.md` et `CDC_04_integrite_transactionnelle.md`.

## 7. Maintenabilité (NF-MNT)

| ID | Exigence |
|---|---|
| NF-MNT-001 | Monolithe modulaire avec frontières de modules vérifiées automatiquement (aucun import interdit entre modules). |
| NF-MNT-002 | Couverture de tests : ≥ 90 % des lignes et 100 % des transitions d'état sur `ledger`, `payments`, `settlement` ; ≥ 75 % ailleurs. Tests de mutation sur `ledger` (score ≥ 80 %). |
| NF-MNT-003 | Toute décision d'architecture DOIT faire l'objet d'un ADR. |
| NF-MNT-004 | Code typé strictement (TypeScript `strict`, Dart `strict-casts`) ; aucun `any` dans les modules financiers. |
| NF-MNT-005 | Documentation générée de l'API à chaque version ; journal des modifications (Keep a Changelog). |

## 8. Flexibilité / portabilité (NF-PORT)

| ID | Exigence |
|---|---|
| NF-PORT-001 | Déploiement par conteneurs (OCI) et infrastructure décrite en code ; environnements reproductibles : dev, test, préproduction, production. |
| NF-PORT-002 | Aucune dépendance à un fournisseur cloud dans le code métier (adaptateurs isolés). |
| NF-PORT-003 | Les paramètres métier (plafonds, barèmes, délais) DOIVENT être des données versionnées, pas des constantes en dur. |

## 9. Sûreté et protection du public (NF-SAFE)

| ID | Exigence |
|---|---|
| NF-SAFE-001 | Aucune mécanique de type loterie, ticket à gratter ou rémunération au clic. |
| NF-SAFE-002 | Plafonds par client (montant cumulé, nombre d'objectifs simultanés) paramétrables pour limiter le surengagement. |
| NF-SAFE-003 | Messages de rappel non culpabilisants, validés par la conformité. |

## 10. Observabilité (NF-OBS)

| ID | Exigence |
|---|---|
| NF-OBS-001 | Journaux structurés (JSON) avec identifiant de corrélation de bout en bout ; aucune donnée sensible en clair (PIN, OTP, pièce d'identité, numéro complet masqué sauf 4 derniers chiffres). |
| NF-OBS-002 | Métriques et traces (OpenTelemetry) ; tableaux de bord des SLO (voir `CDC_08`). |
| NF-OBS-003 | Alertes : paiement en attente > 15 min, écart de rapprochement, rupture de chaîne de hachage, erreur 5xx > 1 %, file en échec non vide. |
