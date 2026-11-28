# Molopay — maquette mobile investisseurs

Prototype Flutter autonome : orange ciel et blanc ciel, sans bleu, avec composants Cupertino, transitions latérales, dock translucide flottant et panneaux glissants à hauteur variable.

## Parcours

60 écrans/vues (dont 56 fiches déclarées) : ouverture, introduction, inscription, OTP, PIN, biométrie, connexion/récupération, accueil, univers, catalogue vide, fiche article, partenaires, modèles A/B/C, devis/accord vides, projets, versements, moyens de paiement, reçu vide, remise, annulation/restitution, diaspora, activité, notifications, identité, profil, préférences, aide et déconnexion. Le badge **MAQUETTE** ouvre le plan des écrans ; chaque page est accessible sans authentification.

Aucun backend, aucune API, aucune connexion, aucun solde inventé, aucun paiement ou succès simulé. Les champs sont des présentations non éditables ; aucune donnée personnelle n'est collectée ou enregistrée. Les confirmations de paiement et décisions de financement restent vides. Les réglages d'interface sont éphémères. L'APK release ne demande pas la permission Internet.

## Construction

Flutter 3.47.6 / Dart 3.13.5. Dépendances épinglées et pubspec.lock inclus.

    flutter pub get --enforce-lockfile
    flutter analyze
    flutter test test/widget_test.dart
    flutter build apk --release

APK de présentation signé avec la configuration de développement Android : aucune publication de production. Les ressources Android et Gradle proviennent du squelette officiel Flutter.

## Références et ressources

Une image et cinq vidéos fournies dans `reference app mobile` : inspiration pour le dock flottant, les cartes arrondies, les écrans de profil et les transitions. Aucun code des vidéos recopié. Illustration originale générée avec Imagegen intégré : maison ivoire, toit orange sur nuage, soleil en verre abricot, sans texte ni bleu. Fichier `assets/avenir.png`, utilisé dans l'introduction et l'accueil. Prompt complet : illustration 3D premium, maison miniature ivoire à toit mandarine sur nuage blanc, sphère soleil en verre abricot, marches ivoire, matériaux céramique et verre dépoli, ombres douces, fond blanc chaud, aucune couleur bleue/cyan, aucun texte/logo/interface.

Flutter : licence BSD-3-Clause. Cupertino Icons 1.0.8 : licence MIT, incluse dans l'écran natif des licences Flutter et le paquet résolu. Flutter Lints 6.0.0 : outil de développement BSD-3-Clause. Aucun téléchargement de police Apple ni réutilisation de SF Pro. Police système Android ; aucune dépendance de télémétrie ajoutée.

`test/preview_test.dart` exporte des aperçus de widgets avec la police Roboto du SDK (FLUTTER_ROOT nécessaire). Ces images ne sont pas des captures d'exécution sur téléphone Android. Les tests de navigation et d'absence de débordement sont dans `test/widget_test.dart`.
