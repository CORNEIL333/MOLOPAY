# Dark patterns, legal limits of behavioral design in financial apps, and ethical nudging: what MoloPay must forbid itself

Scope: savings-to-purchase fintech in Cameroon for modest-income customers. In model B, a licensed lender provides the credit. Research date: 20 Nov 2026.
Legend: **[verified]** means the primary source or a reliable secondary source was read in this session. **[background, not re-verified]** means the item comes from well-established literature and a canonical URL is given, but it was not re-fetched this session. The report writer should treat those items with slightly lower confidence.

---

## 1. Taxonomies of dark patterns (Mathur 2019, Gray 2018/2024, Brignull/deceptive.design)

### Takeaway
The academic taxonomies agree on a stable core: sneaking/hidden costs, false urgency/scarcity, fake social proof, misdirection (confirmshaming, trick questions, visual interference, preselection), obstruction (roach motel / hard to cancel), nagging, and forced action. Mathur et al. found these patterns in roughly 11% of the product pages they crawled at scale, and found some of them to be outright lies (fake timers, fake stock messages). Most of them have a direct analogue in a savings, BNPL or credit flow.

### Cited Findings
- **Mathur et al. 2019 ("Dark Patterns at Scale", CSCW 2019).** The crawl covered about 11K shopping websites and about 53K product pages. It found **1,818 dark pattern instances** representing **15 types in 7 broader categories**. **183 websites** were found to engage in deceptive practices, and **22 third-party entities** offer dark patterns as a turnkey solution. [verified] — [arXiv:1907.07032](https://arxiv.org/abs/1907.07032)
- The 7 Mathur categories and their 15 types:
  - **Sneaking:** sneak into basket, hidden costs, hidden subscription.
  - **Urgency:** countdown timers, limited-time messages.
  - **Misdirection:** confirmshaming, visual interference, trick questions, pressured selling.
  - **Social proof:** activity messages, testimonials of uncertain origin.
  - **Scarcity:** low-stock messages, high-demand messages.
  - **Obstruction:** hard to cancel.
  - **Forced action:** forced enrollment.

  [background, not re-verified] — [arXiv:1907.07032](https://arxiv.org/abs/1907.07032). The exact counts of 11,286 sites and 53,180 pages, and the figure of "234 deceptive instances" across those 183 sites, are from memory of the paper body. The abstract read this session confirms only the rounded figures and the 183 sites.
- **Gray et al. 2018 ("The Dark (Patterns) Side of UX Design", CHI 2018)** groups dark patterns under five strategies: **nagging, obstruction, sneaking, interface interference, forced action**. [background, not re-verified] — [ACM DL](https://dl.acm.org/doi/10.1145/3173574.3174108)
- **Gray, Santos, Bielova & Mildner 2024 ("An Ontology of Dark Patterns Knowledge", CHI 2024)** merges about 10 regulatory and academic taxonomies into a three-level ontology (high-level, meso-level and low-level patterns). The five high-level patterns are obstruction, sneaking, interface interference, forced action, and social engineering. [background, not re-verified; exact counts of meso and low-level types not confirmed] — [ACM DL](https://dl.acm.org/doi/10.1145/3613904.3642436)
- **Brignull / deceptive.design types:**
  - Comparison prevention: makes it hard to compare prices or plans.
  - Confirmshaming: guilt wording on the decline option, e.g. "No thanks, I don't want to save money".
  - Disguised ads.
  - Fake scarcity.
  - Fake social proof.
  - Fake urgency.
  - Forced action.
  - Hard to cancel (formerly "roach motel").
  - Hidden costs: fees revealed only at the last step.
  - Hidden subscription (formerly "forced continuity").
  - Nagging.
  - Obstruction.
  - Preselection: pre-ticked add-ons, such as insurance or "round-up" options.
  - Sneaking.
  - Trick wording (trick questions).
  - Visual interference.

  [background, not re-verified] — [deceptive.design/types](https://www.deceptive.design/types)
- **FTC staff report "Bringing Dark Patterns to Light" (September 2022)** organises dark patterns into four groups: (1) designs that induce false beliefs, such as fake countdowns or false limited-stock claims; (2) designs that hide or delay material information, such as drip pricing or a free trial that converts to paid; (3) designs that lead to unauthorized charges, such as hard-to-cancel subscriptions; and (4) designs that obscure or subvert privacy choices. [verified: date and title; the categories are confirmed by law-firm summaries, not by the PDF itself] — [FTC report page](https://www.ftc.gov/reports/bringing-dark-patterns-light); [Hunton summary](https://www.hunton.com/privacy-and-cybersecurity-law-blog/ftc-releases-report-on-dark-patterns); [Freshfields](https://technologyquotient.freshfields.com/post/102i3gd/bringing-dark-patterns-to-light-the-ftc-warns-companies-against-manipulative-u). One law firm describes eight primary categories rather than four, so sources differ on framing ([AGG](https://www.agg.com/news-insights/publications/the-ftc-blacklists-dark-patterns/)).
- **OECD "Dark Commercial Patterns" (OECD Digital Economy Papers No. 336, October 2022)** proposes a working definition and a taxonomy that combines the categories above (forced action, interface interference, nagging, obstruction, sneaking, social proof, urgency). It flags that consumers who are vulnerable or under financial or time pressure may be disproportionately harmed. [background, not re-verified] — [OECD](https://www.oecd.org/en/publications/dark-commercial-patterns_44f5e846-en.html)

### Inferences
Mapping to MoloPay flows:

| Dark pattern | Where it would show up in a savings-to-purchase / credit app |
|---|---|
| Hidden costs | Fees on withdrawal, cash-out or early exit of a savings goal revealed only at the confirmation step |
| Preselection | Pre-ticked "add insurance", "top up with credit", or "switch to model B credit" |
| Fake urgency | "Price ends in 02:59" on a merchant product when no real deadline exists |
| Fake scarcity / social proof | "Only 2 left" or "34 people in Douala are saving for this" without real data |
| Confirmshaming | "No, I prefer to stay poor" as the decline wording on a savings or credit upsell |
| Hard to cancel / roach motel | Easy to start an automatic savings debit, hard to stop it or to recover savings |
| Trick wording | Double negatives in consent screens, such as data-sharing with the lender |
| Nagging | Repeated pushes to "convert your savings goal to credit now" |
| Forced action | Requiring contacts or gallery access, or requiring credit opt-in, to use savings |

### Gaps
- The exact meso-level and low-level counts in Gray et al. 2024 were not confirmed.
- The OECD paper number and URL were not re-fetched.

---

## 2. Regulator positions and legal exposure (US, EU, UK, Kenya, Nigeria, Cameroon/CEMAC)

### Takeaway
Regulators converge on three points: interfaces must not deceive or materially distort free and informed decisions; cost must be disclosed fully before commitment; and cancelling must be as easy as signing up. African digital-lending regulators (Kenya 2022, Nigeria 2025) have gone further, with explicit bans on debt-shaming, on access to contacts and photos, and on automatic or pre-authorised lending. In Cameroon, Loi-cadre n° 2011/012 has no "dark pattern" wording. However, its definition of "pratique commerciale inéquitable" explicitly covers a "représentation visuelle" that undermines fairness. It also mandates bilingual, clear information (Art. 13), written credit-cost disclosure (Art. 9) and a 14-day withdrawal right (Art. 7), and it criminalises misleading information (Art. 32). CEMAC/BEAC rules then add TEG disclosure on top of these.

### Cited Findings

#### Cameroon: Loi-cadre n° 2011/012 du 6 mai 2011 portant protection du consommateur au Cameroun [verified, full text read]
Source for all items below: [Texte officiel (ART)](https://www.art.cm/sites/default/files/documents/loi_cadre_2011_012_06052011_protect_conso.pdf)
- **Art. 2, definition:** "Pratique commerciale inéquitable : toute pratique commerciale qui, dans le cadre de la promotion de la vente, de l'utilisation ou de la fourniture d'un bien, d'un service ou d'une technologie, adopte une méthodologie, y compris la déclaration orale, écrite ou la représentation visuelle, qui porte atteinte à l'équité dans une transaction".
- **Art. 2, definition:** "Clause abusive : toute clause qui est ou qui semble être imposée au consommateur par un fournisseur ou prestataire de service qui a une supériorité économique sur le consommateur, donnant au premier un avantage injuste, déraisonnable ou excessif sur le second".
- **Art. 2, definition:** "Pratique commerciale restrictive" means requiring a purchase as a condition for obtaining another good or service, i.e. tying.
- **Art. 4:** unfair, restrictive or anti-competitive practices and abusive clauses "doivent être réglementés et contrôlés et, autant que faire se peut, interdits".
- **Art. 5(1):** contract clauses are null where they exclude or limit supplier liability, entail "la perte des droits et libertés garantis au consommateur", create "termes ou conditions contractuels injustes, déraisonnables, inéquitables, répressifs", or "imposent une clause d'arbitrage unilatérale".
- **Art. 5(2):** courts may declare these clauses null of their own motion ("d'office").
- **Art. 6(1):** standard-form or adhesion contracts must be "rédigés en français et en anglais en caractères visibles et lisibles à première vue".
- **Art. 6(2):** they must use "termes clairs et compréhensibles pour le grand public" and must not refer to documents not made available to the consumer.
- **Art. 6(3):** each party keeps a copy.
- **Art. 7:** right of withdrawal "dans un délai ne pouvant excéder quatorze (14) jours" when the contract was concluded at the supplier's initiative.
- **Art. 8(1):** "la publicité erronée, mensongère ou abusive" is "strictement interdite".
- **Art. 9 (consumer credit):** the supplier "est tenu d'informer le consommateur par écrit sur le prix comptant, le montant de l'intérêt, le taux annuel à partir duquel cet intérêt est calculé, le taux d'intérêt sur les arriérés, le nombre de traite payables, la fréquence et la périodicité de ces traites et le montant total à payer".
- **Art. 12(1):** a sale conditioned on buying another good or service is prohibited. This is directly relevant to any "you must take credit or insurance to buy" design.
- **Art. 13:** "une information juste, suffisante, claire et lisible", in French and English, before the contract is concluded.
- **Art. 14:** advertising must comply with the rules on price advertising and sale conditions.
- **Art. 32(1):** 6 months to 2 years' imprisonment and/or a fine of 200,000 to 1,000,000 FCFA for anyone who "fournit des informations erronées sur la qualité des technologies, biens ou services".
- **Art. 33:** legal persons can be fined double, i.e. up to 2,000,000 FCFA.
- **Art. 34(1):** where harm results, compensation "est doublé".
- **Art. 35:** clauses limiting liability or guarantees are null.
- **Art. 37:** consumer contracts "doivent être interprétés de manière à préserver les droits des consommateurs".
- **Art. 30:** a "comité de recours" (consumer arbitration committee) is created in each arrondissement.
- Commentary confirms that the Art. 5 list is indicative, not exhaustive, and that consumer associations can bring preventive actions to suppress abusive clauses. [verified, secondary] — [Mémoire, memoireonline](https://www.memoireonline.com/04/15/9081/Les-contrats-d-adhesion-a-l-epreuve-de-la-loi-cadre-n2011012-du-06-mai-2011-portant-protection-d.html)

#### CEMAC / BEAC / COBAC
- **Règlement N° 04/19/CEMAC/UMAC/CM** covers the TEG (taux effectif global), usury repression and publication of bank conditions. It is dated 10 August 2020. [verified, secondary] — [Droit Médias Finance](https://droitmediasfinance.com/index.php/actualites/droit-bancaire/295-cemac-la-beac-precise-les-regles-liees-au-taux-effectif-global-aux-conditions-de-banque-et-aux-prix-des-services-financiers)
- **BEAC Governor's instruction**, in force 4 November 2021, which appears to be Instruction N°004/2021 ([BEAC PDF](https://www.beac.int/wp-content/uploads/2021/12/Instruction-du-Gouverneur-N°004-2021_compressed.pdf)). [verified, secondary] — [Droit Médias Finance](https://droitmediasfinance.com/index.php/actualites/droit-bancaire/295-cemac-la-beac-precise-les-regles-liees-au-taux-effectif-global-aux-conditions-de-banque-et-aux-prix-des-services-financiers)
  - The TEG must include principal, interest and all fees and charges known at signing.
  - For **loans conditioned on prior savings**, the TEG calculation must take into account the required savings period. This is directly relevant to a MoloPay save-then-credit model B.
  - Institutions declare individual TEGs monthly to their national CNEF, within 15 calendar days.
  - They declare bank conditions and fee prices quarterly.
  - The BEAC publishes comparative data each quarter.
  - Late declarations attract a penalty of 250,000 FCFA per day for the first 15 days and 500,000 FCFA per day thereafter.
- An earlier text, Règlement n°1/CEMAC/UMAC/CM (2012) on the TEG and publication of bank conditions, had already made tariff publication mandatory. In H1 2019, 11 of 15 Cameroonian banks had published tariffs in Cameroon Tribune at least once. [verified, secondary via search summary] — [Ecomatin](https://ecomatin.net/informations-bancaires-les-banques-rusent-avec-la-publication-des-conditions-tarifaires); [BEAC Bulletin](https://www.beac.int/wp-content/uploads/2020/05/BOP-N°03.pdf)
- **Règlement n° 01/20/CEMAC/UMAC/COBAC relatif à la protection des consommateurs des produits et services bancaires dans la CEMAC**:
  - Dated 3 July 2020, in force 1 January 2021.
  - Art. 5 institutes a free "service bancaire minimum".
  - Arts. 34–35 set out a complaints procedure, detailed in **COBAC R-2020/06** of 30 July 2020.
  - **COBAC R-2020/04** organises the guaranteed minimum banking service.

  [verified, secondary] — [Kalieu-Elongo](https://kalieu-elongo.com/un-nouveau-reglement-cemac-pour-la-protection-des-consommateurs-de-services-et-produits-bancaires/); [Lextenso](https://www.labase-lextenso.fr/l-essentiel-droits-africains-des-affaires/2021-n1/la-consommation-des-produits-et-services-bancaires-en-toute-securite-DAA113s8)
- **Règlement n° 25/CEMAC/UMAC/CM/COBAC of 19 December 2025** governs listing ("mise à l'index") of clients of COBAC-supervised institutions for non-repayment of credit. It is relevant to model B, because defaults could lead to blacklisting. Its content was not read. [verified: existence only] — [Lextenso PDF](https://www.labase-lextenso.fr/documents/standard/regl-n-25-cemac-umac-cm-cobac-19-dec-2025-relatif-a-la-mise-a-l-index-des-clients-des-etablissements-assujettis-a-la-cobac-en-matiere-de-non-remboursement-de-credit-69a70cc27abe1266948713.pdf)

#### Nigeria: FCCPC Digital, Electronic, Online, or Non-Traditional Consumer Lending Regulations, 2025 [verified, gazette text read]
Source: [FCCPC PDF](https://fccpc.gov.ng/wp-content/uploads/2025/08/DIGITAL-CONSUMER-LENDING-2025-LATEST.pdf)
- **Reg. 17 (Disclosure and Transparency):**
  - **17(a):** interest rates, repayment terms and associated fees must be "fully disclosed to consumers before any transaction is completed", in language "comprehensible to the average consumer, and in such manner that shall not be misleading or deceptive".
  - **17(b):** lending rates and costs must be displayed conspicuously.
  - **17(e):** adverts must not "exaggerate the benefits".
  - **17(f):** unsolicited marketing must offer "a simple, clear and efficient option to unsubscribe".
- **Reg. 18(b):** unfair terms include unilateral changes without stated circumstances, and waivers of legal protection.
- **Reg. 19 (Responsible Business Conduct):**
  - **19(e):** lenders must "not impose any of the Consumer Lending Services on the consumers, including through incessant, excessively targeted advertisement". This is effectively a ban on nagging.
  - **19(f):** no fees for unrequested products.
  - **19(g):** no tying of lending to other services.
  - **19(h):** "credit advances shall be provided on an opt-in basis only. Consumers shall actively request and consent … automatic or pre-authorized lending is strictly prohibited". This bans preselection and default enrolment in credit.
  - **19(i):** affordability assessment is required.
  - **19(k):** no "unethical and unprofessional" marketing.
- **Reg. 21(b):** a statement of account must be provided within 24 hours of the consumer's request.
- **Reg. 22(d):** complaints must be resolved within 24 hours, and never later than 48 hours.
- **Reg. 23:** the Commission monitors interest rates so that they are "not exploitative".
- **Schedule 1, Form 001, item 15:** the applicant must confirm that its apps "are not designed to and will not have access to consumer call logs, contacts and photos/gallery".
- **Reg. 27 (Penalties):**
  - Natural person: up to N50,000,000.
  - Body corporate: up to "N100,000,000 … or 1% of its turnover in the previous year, whichever is greater".
  - Directors can be disqualified for up to 5 years.
- Press coverage reports an effective date of 21 July 2025 and a 90-day registration window. [verified, secondary] — [TechCabal](https://techcabal.com/2025/08/13/fccpc-digital-lenders-fines-nigeria-2025/); [TheCable](https://www.thecable.ng/n100m-fine-for-noncompliance-fccpc-unveils-rules-for-digital-lenders-to-curb-harassment)
- Note: the version read is a gazette-format text with placeholder numbering ("No. 00"). A specific clause list on debt-recovery conduct was not found in it, so the anti-harassment provisions may sit in the separate FCCPC Limited Interim Regulatory Framework (2022). Press articles describe the 2025 rules as targeting "abusive loan recovery tactics, harassment".

#### Kenya: Central Bank of Kenya (Digital Credit Providers) Regulations, 2022
- The regulations prohibit:
  - "threats, violence" and "obscene or profane language against customers or their references or contacts for purposes of shaming them";
  - accessing a borrower's phone book or contacting borrower contacts during debt collection;
  - publishing borrower information to shame them;
  - "any conduct that harasses, oppresses or abuses" a person in connection with debt collection.

  [verified, secondary press; regulation numbers not confirmed] — [Capital FM](https://capitalfm.africa/digital-lenders-barred-from-accessing-customers-contacts-under-new-law/); [Citizen Digital](https://citizen.digital/business/cbk-stops-digital-lenders-from-calling-customer-contacts-in-debt-collection-n289198); [Standard](https://standardmedia.co.ke/news/article/2001440939/central-bank-rescues-borrowers-from-fangs-of-digital-loan-sharks)
- Sanctions reported: licence revocation, and fines for directors of up to KSh 500,000, jail of up to 5 years, or both. These figures come from press reporting on the draft. [verified, secondary] — [People Daily](https://peopledaily.digital/business/digital-lenders-dealt-a-blow-in-new-cbk-regulations/amp)
- Gazetted as Kenya Gazette Supplement, 18 March 2022. The Legal Notice number is not confirmed. [verified, secondary] — [TechCrunch](https://techcrunch.com/2022/03/23/digital-lenders-in-kenya-must-disclose-source-of-funds-as-new-law-takes-effect)
- Enforcement is incomplete: Business Daily reports that debt-shaming has returned among some licensed lenders. [verified, headline] — [Business Daily](https://www.businessdailyafrica.com/bd/economy/debt-shaming-back-as-digital-lenders-defy-cbk-5094888)

#### European Union
- **Digital Services Act (Regulation (EU) 2022/2065), Art. 25(1)** states: "Providers of online platforms shall not design, organise or operate their online interfaces in a way that deceives or manipulates the recipients of their service or in a way that otherwise materially distorts or impairs the ability of the recipients of their service to make free and informed decisions."
  - **Art. 25(2):** Art. 25 does not apply to practices covered by the UCPD or the GDPR.
  - **Art. 25(3):** the Commission may issue guidelines on (a) giving more prominence to certain choices; (b) repeatedly requesting a choice already made, especially by pop-up; and (c) making termination of a service more difficult than subscribing to it.
  - Recital 67 gives examples.

  [background, not re-verified] — [EUR-Lex 2022/2065](https://eur-lex.europa.eu/eli/reg/2022/2065/oj)
- **UCPD (Directive 2005/29/EC)** and the Commission Guidance (2021/C 526/01) treat dark patterns under the general clause (Art. 5) and under misleading actions and omissions (Arts. 6–7) and aggressive practices (Arts. 8–9). Annex I item 7 blacklists falsely stating that a product is available only for a very limited time to elicit an immediate decision. [background, not re-verified] — [EUR-Lex guidance 2021/C 526/01](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52021XC1229(05))
- **Digital Fairness Act proposal, published 11 November 2026** (reported as COM(2026) 1100):
  - Legal form: a regulation replacing the UCPD.
  - **Art. 10** generally bans interfaces likely to deceive, manipulate or materially distort consumer behaviour, with an Annex I blacklist. One source says the blacklist has 10 items.
  - **Arts. 20–25** cover subscriptions:
    - A free trial cannot convert to paid without a reminder and express agreement.
    - Auto-renewal reminders are required 14 days to 1 month ahead for contracts of 6 months or more, and at least 1 week ahead for shorter ones.
    - An online "terminate the contract" button is mandatory.
  - **Arts. 14–17** cover addictive design: users must be able to switch off streaks, autoplay and non-interaction notifications.
  - **Art. 13** prohibits personalised pricing that is reasonably likely to harm minors or vulnerable consumers.
  - Fines run up to 6% of worldwide turnover in Commission-led cases.
  - Expected in force no earlier than 2028.

  [verified, secondary law-firm memo] — [Paul Weiss](https://www.paulweiss.com/insights/client-memos/european-commission-proposes-the-digital-fairness-act); [Lewis Silkin](https://www.lewissilkin.com/insights/2026/11/11/european-commission-publishes-long-awaited-digital-fairness-act-102o9b5); [PPC Land](https://ppc.land/eus-digital-fairness-act-would-let-brussels-fine-firms-up-to-6-of-turnover/). Some older explainers still describe the proposal as forthcoming, and those are outdated.

#### United Kingdom
- **FCA Research Note "Digital design in financial products and services"** was published 31 July 2025 (authors Belton, Bogiatzis-Gibbons et al.).
  - It defines **sludge** as "excessive friction that hinders consumers from making decisions in their interests, by taking advantage of their behavioural biases", and **deceptive design** as "user interface elements which may lead consumers into taking actions which may be against their best interests".
  - A January 2022 online experiment in a consumer-credit journey found that "digital design matters" for comprehension and choice. The numerical results are in the annex, which was not read.
  - The note states that under the Consumer Duty firms must ensure that no aspect of their business unfairly exploits consumers' behavioural biases.

  [verified] — [FCA research note](https://www.fca.org.uk/publications/research-notes/digital-design-financial-products-services); [PDF](https://www.fca.org.uk/publication/research-notes/digital-design-financial-products-services.pdf)
- **Consumer Duty (PRIN 2A, FCA PS22/9 and FG22/5, in force 31 July 2023)** sets four outcomes: products and services, price and value, consumer understanding, and consumer support. Under the consumer support outcome, firms must not create unreasonable barriers ("sludge"), and exit or switching must be no harder than buying. [background, not re-verified; exact PRIN 2A wording not confirmed] — [FCA FG22/5](https://www.fca.org.uk/publication/finalised-guidance/fg22-5.pdf)
- **CMA "Online Choice Architecture: How digital design can harm competition and consumers"** (Discussion Paper CMA155, April 2022) sets out a taxonomy of choice structure, choice information and choice pressure. [background, not re-verified] — [GOV.UK](https://www.gov.uk/government/publications/online-choice-architecture-how-digital-design-can-harm-competition-and-consumers)
- The **Digital Markets, Competition and Consumers Act 2024** gives the CMA direct fining powers for consumer law breaches of up to 10% of global turnover. It also blacklists drip pricing, fake reviews and related practices. These provisions have applied since April 2025. [background, not re-verified]

#### United States
- **FTC v. Amazon (Prime)** settled on 25 September 2025 for **$2.5 billion**:
  - $1 billion civil penalty and $1.5 billion in refunds to about 35 million consumers.
  - Claims were brought under FTC Act §5 and ROSCA, alleging manipulative enrolment interfaces and a hard-to-cancel flow (internally codenamed "Iliad").
  - It is the largest civil penalty for an FTC rule violation.
  - The order requires a simplified cancellation process.

  [verified, secondary] — [Jurist](https://www.jurist.org/news/2025/09/ftc-settles-amazon-prime-deceptive-practices-suit-for-2-5b/); [Alston & Bird](https://www.alston.com/en/insights/publications/2025/10/ftc-settlement-prime-subscription-practices)
- The FTC "Click-to-Cancel" amended Negative Option Rule (October 2024) was vacated by the 8th Circuit in July 2025. ROSCA and §5 remain the enforcement basis. [background, not re-verified]
- **CFPB:**
  - Withdrew its 2024 BNPL interpretive rule, which treated BNPL as credit cards under TILA/Reg Z, on 12 May 2025. This was part of 67 guidance withdrawals, and the CFPB said it would not reissue the rule.
  - States are filling the gap: New York passed a BNPL Act in 2025, and seven state AGs sent letters to BNPL providers in December 2025.

  [verified, secondary] — [Cooley](https://www.cooley.com/news/insight/2025/2025-05-15-cfpb-withdraws-guidance-documents-in-shift-from-nonbinding-policymaking); [CFPB BNPL page](https://www.consumerfinance.gov/compliance/compliance-resources/consumer-cards-resources/buy-now-pay-later-bnpl-products/); [Consumer Finance Monitor (CRS, Mar 2026)](https://www.consumerfinancemonitor.com/2026/03/17/crs-says-policymakers-are-facing-myriad-of-bnpl-issues/)
- Earlier CFPB positions under the UDAAP framework (abusive practices) include the 2023 Policy Statement on Abusive Acts or Practices, which covers exploiting "lack of understanding", and the 2023 Circular 2023-01 on negative options. These positions are under review or rescinded since 2025, so they serve as reference material only. [background, not re-verified]

### Inferences
- **Legal exposure for MoloPay in Cameroon is real even without the term "dark pattern".**
  - A fake countdown or a hidden fee is arguably a "représentation visuelle qui porte atteinte à l'équité" (Art. 2), "publicité mensongère" (Art. 8) or "informations erronées" (Art. 32). The last carries criminal penalties, doubled for legal persons, plus doubled damages under Art. 34.
  - Tying credit or insurance to a purchase falls under Art. 12.
  - A contract and app terms that are not bilingual and readable breach Art. 6 and Art. 13.
- **In model B, the licensed lender (COBAC-supervised) carries TEG obligations.** For credit conditioned on prior savings, the TEG must reflect the savings period. MoloPay's interface must therefore show the lender's TEG and the "montant total à payer" (Art. 9 of law 2011/012) before commitment, not after.
- **Nigeria and Kenya are the best regional blueprints for a voluntary charter**, ahead of probable future CEMAC rules. Their key provisions are:
  - opt-in-only credit;
  - no access to contacts, call logs or gallery;
  - no debt-shaming and no contact with third parties;
  - no "incessant, excessively targeted advertisement";
  - complaints resolved within 24–48 hours.
- **The EU DFA and the UK Consumer Duty set the global "best practice" bar.** MoloPay can cite them as its benchmark:
  - cancel as easy as subscribe;
  - renewal reminders;
  - user can switch off streaks and nudging notifications;
  - no personalised pricing on vulnerable users.

### Gaps
- The exact article numbers of the Kenya DCP Regulations 2022 and the Legal Notice number were not retrieved.
- The full text of Règlement 01/20/CEMAC/UMAC/COBAC was not read, so I could not check whether it covers payment institutions or e-money issuers, or whether it addresses digital interfaces. The same applies to Règlement 04/19, including whether it covers EMF and microfinance and what the current usury thresholds are.
- No Cameroon-specific rule on digital or mobile lending UX, and no CEMAC dark-pattern guidance, was found. Whether a Cameroonian Ministry of Commerce décret d'application listing abusive clauses exists was not confirmed.
- The ANTIC/Cameroon data-protection law (Loi n° 2024/017 du 23 décembre 2024 on personal data protection) was not researched here. It is likely relevant to permissions such as contacts access.

---

## 3. Evidence that dark patterns work and cause harm (Luguri & Strahilevitz; low-income and credit harms)

### Takeaway
Dark patterns are highly effective: mild ones roughly double uptake and aggressive ones nearly quadruple it. They work best on less-educated users, and price barely moderates them. Mild patterns provoke almost no backlash, so they are the most insidious. In digital credit for low-income users, the documented harms are mass blacklisting, borrowing to repay other loans, and debt-shaming.

### Cited Findings
- **Luguri & Strahilevitz, "Shining a Light on Dark Patterns", Journal of Legal Analysis 13(1):43, 2021.** All figures below are from this source. [verified] — [OUP](https://academic.oup.com/jla/article/13/1/43/6180579)
  - **Study 1** (N = 1,963), acceptance of a dubious data-protection subscription:
    - control **11.3%**;
    - mild dark patterns **25.8%** (2.28 times control);
    - aggressive dark patterns **41.9%** (3.71 times control).
  - If dropouts are counted as refusals, the figures become mild 25.4% and aggressive 37.2%.
  - **Price did not matter:** moving from $2.99 to $8.99 per month had no significant effect (χ²(1, N=1,762)=0.76, p=0.38). The authors write: "Tripling the cost of a service had no effect on uptake".
  - **Backlash appears only for aggressive patterns:**
    - mood worsened only in the aggressive condition (mean 3.94 vs 2.96 for control);
    - 65 participants dropped out in the aggressive condition vs 9 in the mild one;
    - perceived freedom to refuse was 6.21 in control, 5.81 in mild and 4.74 in aggressive.
  - Mild dark patterns therefore increase uptake with little detectable backlash.
  - **Less-educated participants were more susceptible** in the mild condition (b=−.19, p=.002) and the aggressive condition (b=−.17, p=.003). With income controlled, the aggressive-condition effect lost significance (p=.27).
  - **Study 2** (N = 3,777):
    - Hidden information raised acceptance from 14.8% to **30.1%**.
    - The trick question raised it from 19.2% to **33.4%**.
    - Obstruction gave 23.6% vs 16.7%.
    - Preselection gave 20.1% (p=.045).
    - Social proof gave 22.1% and confirmshaming 19.6%, which are modest effects.
    - Scarcity (14.3%) and the "recommended" label (18.1%) had no significant effect.
    - "Must act now" countdowns did not significantly increase uptake.
    - Price ($8.99 vs $38.99) again had no significant effect: 26.7% vs 26.0% at the final choice.
    - Of those who accepted, **73.7%** rated their likelihood of cancelling at 4 or more on a 7-point scale, and **21.1%** said they would "definitely" cancel. This shows the consent obtained was low quality.
    - The authors conclude: "Decision architecture, not price, drove consumer purchasing decisions."
- **Kenya digital credit harms:**
  - MicroSave research: more than **2.7 million** Kenyans were blacklisted at CRBs over defaults on micro/digital loans, and a later figure put it at 3.2 million. [verified, secondary] — [Business Today](https://businesstoday.co.ke/more-than-2-7-million-kenyans-blacklisted-at-crb-over-digital-loans/)
  - Izaguirre, Kaffenberger & Mazer, "Digital Credit: Borrower experiences and emerging risks", surveyed 3,150 people, of whom 1,037 were digital-credit users. **12%** of users had defaulted. [verified, secondary] — [Nation](https://www.nation.co.ke/business/996-4805260-1splhcz/index.html). The figure of "16.6% borrowing one loan to repay another" appears in the same coverage but could not be traced to its primary source.
  - The CBK responded by barring sharing of defaults below KSh 1,000 with CRBs. [verified, secondary] — [Business & Human Rights](https://business-humanrights.org/en/kenya-govt-bars-unregulated-predatory-digital-lenders-from-blacklisting-poor-defaulters-a-practice-which-has-previously-left-the-poor-in-a-debt-trap); [Cytonn](https://cytonnreport.com/news/over-300-digital-lenders-barred-from-forwarding-defaulters-to-crb)
  - Debt-shaming continued after the 2022 regulations. [verified, headline] — [Business Daily](https://www.businessdailyafrica.com/bd/economy/debt-shaming-back-as-digital-lenders-defy-cbk-5094888)
- The OECD 2022 report stresses heightened harm for consumers who are vulnerable because of income, time pressure or low literacy. [background, not re-verified] — [OECD](https://www.oecd.org/en/publications/dark-commercial-patterns_44f5e846-en.html)

### Inferences
- The finding that mild patterns cost nothing in backlash and that price does not matter is exactly why MoloPay cannot rely on "users will notice". The users most affected (lower education and income) are MoloPay's core segment.
- In credit, low-quality consent (73.7% expecting to cancel) becomes debt that cannot be cancelled. The harm is therefore larger than in a subscription.
- Kenya shows the trajectory. Frictionless instant credit combined with aggressive collection led to mass blacklisting, then a regulatory crackdown and reputational collapse. A fintech that pre-commits against this has a trust advantage.

### Gaps
- No empirical study of dark patterns specific to Cameroon or CEMAC was found.
- The primary MicroSave and FSD Kenya reports were not read, and the CGAP attribution of Izaguirre et al. was not confirmed.

---

## 4. Ethical nudge frameworks and how to test nudges ethically

### Takeaway
A nudge is ethical when it is transparent, easy to refuse, aligned with the user's own stated goals (welfare-improving "as judged by themselves"), and would survive publicity. Sludge should be removed on the user's path to good outcomes, and friction added only on risky paths such as taking credit or breaking a savings goal early. EAST and BASIC give the design and test process. A/B tests on financial decisions need prior ethical review, guardrail metrics measured on harm, and no arms that deploy dark patterns.

### Cited Findings
- **Thaler's "nudge for good" criteria** (Thaler, "The Power of Nudges, for Good and Bad", NYT, 31 Oct 2015; also in Thaler & Sunstein, *Nudge*, 2008/2021) are: (1) all nudging should be **transparent and never misleading**; (2) it should be **as easy as possible to opt out**, preferably with one mouse click; and (3) there should be good reason to believe the behaviour being encouraged will **improve the welfare of those being nudged**. Thaler also endorses the "publicity principle" (Rawls), under which you should not nudge in a way you could not defend publicly. [background, not re-verified] — [NYT](https://www.nytimes.com/2015/11/01/upshot/the-power-of-nudges-for-good-and-bad.html)
- **Sunstein on sludge:**
  - *Sludge: What Stops Us from Getting Things Done and What to Do About It* (MIT Press, 2021).
  - "Sludge Audits", *Behavioural Public Policy* 6(4), 2022: institutions should run periodic sludge audits and remove frictions that do not serve a legitimate purpose.

  [background, not re-verified] — [Cambridge Core](https://www.cambridge.org/core/journals/behavioural-public-policy/article/sludge-audits/12A5E8A4C5D9F0D1E1C2D8B0A1B1F2A3) (URL may need correction)
- **BIT EAST framework** (Behavioural Insights Team, 2014): make the desired behaviour **Easy, Attractive, Social, Timely**. [background, not re-verified] — [BIT](https://www.bi.team/publications/east-four-simple-ways-to-apply-behavioural-insights/)
- **OECD BASIC toolkit** (2019): Behaviour, Analysis, Strategies, Intervention, Change. It includes ethics guidance on interventions and on the duty to evaluate them. [background, not re-verified] — [OECD BASIC](https://www.oecd.org/en/publications/tools-and-ethics-for-applied-behavioural-insights-the-basic-toolkit_9ea76a8f-en.html)
- **Sludge audit practice under the UK Consumer Duty:** map the customer journey first. Then look for choice architecture that leads to poor outcomes, not merely architecture that departs from neutral. [verified, practitioner] — [IFA Magazine](https://ifamagazine.com/five-ways-to-conduct-a-good-sludge-audit-and-why-consumer-duty-makes-it-vital/); [CCTA](https://www.ccta.co.uk/attack-of-the-sludgeexplaining-and-avoiding-sludge-practicesalph-lc/)
- The FCA tested consumer-credit journey designs by online experiment before drawing conclusions. This is a regulator-endorsed model of ethical pre-testing. [verified] — [FCA research note](https://www.fca.org.uk/publications/research-notes/digital-design-financial-products-services)
- **Evidence for welfare-improving savings nudges:**
  - Default enrolment and "Save More Tomorrow" (Thaler & Benartzi 2004, JPE): participation and savings rates rose sharply.
  - Commitment savings with a goal lock (Ashraf, Karlan & Yin 2006, QJE, Philippines SEED): savings balances at 12 months were 81 percentage points higher for the treatment group.

  [background, not re-verified; figures from memory and need checking] — [Ashraf Karlan Yin QJE](https://academic.oup.com/qje/article/121/2/635/1884028)

### Inferences
**MoloPay "will never" list.** These are the design rules, derived from sections 1–3.

| # | Never | Grounding |
|---|---|---|
| 1 | Show a cost, fee or TEG after the commitment step. The total cost ("montant total à payer"), fees and the lender's TEG go on the same screen as the confirm button, in French and English | Loi 2011/012 Arts. 6, 9, 13; Règlement 04/19; FCCPC Reg. 17(a) |
| 2 | Pre-tick credit, insurance or paid add-ons. Credit in model B is strictly opt-in and actively requested, and is never a default or an automatic top-up | FCCPC Reg. 19(h); Art. 12 of the Cameroon law |
| 3 | Show fake urgency or scarcity. Countdowns and stock or social-proof counters only from real, auditable data | FTC 2022; UCPD Annex I item 7; DFA |
| 4 | Use confirmshaming or guilt wording on the decline button. The "No" option uses the same visual weight as "Yes" | deceptive.design; DSA Art. 25(3)(a) |
| 5 | Make stopping a savings plan, withdrawing savings, or closing an account harder than starting. Exit takes the same number of taps, has a visible button and has no hidden penalty | DSA Art. 25(3)(c); DFA; Consumer Duty |
| 6 | Nag, i.e. repeatedly re-ask a refused credit offer. Respect a cool-down after a "no" | FCCPC Reg. 19(e); DSA Art. 25(3)(b) |
| 7 | Request contacts, call logs or gallery access, contact third parties, or use public shaming in collection (applies to MoloPay and must be contractually imposed on the model B lender) | Kenya DCP 2022; FCCPC Form 001 item 15 |
| 8 | Use trick wording or double negatives in consent screens | Luguri & Strahilevitz: the trick question took uptake from 19.2% to 33.4% |
| 9 | Personalise prices or credit offers to exploit urgency signals from vulnerable users, e.g. a balance near zero at month-end | DFA Art. 13; OECD |
| 10 | Run streaks or loss-framed gamification that the user cannot switch off | DFA Arts. 14–17 |

**Ethical nudges MoloPay can use**, each passing the three Thaler tests:
- Goal-based savings with a voluntary lock that the user chooses.
- Reminders timed around income events, such as mobile money inflows.
- Honest progress bars ("you are 60% of the way to your phone").
- Defaults that favour saving over credit, e.g. "save the remaining amount" shown first, with credit as a clearly labelled secondary option.
- **Positive friction before credit:** a summary of the total cost, a "do you want to wait N weeks and pay 0 FCFA in interest instead?" comparison, and a 14-day cooling-off period that mirrors Art. 7.
- Plain-language and bilingual microcopy, plus audio or visual options for low literacy.

**Ethical testing protocol:**
- Pre-register each A/B test with an internal ethics reviewer.
- Never test a variant that would be on the "never" list.
- Always measure guardrail metrics, not only conversion:
  - comprehension, using a quiz on the cost;
  - complaints;
  - early cancellations or withdrawals;
  - default rates at 30, 60 and 90 days;
  - regret.
- Stop variants that lift conversion but worsen guardrails.
- Publish the nudge policy, applying the publicity principle.
- Run a sludge audit of exit, complaint and withdrawal journeys every quarter.

### Gaps
- The exact Cambridge URL for Sunstein's "Sludge audits" paper and the exact Ashraf/Karlan/Yin effect size were not verified this session.
- No guidance from ideas42 specific to financial nudge ethics was retrieved.
- No CEMAC or Cameroonian regulator guidance on behavioural design or A/B testing exists that I could find.
