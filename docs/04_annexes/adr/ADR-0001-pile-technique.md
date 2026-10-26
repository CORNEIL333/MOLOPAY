# ADR-0001 · Pile technique et style d'architecture

- **Statut :** Accepté pour le sprint 1 (26 octobre 2026), révisable par le fondateur
- **Date :** 26 octobre 2026
- **Décideur :** Fondateur

## Contexte

Trois interfaces, un canal USSD, un socle financier exigeant (grand livre en ajout seul, cohérence transactionnelle forte), une équipe réduite assistée d'agents IA, un capital limité.

## Décision proposée

- **Monolithe modulaire** pour l'API cœur, en **TypeScript (NestJS)**, frontières de modules vérifiées en CI.
- **PostgreSQL 16+** comme unique base transactionnelle (grand livre, état métier, outbox).
- **Flutter** pour l'application client ; **Next.js** pour portail et back-office.
- **Outbox transactionnelle** en base plutôt qu'un courtier de messages au lancement.
- **Vérificateur indépendant** dans un autre langage (Go ou Rust) et un autre dépôt.

## Conséquences

- (+) Transactions ACID couvrant état métier et écritures ; contraintes d'intégrité au plus près des données ; un seul langage côté serveur et web ; large disponibilité de compétences et bonne maîtrise par les agents IA.
- (+) Un monolithe se découpe plus tard ; l'inverse est coûteux.
- (−) Montée en charge verticale d'abord ; suffisante pour les volumes visés (`CDC_02` NF-PERF-005).
- (−) Deux langages côté client (Dart, TypeScript).

## Alternatives écartées

| Alternative | Raison |
|---|---|
| Microservices dès le départ | Complexité distribuée injustifiée, cohérence financière plus difficile |
| Firestore / base documentaire | Pas de transactions multi-documents aussi expressives ni de contraintes SQL pour l'ajout seul et l'équilibre |
| Django (Python) | Viable ; écarté pour unifier le langage serveur et web |
| Chaîne de blocs privée pour le grand livre | Voir ADR-0003 |
