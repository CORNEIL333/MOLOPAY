# ADR-0006 · Client web léger en PWA Next.js

- **Statut :** Proposé
- **Date :** 26 octobre 2026
- **Décideur :** Fondateur

## Contexte

L’application Flutter reste le client natif Android/iOS de référence. Une partie
des clients camerounais accède toutefois au service depuis un téléphone modeste
(≈ 2 Go de RAM) ou un navigateur, en 3G, sans installer d’application. Le CDC
impose un web léger, utilisable sans compte Play/App Store, et le back-office
comme le portail partenaire sont déjà en Next.js. Les composants visuels, les
textes FR/EN et les règles d’affichage des montants doivent être partagés pour
éviter trois implémentations divergentes.

## Décision

1. **Client web = PWA Next.js** (`apps/web-client`), servie par le même
   déploiement web que le portail et le back-office, avec des origines et des
   politiques d’accès distinctes.
2. **L’application Flutter reste le client natif Android/iOS** (`apps/mobile`)
   pour les parcours complets et les intégrations système (notifications,
   biométrie, attestation d’appareil à venir).
3. **`packages/ui` est la seule source des jetons de design et des composants de
   base** partagés par la PWA, le portail partenaire et le back-office. Le
   paquet ne contient aucune logique financière : il affiche des valeurs
   formatées reçues de l’API.
4. **Aucun calcul financier côté client.** Les échéanciers, totaux, TEG et
   frais sont calculés par l’API ; le client formate et affiche. Les montants
   sont des entiers XAF sérialisés en chaîne décimale, jamais des flottants.
5. **Jetons de session en cookies `httpOnly`, `Secure`, `SameSite=Lax`**, posés
   par le serveur Next.js ou l’API ; aucun jeton dans `localStorage`, aucun
   secret dans le bundle.
6. **CSP stricte** (`default-src 'self'`, pas d’`unsafe-inline`, pas de
   publicité ni d’analytics tiers). Le service worker ne précharge que la
   coquille et les lectures non sensibles, avec la date de dernière
   synchronisation affichée ; il n’intercepte jamais une action financière.
7. **Contrat d’abord :** les écrans consomment un client typé généré depuis
   `packages/contracts/openapi.json`. Un endpoint absent est ajouté au contrat
   avant toute implémentation ; le code base peut rester non implémenté.

## Conséquences

- (+) Un seul jeu de composants, de textes et de règles de formatage pour les
  trois interfaces web ; coût d’entrée faible pour les clients sans Play Store.
- (+) La PWA peut être testée dans un navigateur, y compris sur un téléphone
  modeste, sans SDK natif.
- (+) Pas de duplication de la logique financière : l’API reste l’unique source
  des montants et des échéanciers.
- (−) Deux clients à maintenir (Dart et TypeScript) ; la parité fonctionnelle
  doit être testée écran par écran.
- (−) Les limites du navigateur (stockage, notifications, biométrie) imposent
  des parcours dégradés explicites ; l’app Flutter reste recommandée.
- (−) Le service worker exige une discipline de cache : toute lecture sensible
  est exclue, toute action est réseau-only.

## Alternatives écartées

| Alternative | Raison |
|---|---|
| Application Flutter Web unique | Poids initial et temps de démarrage élevés sur 2 Go/3G ; moins bonne intégration avec le portail et le back-office Next.js |
| Site web classique sans PWA | Pas de coquille hors ligne ni d’installation ; expérience dégradée en 3G |
| Application React Native tierce | Troisième pile cliente, sans bénéfice sur le web léger |
| Calculs d’échéancier côté client | Divergence avec l’API et risque d’afficher un montant faux ; interdit par la règle « aucun calcul financier côté client » |

## Points ouverts

- Origines et déploiement exacts (sous-domaines, cookies partagés ou non).
- Politique de cache hors ligne par écran et durée de conservation des lectures.
- Attestation d’appareil et notifications push pour la PWA (hors périmètre du
  sprint).
