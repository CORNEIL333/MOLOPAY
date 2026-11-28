# USSD (and SMS) design for MoloPay financial services in Cameroon (MTN / Orange)

Scope: signup, check goal balance, pay toward a goal, block account, request a callback. Sessions must survive timeouts and drops without double payments. Must work on MTN Cameroon and Orange Cameroun.
Research date: 2026-11-20. Source quality is flagged throughout: **[IND]** = independent (regulator, central bank, ITU, CGAP, academic), **[VENDOR]** = aggregator, operator or vendor docs and blogs, **[PRESS]** = local press.

## Q1. Technical constraints: characters, timeouts, menu depth, cost, aggregators (Cameroon/CEMAC)

### Takeaway
Plan for 160 characters or fewer per screen. Keep each input step well under roughly 30 s of idle time, and keep the whole flow under about 120 s. A USSD session cannot be resumed at network level, so resume has to happen in MoloPay's backend. In Cameroon, USSD access for a third party goes through operator interconnection/VAS catalogues regulated by ART, or through the national #237# switch run by Campost. Public per-session prices for third-party USSD access were not found.

### Cited Findings
**Characters per screen**
- USSD messages are up to 182 alphanumeric characters (spec GSM 02.90 / 03.90; *nnn# format; works on all phase II+ phones). USSD has no store-and-forward, unlike SMS. [IND] — [ITU-T FG DFS, Consumer Experience & Protection, 2017, p.48](https://www.itu.int/en/publications/Documents/tsb/2017-DFS-ConsumerExperienceProtection/files/basic-html/page48.html)
- Clickatell allows 182 characters but recommends staying within 160 because MNOs differ in the maximum they accept. [VENDOR] — [Clickatell FAQ](https://www.clickatell.com/faqs/answer/whats-the-maximum-character-length-for-ussd)
- Africa's Talking gives a 160-character menu limit for Nigerian telcos. Text beyond it is cut off. [VENDOR] — [Africa's Talking help](https://help.africastalking.com/en/articles/2298298-how-long-is-the-duration-of-a-ussd-session-for-nigerian-telcos)

**Session timeouts**
- Africa's Talking (Nigeria): total session 120 s, idle timeout 30 s. [VENDOR] — [Africa's Talking help](https://help.africastalking.com/en/articles/2298298-how-long-is-the-duration-of-a-ussd-session-for-nigerian-telcos)
- ITU material describes 120 s as the typical maximum MNOs allow for an entire USSD session. [IND, cited via search summary of ITU-T FG DFS Tech/Innovation/Competition 2017] — [ITU-T FG DFS 2017](https://www.itu.int/en/publications/Documents/tsb/2017-DFS-TechInnovationCompetition/files/basic-html/page192.html)
- Other vendors give 20–60 s per user input and 180–300 s total, depending on the MNO. Some say "~30 s inactivity". These figures are inconsistent. [VENDOR] — [Arkesel](https://arkesel.com/?p=8796); [Infobip glossary](https://cdn-web.infobip.com/uploads/markdown-exports/www.infobip.com/glossary/ussd.md)
- ITU: "Often USSD sessions drop, leading to a poor customer experience and maybe even loss of funds." Causes include weak signal, congestion, and alleged deliberate throttling. In Uganda, providers "may not have visibility of some failed USSD transactions", and the regulator was investigating session length, quality and wholesale charges. [IND] — [ITU-T FG DFS 2017, p.199](https://www.itu.int/en/publications/Documents/tsb/2017-DFS-TechInnovationCompetition/files/basic-html/page199.html)

**Menu depth / steps**
- MSC (MicroSave), Malawi: most transactions take 4–5 clicks and finish in under 1 minute. A more detailed (unbundled) menu raises the risk of time-out for novice and occasional users. [IND-practitioner, 2017] — [MSC, Saini 2017](https://www.microsave.net/designing-user-friendly-ussd-interface-for-digital-financial-services/)
- CGAP (PEG Africa, Ghana): a standard mobile money bill payment "can take up to a dozen steps". Shortcut USSD strings (STAR) and pay-over-phone reduce it to 2 steps. [IND, 2017] — [CGAP blog](https://www.cgap.org/blog/can-user-friendly-payment-methods-improve-repayment-rates)
- India's TRAI raised the maximum number of USSD menu stages per session from 5 to 8. This shows regulators treat stage count as a usability and cost lever. [IND, via search summary] — [ITU-T FG DFS 2017](https://www.itu.int/en/publications/Documents/tsb/2017-DFS-TechInnovationCompetition/files/basic-html/page195.html)

**Cameroon access, codes and cost**
- Operator wallets: Orange Money uses **#150#** and MTN MoMo uses **\*126#** (lists dated 2021). [PRESS] — [Digital Business Africa, Orange codes 2021](https://www.digitalbusiness.africa/cameroun-tous-les-codes-ussd-et-numeros-courts-chez-orange-en-2021/); [Digital Business Africa, MTN codes 2021](https://www.digitalbusiness.africa/cameroun-tous-les-codes-ussd-numeros-courts-et-forfaits-chez-mtn-en-2021/)
- National USSD code **#237#**: a Minpostel order of 26 Nov 2019 set the rules for using the USSD code for the national aggregation platform. MTN and Orange had to comply from 26 Dec 2019. Campost launched it for mobile financial services in April 2020, and the NPSI (National Payment Switch Infrastructure) platform launched on 5 July 2022 as "un code USSD unique" for all operators and banks. All telecom operators and about 40 companies were connected. Afriland First Bank uses #237\*001#. The technical partner is eTranzact (Nigeria). No pricing was published, only "lower access costs for VAS". [PRESS] — [Osiris, 7 Jul 2022](https://www.osiris.sn/le-cameroun-premier-africain-a-mettre-sur-pied-un-code-ussd-national-a-travers.html); [Osiris, executive imposes code](https://osiris.sn/Au-Cameroun-l-executif-impose-un.html); [ITWeb, start-ups urged to use national gateway](https://itweb.africa/article/cameroons-start-ups-urged-to-leverage-national-payment-gateway/GxwQD71ZgA2MlPVo)
- MTN Cameroon issued a communique telling subscribers that #237# "is not administered by its services". This points to operator friction around the national code. [PRESS] — [ITWeb](https://itweb.africa/article/cameroon-looks-to-level-financial-services-playing-field/KWEBb7yZBGEMmRjO)
- Third-party (VAS provider) USSD access is set by operator interconnection catalogues filed with ART. Each Orange Cameroun–provider agreement takes the form of an interconnection/access convention, and the provider reaches USSD through a code assigned to it. ART decision 173/ART/DG/DLCI/SDIICE/SIAR of 2 Oct 2019 set a **price ceiling** on USSD access offers. The ceiling value itself was not retrieved. [IND-regulator doc, via search summary] — [ART, Catalogue d'interconnexion 2020 – fournisseurs SVA](https://www.art.cm/sites/default/files/documents/catalogue%20da%20interconnexion%202020%20-%20fournisseurs%20sva-converted-compressed.pdf)
- Camtel's interconnection catalogue defines a USSD "session" as the maximum duration of transactions between the subscriber and the USSD platform. [IND-operator doc] — [Camtel catalogue (EN)](https://camtel.cm/wp-content/uploads/2024/01/Projet-CatalogueInterco_CamtelBUM-pour-titulaires-recepisses_Eng.pdf) (the FR version returned 404 when fetched)
- Precedent risk: Express Union's menu on **\*050#** went through VAS provider LMT. It was suspended, and its user price was reportedly raised **from 20 to 153 FCFA** on Orange Cameroun. The regulator ordered it restored, without clear effect. This shows a third party's short code can be priced or cut off by the MNO, which competes with it in mobile money. [PRESS, ~2016–2019] — [Camer.be](https://www.camer.be/actualites/societe/cameroon-cameroun-le-racgulateur-taclaccoms-sainvite-dans-le-conflit-opposant-orange-mtn-et-express-union-sur-le-mobile-money.html); [Camer.be, conditions d'accès aux codes USSD](https://www.camer.be/61563/11:1/cameroon-cameroun-conditions-dacces-aux-codes-ussd-letat-siffle-la-fin-de-la-recreation-dans-le-secteur-des-telecommunications.html)

### Inferences
- Budget 150–160 characters per screen in GSM-7. With UCS-2 (see Q3) the limit drops to about 70–80 characters.
- Design every step to need one short input within about 20 s. Assume about 120 s total, and assume a drop can happen at any time.
- Commercial route options: (a) direct VAS convention with each MNO under its ART catalogue, (b) the #237# NPSI switch (one code across networks, but MTN distances itself from it), or (c) a licensed aggregator. Because MTN and Orange run their own wallets, MoloPay faces a competitor-access risk, as the Express Union \*050# case shows. Avoid dependence on a single channel: keep SMS and a call-back alternative.
- Making USSD free for users (MoloPay pays) is likely essential for low-income users. The 20 FCFA vs 153 FCFA dispute shows the per-session price matters.

### Gaps
- Exact session timeouts for MTN Cameroon and Orange Cameroun: not published, so they must be asked from the MNOs or an aggregator.
- Current USSD wholesale or per-session prices in Cameroon, the ART 2019 ceiling value, and whether \*126# / #150# are free to end users: not found.
- No list was found of independent USSD aggregators active in Cameroon or CEMAC with public pricing. Africa's Talking does not publicly list Cameroon USSD (not verified). Orange Developer's USSD API page for the region returned 404.

## Q2. Best practices with evidence (GSMA, CGAP, MSC, academic) and operator examples

### Takeaway
The evidence base is mostly qualitative practitioner research (MSC, CGAP). The strongest measured result is CGAP's Ghana pilot: cutting a dozen-step USSD payment to 2 steps raised payment frequency by 13% and payment size by 23%. No peer-reviewed study was found that quantifies error or abandonment rates by menu depth.

### Cited Findings
- **CGAP / PEG Africa, Ghana (2016–17):** pay-over-phone users paid **13% more often** and **23% more per payment** than a control group. Adoption of the POP/STAR shortcuts rose from about 5% of users (Dec 2016) to more than 20% (May 2017). 79% of own-wallet payments were then made over the phone. Sample sizes were not stated. [IND] — [CGAP](https://www.cgap.org/blog/can-user-friendly-payment-methods-improve-repayment-rates)
- CGAP: text-based USSD menus exclude illiterate and older customers. Payment friction is "one of the primary reasons" mobile money has not spread faster. [IND] — [CGAP](https://cgap.org/node/2907)
- **MSC (Malawi, 2017) recommendations:** put the most-used services first in the main menu, use simple and uniform wording, keep sub-menu structures consistent across services (for example type → payee → amount → ID → PIN), use numeric replies, show an immediate on-screen ("flash") confirmation rather than relying only on a later SMS, and make network failure visible quickly. [IND-practitioner] — [MSC, Saini 2017](https://www.microsave.net/designing-user-friendly-ussd-interface-for-digital-financial-services/)
- **MSC (India):** users often did not understand sub-menu options, banking jargon was poorly understood, and grouping unrelated options together (such as splitting "Send money" into bank and wallet variants) confused semi-literate users. [IND-practitioner] — [MSC Part 1](https://www.microsave.net/designing-an-effective-user-interface-for-ussd-part-1/); [MSC Part 2](https://www.microsave.net/designing-an-effective-user-interface-for-ussd-part2/)
- A 2024 East African paper finds that complex hierarchical menus lead to frustration and abandonment. This is qualitative, with no rate given. [IND-academic, lower-tier journal] — [EANSO EAJIT](https://www.journals.eanso.org/index.php/eajit/article/download/2174/2861)
- IDEO.org / CGAP: "a mistake that takes less than a second to make can lead to a week of lost wages". This supports confirmation screens and reversibility. [IND] — [CGAP/IDEO.org](https://cgap.org/node/2834)
- Pagination is recommended when a menu needs more than about 5 options. [VENDOR/blog] — [uxdesign.cc](https://uxdesign.cc/back-to-basics-optimising-ux-for-ussd-applications-d7096cfb8c0f)
- MTN MoMo Cameroon offers **\*126\*15#** so users can block unwanted withdrawals. This is a precedent for a short "block" shortcut. [PRESS, 2025] — [Camer.be / AllAfrica, Sep 2025](https://fr.allafrica.com/stories/202509300387.html)

### Inferences
- MoloPay main menu (bilingual, ≤160 chars). Example in French GSM-7: "MoloPay\n1 Payer objectif\n2 Solde objectifs\n3 Etre rappele\n4 Bloquer compte\n5 Mon compte\n0 English" (about 90 chars). Put the most frequent task first.
- Offer direct-dial shortcuts (for example \*code\*1\*goalNo\*amount#) so repeat payers can pay in 1–2 steps, as with STAR in CGAP Ghana.
- "Request a callback" is a strong fallback for illiterate users, since CGAP's pay-over-phone result supports voice-assisted flows.
- The confirmation screen must show the amount, the goal name and the fees before the PIN, for example "Payer 2 000 FCFA vers 'Loyer'. Frais 0. 1 Confirmer 2 Annuler".

### Gaps
- No GSMA document titled "USSD UX design guidelines", and nothing on "CGAP USSD customer journeys" or "MSC smart journeys", came up in searches. Juntos and Ona sources were not retrieved.
- No ACM CHI or ICTD paper with measured USSD error or abandonment rates by depth was found in this pass.
- M-Pesa, Wave, Equitel: no specific measured UX data was retrieved.

## Q3. French accents and bilingual menus, navigation conventions, confirmation, PIN security, SIM swap

### Takeaway
French text can stay in GSM-7 if you avoid ê, â, î, ô, û, ë, ï and lowercase ç. A single such character can force UCS-2 and roughly halve screen capacity. PIN entry on USSD is not end-to-end encrypted and is visible to network insiders, and SIM swap is a top-5 mobile money fraud type. Do not rely on SMS OTP or PIN alone for sensitive actions such as unblocking or changing the phone number.

### Cited Findings
- GSM-7 basic set **includes** é, è, ù, ì, ò, à, É and Ç (uppercase). It **excludes** lowercase ç, ê, â, î, ô, û, ë and ï. No French national language shift table is defined. On many phones a single non-GSM character re-encodes the whole message as UCS-2 (SMS: 160 → 70 characters). [Reference] — [Wikipedia, GSM 03.38](https://en.wikipedia.org/wiki/GSM_03.38) (based on 3GPP TS 23.038)
- **PIN and confidentiality:** the GSM MAP protocol between core nodes "transmits in clear text, and this can enable an insider view PIN and transaction information", because there is no end-to-end encryption. [IND] — [ITU FIGI, Security testing for USSD and STK, 2020](https://www.itu.int/en/publications/Documents/tsb/2020-FIGI-Security-testing-for-USSD-and-STK/files/basic-html/page11.html)
- CGAP: USSD is the most common access channel for mobile money but "does not offer much protection" for credentials. A network insider can log credentials as users enter them, and attackers send fake USSD pushes asking users to re-enter their PIN. [IND] — [CGAP, Cybersecurity for Mobile Financial Services](https://cgap.org/node/3493)
- USSD has no masked PIN entry, so it is exposed to shoulder surfing. [IND, MSc dissertation, 2024] — [Staffordshire dissertation](https://gradex.staffs.ac.uk/wp-content/uploads/2024/05/4931_Dissertation-22025073-Somtochukwu-Anunobi.pdf); see also [Univ. Portsmouth, USSD banking authentication vulnerabilities (IEEE CSR 2023)](https://researchportal.port.ac.uk/en/publications/exposed-critical-vulnerabilities-in-ussd-banking-authentication-p/)
- ThinSIM attacks can capture credentials and make transactions. Most STK apps use a 4-digit PIN. [IND-academic, COMPASS 2018; slide deck only seen] — [UW DFS talk](https://dfs.cs.washington.edu/docs/talks/2018/rowan_compass_2018.pdf)
- GSMA (Mar 2024) lists SIM swap among the top 5 mobile money fraud types. [IND-industry body] — [GSMA Fraud Typologies 2024](https://www.gsma.com/mobilefordevelopment/wp-content/uploads/2024/03/GSMA-Fraud-Typologies-04-03-24.pdf)
- Cameroon: SIM cards pre-registered with stolen identities were reported in an op-ed (Dec 2025). Victims describe repeated USSD PIN prompts being used to debit accounts, and complaints about MoMo/Orange Money scams number "in the thousands" (single source, not official). [PRESS] — [Financial Afrik, Dec 2025](https://www.financialafrik.com/2025/12/11/la-fraude-par-echange-de-carte-sim-une-menace-criante-pour-linclusion-financiere-en-afrique); [237online](https://www.237online.com/?p=187998)

### Inferences
- Write menus in GSM-7-safe French: "Etre rappele", "Recu", "Depot"; keep é/è/à, drop ê/ç. Alternatively accept UCS-2 and cap screens at about 70–80 characters. Test both on MTN and Orange handsets, because UCS-2 handling varies.
- Language: offer FR/EN on the first screen for a new MSISDN, store the choice, and keep a "0 English / 0 Francais" toggle. "0 Retour" and "00 Accueil" are common conventions. No study was found validating them.
- Treat the MoloPay PIN as a weak factor. The goal payment itself is authorised by the MNO wallet's own PIN prompt (MoMo/OM collection API), so MoloPay should avoid collecting the wallet PIN in its own USSD menu. Add risk checks for "block account" and recovery: callback plus ID questions, and a cooling period after a SIM change if the MNO exposes a SIM-swap date API. Blocking should be one step and need no PIN, since blocking is low-risk. Unblocking should be hard.

### Gaps
- Whether MTN Cameroon or Orange Cameroun expose SIM-swap-date checks (for example via GSMA Open Gateway / CAMARA) to third parties: not verified.
- Whether USSD gateway logs at Cameroonian MNOs or aggregators store PIN input: no source found beyond the ITU and CGAP insider-risk statements.

## Q4. Resilience: drops, idempotency, resume, SMS receipts

### Takeaway
USSD sessions drop often and outcomes can be invisible to the provider (ITU). Create the payment intent server-side with a stable idempotency key before calling the MNO. On any new session, query status before offering a retry, treat "unknown" as pending, and always send an SMS receipt because the USSD screen may never be displayed.

### Cited Findings
- Dropped sessions may cause loss of funds. In Uganda, providers lacked visibility of some failed USSD transactions. [IND] — [ITU-T FG DFS 2017, p.199](https://www.itu.int/en/publications/Documents/tsb/2017-DFS-TechInnovationCompetition/files/basic-html/page199.html)
- ITU: in DFS, USSD is used for command and control, while SMS pushes results and updates. [IND] — [ITU-T FG DFS 2017, p.48](https://www.itu.int/en/publications/Documents/tsb/2017-DFS-ConsumerExperienceProtection/files/basic-html/page48.html)
- Mobile money collection APIs can leave a transaction PENDING after a timeout. Integrators should poll the status endpoint if the webhook is unavailable, and the same status may arrive both synchronously and via webhook. The authorisation window is about 30 s and varies by MNO. [VENDOR] — [TemboPlus MoMo collection flow](https://tembo.gitbook.io/tembo/reference/mobile-money-collection/momo-collection-flow)
- Idempotency pattern: the client persists a unique operation key and reuses it on retries, and the server deduplicates on that key. An idempotency key does not stop a *new* authorisation for the same payment after a timeout, so business-level dedup is needed. [VENDOR/blog] — [DZone](https://dzone.com/articles/retry-safe-mobile-apis); [HackerNoon](https://hackernoon.com/the-idempotency-problem-in-african-cross-border-settlement)
- Safaricom Daraja locks at subscriber level to prevent concurrent duplicate transactions. [VENDOR/blog, via search summary] — [HackerNoon](https://hackernoon.com/the-idempotency-problem-in-african-cross-border-settlement)
- MSC: give immediate on-screen confirmation and do not rely only on SMS. [IND-practitioner] — [MSC 2017](https://www.microsave.net/designing-user-friendly-ussd-interface-for-digital-financial-services/)

### Inferences
- Resume design: store session state keyed by MSISDN (not the USSD sessionId, which changes) with a TTL of about 10–15 minutes. On redial, show "Vous avez un paiement en cours: 2 000 FCFA vers Loyer. 1 Voir statut 2 Reprendre 3 Annuler".
- One pending payment per (user, goal, amount) within a time window. The payment intent ID serves as the idempotency key to the MNO, and reconciliation jobs settle PENDING/unknown states.
- Send an SMS receipt (GSM-7, ≤160 characters) for every completed payment, block and signup: reference, amount, goal, new goal balance, date.

### Gaps
- No Cameroon-specific data on USSD drop rates for MTN or Orange.

## Q5. Usage data: USSD vs app share (Africa / Cameroon), 2020–2026

### Takeaway
GSMA measures channel *offering* by providers, not transaction share. Globally in 2023 apps (50%) overtook USSD (49%) for the first time as a proximity payment mechanism among surveyed providers. Sub-Saharan Africa was 57% / 57%. Cameroon is the CEMAC mobile money heavyweight. No Cameroon USSD-vs-app transaction split was found.

### Cited Findings
- GSMA SOTIR 2024: app access surpassed USSD for the first time as a proximity payment mechanism. App was 50% and USSD 49% of survey participants globally. In Sub-Saharan Africa, app and USSD were each 57%. [IND-industry body; provider survey, not transaction share] — [GSMA SOTIR 2024 Deep Dive 1](https://www.gsma.com/solutions-and-impact/connectivity-for-good/mobile-for-development/wp-content/uploads/2024/10/GSMA-SOTIR-2024-Deep-Dive-1.pdf); [GSMA SOTIR 2024 regional cuts](https://www.gsma.com/solutions-and-impact/connectivity-for-good/mobile-for-development/wp-content/uploads/2024/10/SOTIR-2024-regional-cuts.pdf)
- GSMA SOTIR 2025: app and USSD channels are each offered by over half of SSA providers. Exact percentages were unreadable in the extract. [IND] — [GSMA SOTIR 2025 Regional Cuts](https://www.gsma.com/solutions-and-impact/connectivity-for-good/mobile-for-development/wp-content/uploads/2025/10/SOTIR-2025-Regional-Cuts_r.pdf)
- Nigeria (CBN data via press): USSD transaction value fell to ₦2.19 trn in H1 2024 from ₦4.84 trn a year earlier, while app payments grew. This is a bank-USSD context. [PRESS citing central bank] — [TechCabal](https://techcabal.com/?p=171674)
- CEMAC 2024 (BEAC report via press): Cameroon has 30.9 m mobile money accounts (24.86 m in 2023), described as 65% of CEMAC accounts. There were more than 3.74 bn transactions in CEMAC (+6.42%). Value figures conflict across outlets (3,072 bn FCFA vs 34,788 bn FCFA). The primary BEAC PDF could not be fetched (HTTP 502). [PRESS citing BEAC] — [Osiris](https://osiris.sn/mobile-money-le-cameroun-domine-l-espace-cemac-avec-65-des-comptes-en-2024.html); [Cameroun24](https://cameroun24.net/article/73868-mobile-money-le-cameroun-ecrase-la-cemac-avec-30-9-millions-de-comptes-et-plus-de-26-000-milliards-fcfa-de-transactions.html); [BEAC report 2024 (primary)](https://www.beac.int/wp-content/uploads/2026/04/RAPPORT-SUR-LES-SERVICES-DE-PAIEMENT-DANS-LA-CEMAC-2024-.pdf)
- "Plus de 60% des adultes" in Cameroon use a mobile wallet (press, Apr 2026, unsourced). [PRESS] — [AllAfrica, Apr 2026](https://fr.allafrica.com/stories/202604080164.html)

### Inferences
- Apps are growing, but USSD remains offered by most SSA providers and remains the baseline channel for feature-phone and low-data users. For MoloPay's target users, USSD + SMS + callback should be first-class, not a fallback.

### Gaps
- No GSMA or BEAC figure for the share of Cameroon or CEMAC mobile money *transactions* by channel (USSD vs app). The BEAC 2024 report should be checked directly.
- Smartphone penetration figures for Cameroon were not retrieved in this pass.
