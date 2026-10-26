# Cahier des charges — 01 · Exigences fonctionnelles

> Version 1.0 · 26 octobre 2026 · Conventions : voir `CDC_00`. Toutes les exigences sont **requises au lancement**.
> Abréviations de vérification : T = Test automatisé, D = Démonstration, I = Inspection, A = Analyse.

## 1. Comptes, identité et consentements (F-ACC)

| ID | Exigence | Critère d'acceptation | Vérif. | Criticité |
|---|---|---|---|---|
| F-ACC-001 | Le système DOIT permettre l'inscription par numéro de téléphone (E.164) vérifié par OTP, depuis l'application et depuis l'USSD. | Un numéro non vérifié ne peut ouvrir ni objectif ni achat. | T | Critique |
| F-ACC-002 | Le client DOIT définir un code PIN (6 chiffres) lié à un appareil enregistré ; toute opération financière exige le PIN. | Sans PIN valide, la création de versement, de retrait ou de règlement est refusée côté serveur. | T | Critique |
| F-ACC-003 | Le système DOIT appliquer un KYC à niveaux proportionnés au montant cumulé (voir `CDC_06`, REG-KYC). | Le dépassement d'un plafond de niveau bloque l'opération et propose l'élévation de niveau. | T | Critique |
| F-ACC-004 | Le client DOIT accepter les CGU et la politique de confidentialité, versionnées ; l'acceptation est horodatée et conservée. | Une nouvelle version majeure exige une nouvelle acceptation avant toute opération. | T | Haute |
| F-ACC-005 | Le client DOIT pouvoir exercer ses droits (accès, rectification, opposition, effacement dans les limites des obligations de conservation). | Export de ses données en < 30 jours ; journal de la demande. | D | Haute |
| F-ACC-006 | Le système DOIT gérer la perte ou le vol du téléphone : blocage immédiat par USSD, support ou appareil de confiance, puis ré-enrôlement avec KYC renforcé. | Après blocage, aucune opération financière n'est acceptée depuis l'ancien appareil. | T | Critique |
| F-ACC-007 | Le système DOIT gérer le décès d'un client : gel, puis restitution des fonds aux ayants droit sur justificatifs, sous contrôle maker-checker. | Aucun mouvement sortant sans double approbation et pièces versées au dossier. | D | Haute |

## 2. Catalogue et offres (F-CAT)

| ID | Exigence | Critère d'acceptation | Vérif. | Criticité |
|---|---|---|---|---|
| F-CAT-001 | Le catalogue DOIT couvrir les quatre univers ; chaque offre porte : univers, modèle(s) autorisé(s), partenaire, ville(s), prix, stock ou disponibilité, garantie, conditions de remise. | Une offre incomplète ne peut être publiée. | T | Critique |
| F-CAT-002 | Un partenaire NE DOIT PAS pouvoir créer de conditions de crédit ; il active uniquement des plans approuvés par la plateforme et, pour B, par le financeur. | Toute tentative de plan non approuvé est refusée et journalisée. | T | Critique |
| F-CAT-003 | Le prix DOIT être figé à la création de l'accord pour toute sa durée. | Une modification ultérieure du prix catalogue n'affecte pas les accords existants. | T | Critique |
| F-CAT-004 | Le client DOIT pouvoir filtrer par univers, ville, modèle, prix et partenaire, et voir le coût total et l'échéancier simulé avant engagement. | Le simulateur affiche montant total, nombre et montant des versements, date estimée, frais éventuels (0 par défaut), et pour B le TEG. | T | Haute |
| F-CAT-005 | Le stock DOIT être réservé à la création de l'accord (A, B) avec règle de réapprovisionnement si l'objectif dure plus que la disponibilité. | Un article réservé n'est pas vendable deux fois ; en cas de rupture, l'offre de remplacement ou le remboursement intégral est proposé. | T | Haute |

## 3. Modèle A — épargne-achat (F-SAV)

| ID | Exigence | Critère d'acceptation | Vérif. | Criticité |
|---|---|---|---|---|
| F-SAV-001 | Le client DOIT pouvoir créer un objectif lié à une offre, choisir le rythme (quotidien, hebdomadaire, mensuel, libre) et une durée maximale autorisée par l'offre. | L'accord généré contient prix figé, rythme, durée, conditions de sortie. | T | Critique |
| F-SAV-002 | Chaque versement DOIT être confirmé par l'agrégateur côté serveur avant d'être crédité à l'objectif. | Un versement déclaré par le client sans confirmation du prestataire n'apparaît jamais comme confirmé. | T | Critique |
| F-SAV-003 | Le client PEUT verrouiller son objectif jusqu'à l'échéance ; les conditions de déverrouillage sont affichées avant verrouillage. | Un retrait sur objectif verrouillé est refusé sauf cas prévus (décès, défaillance marchand, force majeure). | T | Haute |
| F-SAV-004 | À 100 %, le système DOIT générer un code de remise à usage unique, valable sur une durée configurable, et notifier client et marchand. | Le code est vérifié par le serveur ; un code utilisé ou expiré est refusé. | T | Critique |
| F-SAV-005 | Le client DOIT pouvoir annuler un objectif non verrouillé ; les fonds lui sont restitués selon le barème publié (par défaut : 100 %, sans frais). | Le remboursement crée une écriture de restitution ; le stock réservé est libéré. | T | Critique |
| F-SAV-006 | En cas de défaillance du marchand, le client DOIT se voir proposer un article équivalent ou le remboursement intégral. | Aucune perte pour le client ; incident tracé au registre des partenaires. | D | Critique |

## 4. Modèle B — achat financé (F-FIN)

| ID | Exigence | Critère d'acceptation | Vérif. | Criticité |
|---|---|---|---|---|
| F-FIN-001 | La plateforme DOIT transmettre au financeur un dossier structuré (identité KYC, offre, acompte, échéancier proposé, historique d'épargne si consenti). | Le dossier est signé numériquement et horodaté ; le consentement au partage est explicite et révocable. | T | Critique |
| F-FIN-002 | La décision d'octroi DOIT être prise par le financeur seul ; la plateforme enregistre la décision, sa référence et les conditions (montant, durée, TEG). | Aucune remise sans décision « accordé » reçue par canal authentifié du financeur. | T | Critique |
| F-FIN-003 | Le TEG, le coût total du crédit et l'échéancier DOIVENT être affichés et acceptés avant la remise. | L'acceptation est horodatée dans l'accord. | T | Critique |
| F-FIN-004 | Les remboursements DOIVENT être collectés pour le compte du financeur et lui être reversés selon la convention ; ils ne sont jamais du revenu de la plateforme. | Les écritures distinguent fonds du financeur et commission d'apport. | T | Critique |
| F-FIN-005 | Le recouvrement DOIT respecter une charte responsable : rappels limités en nombre et en horaires, aucun contact des proches, aucune publication. | Les règles de rappel sont paramétrées et testées ; les dépassements sont bloqués. | T | Haute |
| F-FIN-006 | Le client PEUT rembourser par anticipation, sans pénalité sauf mention contraire de la convention, affichée avant signature. | Le solde restant dû est recalculé et confirmé par le financeur. | T | Normale |

## 5. Modèle C — dépense planifiée (F-PLN)

| ID | Exigence | Critère d'acceptation | Vérif. | Criticité |
|---|---|---|---|---|
| F-PLN-001 | Le client DOIT pouvoir créer un objectif de dépense vers un bénéficiaire référencé et vérifié (bailleur, agence, école, vendeur de matériaux ou de terrain). | Un bénéficiaire non vérifié ne peut recevoir aucun règlement. | T | Critique |
| F-PLN-002 | Pour un loyer ou une caution, le bail (ou son équivalent) DOIT être versé au dossier ; pour un terrain, le titre foncier ou la preuve de propriété DOIT être vérifié avant tout règlement. | Le règlement est bloqué tant que la vérification n'est pas validée par la conformité (maker-checker). | D | Critique |
| F-PLN-003 | Le règlement au bénéficiaire DOIT être déclenché par le client (confirmation PIN) ou à l'échéance convenue, puis exécuté par l'établissement de cantonnement. | Le reçu de règlement est envoyé au client et au bénéficiaire. | T | Critique |
| F-PLN-004 | Le client DOIT pouvoir annuler avant règlement et récupérer ses fonds selon le barème publié. | Restitution tracée, sans frais par défaut. | T | Haute |

## 6. Paiements entrants (F-PAY)

| ID | Exigence | Critère d'acceptation | Vérif. | Criticité |
|---|---|---|---|---|
| F-PAY-001 | Le système DOIT accepter MTN MoMo et Orange Money via l'agrégateur, la carte via la page hébergée de l'agrégateur, et les espèces déposées chez un partenaire habilité. | Chaque canal produit une tentative de paiement traçable. | T | Critique |
| F-PAY-002 | Chaque tentative DOIT porter une clé d'idempotence ; une confirmation reçue deux fois ne crée qu'un versement. | Test de rejeu : 1 000 webhooks dupliqués → 1 versement. | T | Critique |
| F-PAY-003 | Les webhooks DOIVENT être authentifiés (signature, horodatage, anti-rejeu) et confirmés par interrogation de l'API du prestataire avant écriture. | Un webhook non signé ou expiré est rejeté et alerté. | T | Critique |
| F-PAY-004 | Un paiement confirmé NE DOIT JAMAIS revenir à un état non payé à cause d'un message tardif ou désordonné. | Machine à états : transitions interdites refusées (voir `CDC_05`). | T | Critique |
| F-PAY-005 | Le dépôt en espèces DOIT produire un reçu signé côté serveur, remis au client par SMS, et être rapproché avec le versement mobile du partenaire déposant. | Un dépôt espèces non rapproché sous 24 h déclenche une alerte. | T | Haute |
| F-PAY-006 | Le client DOIT recevoir un reçu numéroté pour chaque versement (SMS et application). | Numérotation continue, vérifiable au grand livre. | T | Haute |

## 7. Remise, règlements, remboursements (F-SET)

| ID | Exigence | Critère d'acceptation | Vérif. | Criticité |
|---|---|---|---|---|
| F-SET-001 | La remise DOIT être prouvée par code à usage unique saisi ou scanné dans le portail partenaire, avec géolocalisation de la boutique et horodatage. | Remise sans code valide impossible. | T | Critique |
| F-SET-002 | Le règlement au marchand DOIT être calculé net de commission et déclenché après remise confirmée et fin du délai de contestation configuré. | Un litige ouvert suspend le règlement. | T | Critique |
| F-SET-003 | Tout règlement et tout remboursement au-delà d'un seuil configurable DOIVENT être approuvés par deux personnes distinctes (maker-checker). | Le préparateur ne peut pas approuver ; tentative journalisée. | T | Critique |
| F-SET-004 | Les règlements DOIVENT être exécutés par l'établissement de cantonnement ; la plateforme émet l'instruction signée et en suit l'exécution. | Toute instruction non confirmée sous 24 h est alertée. | T | Critique |

## 8. Litiges et support (F-SUP)

| ID | Exigence | Critère d'acceptation | Vérif. | Criticité |
|---|---|---|---|---|
| F-SUP-001 | Le client DOIT pouvoir ouvrir une réclamation depuis l'application, l'USSD (rappel) ou par téléphone ; chaque réclamation reçoit un numéro et un délai de réponse publié. | Accusé de réception < 24 h ; délai cible publié. | D | Haute |
| F-SUP-002 | Un litige DOIT pouvoir suspendre la clôture d'un accord et le règlement associé. | Suspension effective et levée tracées. | T | Critique |
| F-SUP-003 | L'historique complet d'un accord (versements, remises, échanges) DOIT être consultable par le client et le support. | Vue chronologique issue du journal d'événements. | D | Haute |

## 9. Portail partenaire (F-PRT)

| ID | Exigence | Critère d'acceptation | Vérif. | Criticité |
|---|---|---|---|---|
| F-PRT-001 | Onboarding avec vérification documentaire (RCCM, NIU, pièce du représentant, coordonnées de règlement) et validation maker-checker. | Partenaire non validé invisible du catalogue. | T | Critique |
| F-PRT-002 | Gestion du catalogue, des stocks, des points de remise et des horaires. | Modifications versionnées. | T | Haute |
| F-PRT-003 | Gestion du personnel avec rôles (gérant, vendeur) ; un vendeur ne voit pas les règlements. | Tests d'autorisation par rôle. | T | Haute |
| F-PRT-004 | Tableau des commandes, des objectifs en cours (anonymisés jusqu'à 100 %), des remises et des règlements ; export CSV. | Un partenaire ne voit jamais les données d'un autre partenaire. | T | Critique |
| F-PRT-005 | Abonnements Starter, Pro, Business avec facturation. | Fonctionnalités conditionnées à l'offre. | T | Normale |

## 10. Back-office interne (F-BO)

| ID | Exigence | Critère d'acceptation | Vérif. | Criticité |
|---|---|---|---|---|
| F-BO-001 | Rôles distincts : Support N1/N2, Opérations, Finance, Conformité LBC/FT, Risque, Réseau partenaires, Audit (lecture seule), Administrateur technique (≤ 2 personnes). | Matrice d'autorisations testée exhaustivement. | T | Critique |
| F-BO-002 | Aucun rôle interne NE DOIT pouvoir modifier ou supprimer une écriture du grand livre ; seules des contre-passations approuvées sont possibles. | Toute tentative est refusée par la base de données elle-même (voir INT-LED). | T | Critique |
| F-BO-003 | Tableaux de bord : objectifs, versements, remises, règlements, litiges, rapprochement, alertes de fraude, indicateurs par univers et par ville. | Chiffres issus des vues dérivées du grand livre. | D | Haute |
| F-BO-004 | Toute consultation de données sensibles (pièces d'identité, historique financier complet) DOIT être journalisée avec motif. | Journal consultable par l'audit. | T | Haute |

## 11. Canal USSD (F-USSD)

| ID | Exigence | Critère d'acceptation | Vérif. | Criticité |
|---|---|---|---|---|
| F-USSD-001 | Le menu USSD DOIT permettre : inscription, consultation de solde d'objectif, versement, blocage de compte, demande de rappel. | Parcours testés sur les deux opérateurs. | D | Haute |
| F-USSD-002 | Chaque session USSD DOIT tenir dans les limites de temps de l'opérateur et reprendre proprement après coupure. | Aucune opération financière à moitié exécutée (idempotence). | T | Critique |

## 12. Diaspora (F-DIA)

| ID | Exigence | Critère d'acceptation | Vérif. | Criticité |
|---|---|---|---|---|
| F-DIA-001 | Un payeur, au Cameroun ou à l'étranger, DOIT pouvoir contribuer à l'objectif d'un proche identifié, avec accord de ce dernier. | Le bénéficiaire de l'objectif accepte la contribution ; le payeur reçoit un reçu et la preuve de remise. | T | Haute |
| F-DIA-002 | Les contributions de l'étranger DOIVENT passer par un canal de transfert agréé et être soumises aux contrôles LBC/FT du partenaire. | Contribution bloquée si le contrôle échoue. | T | Critique |

## 13. Notifications (F-NOT)

| ID | Exigence | Critère d'acceptation | Vérif. | Criticité |
|---|---|---|---|---|
| F-NOT-001 | Notifications SMS et push pour : versement confirmé, rappel d'échéance, 100 % atteint, code de remise, règlement, litige. | Gabarits validés en français et en anglais. | T | Haute |
| F-NOT-002 | Une notification NE DOIT JAMAIS contenir de PIN, de code OTP en clair dans les journaux, ni de donnée d'identité complète. | Analyse statique et test de non-régression. | T | Critique |
| F-NOT-003 | Les rappels respectent les plages horaires et une fréquence maximale configurables. | Dépassement bloqué. | T | Normale |

## 14. Rapports et exports (F-REP)

| ID | Exigence | Critère d'acceptation | Vérif. | Criticité |
|---|---|---|---|---|
| F-REP-001 | Exports pour l'établissement de cantonnement, le financeur et le régulateur, dans des formats convenus (CSV, et champs alignés ISO 20022 lorsque pertinent). | Chaque export est signé et sa racine de Merkle référencée. | T | Haute |
| F-REP-002 | Indicateurs produits : volume, objectifs ouverts, taux d'objectifs à 100 %, délai de remise, impayés B, marge par commande, par univers et par ville. | Définitions écrites ; calculs testés. | T | Haute |
