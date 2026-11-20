# The Cameroonian diaspora as MoloPay payers: size, remittance behavior, pain points, trust, and UX expectations

Research date: 20 Nov 2026. Scope 2015–2026. Company or vendor claims are labeled **[company claim]**. Most figures were checked against the primary source. Figures that come only through an aggregator are labeled **[secondary]**.

---

## 1. How big is the Cameroonian diaspora, and where does it live?

### Takeaway
The UN DESA emigrant stock (people born in Cameroon and living abroad) is about 441,000 for 2020, about 1.7% of the population. The biggest destinations are France (~93k in 2020, ~128k in 2024), the USA (~70k), Nigeria (~52k), Gabon (~51k) and Chad (~36k). Cameroonian institutions use far larger "broad diaspora" figures, up to 6 million including descendants. Sizing should use the UN DESA number for first-generation payers.

### Cited Findings
- UN DESA 2020: total Cameroonian emigrant stock of **441,015** (219,379 men, 221,636 women), 1.68% of the population. Top destinations: **France 92,983; USA 70,087; Nigeria 52,489; Gabon 50,906; Chad 35,635** — [countryeconomy.com, UN DESA data](https://countryeconomy.com/demography/migration/emigration/cameroon) **[secondary]**. The same 441,015 total appears in the [UN DESA International Migration 2020 Highlights](https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/undesa_pd_2020_international_migration_highlights.pdf). Note that the aggregator's table heading has an ambiguous year label (2015 vs 2020).
- UN DESA 2024: **127,995** people born in Cameroon living in France — [Diaspora for Development (EU) Cameroon fact sheet, citing UN DESA 2024](https://diasporafordevelopment.eu/wp-content/uploads/2024/05/CF_Cameroon-v.3.pdf) (the PDF link returned 404 when fetched; the figure comes from the search snippet); the same number appears on [Compatri](https://compatri.com/en/blog/etudiants-camerounais-en-france-communaute). The same fact sheet's table gives about 53,000 for the USA, with no clear year.
- **Conflicting figure:** SIHMA puts the emigrant stock at 1.8 million in 2020 and 2.1 million in 2024, "citing UN DESA (2025)". This does not match the UN's 441k and probably uses a different definition — [SIHMA](https://sihma.org.za/african-migration-statistics/country/cameroon). Treat it with caution.
- Cameroon's Ministry of External Relations (2024 data, cited by the Caisse des Dépôts et Consignations, CDEC) counts about **500,000 Cameroonian passport holders abroad**. A "broad" estimate of **up to 6 million** (descendants, dual nationals, people of Cameroonian origin, about 20% of the population) is described by CDEC itself as "still needing clarification" — [Business in Cameroon, 7 Jul 2026](https://www.businessincameroon.com/public-management/0707-16426-cameroon-wants-to-turn-diaspora-remittances-into-long-term-investment).
- Older or other national figures, from Wikipedia citing OECD 2012 and GIZ 2016: Germany ~25,000 (GIZ study, 2016); Canada 55,095 (IRCC permanent residents, year not stated); Italy 15,013; UK 2,900 (OECD 2012, probably undercounted) — [Wikipedia "Cameroonian diaspora"](https://en.wikipedia.org/wiki/Cameroonian_diaspora). These are not comparable with each other.
- UN 2013: 251,527 emigrants, of whom France 78,561 and USA 48,952 (search snippet, [sociostudies.org](https://www.sociostudies.org/journal/articles/165546/)). This shows strong growth between 2013 and 2024.

### Inferences
- Priority markets for a MoloPay MVP: **France (EUR)**, then **USA (USD)**, then **Germany/Belgium (EUR)**, **Canada (CAD)** and **UK (GBP)**. Together France and the USA hold about 37% of the 2020 UN stock.
- A substantial regional diaspora lives in Nigeria (NGN), Gabon and Chad (XAF, CEMAC zone). Gabon and Chad are in the same currency zone, so this is an intra-CEMAC flow with no exchange-rate conversion. It is a different product and regulatory case (cash, mobile money).
- The diaspora is split by language: France and Belgium are largely Francophone, while the UK, USA, Nigeria and Canada include many Anglophones (North-West and South-West regions). The interface should be **bilingual FR/EN from launch**.

### Gaps
- I did not get the full UN DESA 2024 table by destination (Belgium, Germany, Canada, UK, Gabon, Nigeria). It can be retrieved directly from the UN DESA "International Migrant Stock 2024" dataset.
- No reliable recent figure for Belgium.

---

## 2. Remittances to Cameroon: volumes, costs, channels, CEMAC regulation

### Takeaway
Officially recorded remittances to Cameroon are modest: about US$0.7–0.8 billion according to World Bank data (≈1.3–1.6% of GDP), or 652 billion FCFA in 2024 according to CDEC. The two series diverge. Sending money from France costs roughly 2.7–4.9% at digital providers, against a Sub-Saharan Africa average of 8.46%. Mobile money (MTN MoMo, Orange Money) has become the **main receiving channel** in CEMAC. Since 2019, and again in May 2026, the BEAC has tightened oversight of inbound transfers (foreign-currency repatriation, documentation).

### Cited Findings
**Volumes**
- Personal remittances received by Cameroon: **≈1.295% of GDP in 2024** — [World Bank, BX.TRF.PWKR.DT.GD.ZS](https://data.worldbank.org/indicator/BX.TRF.PWKR.DT.GD.ZS?end=&locations=CM).
- **US$690.15 million in 2024**, down from **US$786.56 million in 2023**. As a share of GDP: 1.29% (2024) vs 1.61% (2023), the series high. The 1979–2024 average is 0.48% of GDP — [TheGlobalEconomy, World Bank data](https://www.theglobaleconomy.com/Cameroon/remittances/) **[secondary]**.
- **Conflicting figure:** CDEC, citing the mid-term review of the SND30 national development strategy, reports **652 billion FCFA in 2024 (+8% vs 2023)**, coming "mainly from France, the United States and other CEMAC countries". The article converts this to "about $1.2bn". At ~600 FCFA per USD it would be closer to ~US$1.05–1.1bn — [Business in Cameroon, 2026](https://www.businessincameroon.com/public-management/0707-16426-cameroon-wants-to-turn-diaspora-remittances-into-long-term-investment). The World Bank and the national source therefore disagree on the 2023→2024 trend (decline vs +8%).
- CEMAC as a whole: inbound diaspora transfers **+77% in 2024, to 1,354 billion FCFA (≈US$2.4bn)**. Mobile money is now the **main receiving channel**, ahead of banks and money-transfer operators (MTOs) — [EcoMatin, 8 Jun 2026](https://ecomatin.net/la-beac-ferme-une-breche-dans-les-transferts-de-la-diaspora-vers-la-cemac).

**Costs**
- Sending $200 to Sub-Saharan Africa costs **8.46% on average in Q3 2025** (8.78% in Q1 2025). The global average is **6.36%**. The SDG 10.c target is <3% — [African Exponent, citing World Bank RPW](https://www.africanexponent.com/chart-of-the-day-sending-200-home-to-sub-saharan-africa-costs-8-46-percent/) **[secondary]**.
- Globally, a mobile-wallet payout costs **3.92%** on average, against 7.86% for a bank-account payout. Cash-out fees at the recipient end may come on top — [ArcaWallet, citing RPW](https://arcawallet.app/research/true-cost-of-sending-200-by-country/) **[secondary]**.
- France→Cameroon corridor (World Bank RPW, €200 sends, 2024): WorldRemit bank transfer May 2024 ≈**2.97%** (€1.99 fee + 1.55% FX margin); WorldRemit Feb 2024 ≈**4.90%** (€4.39 fee); Small World cash pickup May 2024 ≈**2.72%**; Western Union paid by credit card Nov 2024 ≈**3.96%** (€3.99 fee) — [RPW WorldRemit FR-CM](https://remittanceprices.worldbank.org/service/worldremit-france-cameroon-76), [RPW Small World](https://remittanceprices.worldbank.org/service/small-world-france-cameroon-53), [RPW Western Union](https://remittanceprices.worldbank.org/service/western-union-france-cameroon-70) (from search snippets; the [corridor page](https://remittanceprices.worldbank.org/corridor/France/Cameroon) returned 403, so I could not get the corridor average).

**Channels**
- Taptap Send in Cameroon pays out to **MTN Mobile Money and Orange Money**, "usually in under 5 minutes". Per-transfer caps: **500,000 XAF (MTN)** and **1,000,000 XAF (Orange)**. Bank-account payout is listed as "temporarily unavailable" — [Taptap Send help center](https://help.taptapsend.com/en/receiving-countries/how-can-i-send-money-to-cameroon) **[company claim]**. Taptap Send has been active towards Cameroon since at least 2020 — [Financial Afrik, Sep 2020](https://www.financialafrik.com/2020/09/20/cameroun-taptap-send-une-application-tournee-vers-les-diasporas/).
- WorldRemit has paid out to MTN Mobile Money in Cameroon since 2016, and now also to Orange — [WorldRemit](https://www.worldremit.com/en/news/worldremit-introduces-overseas-transfers-to-mtn-mobile-money-in-cameroon) **[company claim]**.
- The BEAC's May 2026 instruction names **Orange Money, MTN MoMo, Western Union, MoneyGram, Ria and WorldRemit** as actors in the inbound channel — [EcoMatin](https://ecomatin.net/la-beac-ferme-une-breche-dans-les-transferts-de-la-diaspora-vers-la-cemac).

**CEMAC foreign-exchange regulation**
- Legal basis: **Regulation No. 02/18/CEMAC/UMAC/CM of 21 Dec 2018** on foreign-exchange regulation. Current transfers are free, subject to proof of the origin of funds — [Regulation text (sgg.cg)](https://sgg.cg/txts-droit-reg/CEMAC-UMAC-Reglement-2018-02-reglementation-des-changes.pdf); [French Treasury, Dec 2019](https://www.tresor.economie.gouv.fr/Articles/2019/12/13/transferts-internationaux-vers-un-retour-a-la-normale).
- June 2019: a BEAC instruction (002/GR/2019 per one source) **capped transfer fees**. Sources disagree on the levels: 1% vs 0.25% on inbound transfers, plus 0.50% where the money comes from workers' income. The BEAC governor said processing times fell from 20 days to 24 hours — [Investir au Cameroun](https://www.investiraucameroun.com/finance/0507-12925-pour-juguler-la-crise-des-devises-la-beac-desserre-l-etau-autour-des-transferts-internationaux); [Droit Médias Finance](https://droitmediasfinance.com/index.php/actualites/droit-bancaire/267-transferts-dargent-cemac-la-beac-met-fin-aux-tarifs-excessifs). **To be checked in the original text.**
- **5 May 2026: BEAC instruction** (signed by Governor Yvon Sana Bangui). Pre-funding of inbound transfers must be backed by **proof that the matching foreign currency has actually been repatriated**. Otherwise the bank must reject it and return the funds to the originator. Each transaction needs a file (order, SWIFT messages, local payment proofs). Payment institutions must provide proof of payout to beneficiaries **within 8 working days**. The BEAC receives monthly reporting. The article states this "should not block" diaspora receipts, but some payouts "could take longer or face tighter checks" — [EcoMatin, 8 Jun 2026](https://ecomatin.net/la-beac-ferme-une-breche-dans-les-transferts-de-la-diaspora-vers-la-cemac). I have not confirmed that it is in effect yet.
- The BEAC has also digitized the processing of foreign-currency transfer requests out of CEMAC — [Agence Ecofin](https://www.agenceecofin.com/banque/0211-81955-la-beac-a-lance-la-dematerialisation-du-processus-d-analyse-des-demandes-de-transfert-de-devises-hors-cemac).

### Inferences
- The price benchmark the diaspora carries in its head is now "mobile money in under 5 minutes, ~3% or less" (Taptap Send, WorldRemit). If MoloPay adds a "project" layer on top of a licensed partner, **total cost must be shown upfront and compared with a plain transfer**. Users have a clear reference point.
- The May 2026 BEAC instruction pushes towards **traceable flows with a documented file per transaction**. MoloPay's model (licensed channel, AML, receipt, proof of handover) is compliance-native. This can serve as a selling point ("compliant, traceable transfer"). The instruction may also lengthen some payout times, so the UX should say "funds received / being credited" honestly, without promising "instant".
- Mobile-wallet caps (500k / 1M XAF per transfer) matter for large projects (a motorbike at ~600k–1M XAF, building materials). The product may need to **split payments or use a bank payout** for large amounts.

### Gaps
- No exact RPW average for the France→Cameroon, USA→Cameroon or UK→Cameroon corridors (page blocked, 403).
- No reliable estimate of the **informal share** for Cameroon (bus or "colis" transfers, friends travelling, hawala-like brokers, "Western Union amis"). No source found.
- No public data on the market share of each operator (Lemfi, Sendwave, Remitly) on Cameroon.
- The exact text of the 2019 fee-cap instruction is unconfirmed (sources conflict).

---

## 3. What remittances are spent on, and the evidence on "directed" or "controlled" remittances

### Takeaway
In Cameroon, remittances go mainly to everyday consumption, then health, education and housing. No recent national breakdown with percentages was found. The experimental literature is clear on one point: **migrants send more, or save more, when they can label or control how the money is used**. Labeling alone (a soft commitment) captures most of the effect, at +15%. Paying the institution directly (a hard commitment) adds only +2.2%. In El Salvador, more control meant more account openings and doubled savings. Matching funds strongly increase education spending.

### Cited Findings
**Cameroon**
- "Most transfers" cover everyday household spending: food, health, education, housing, family support. Only part of it could realistically be redirected to investment — [Business in Cameroon, Jul 2026](https://www.businessincameroon.com/public-management/0707-16426-cameroon-wants-to-turn-diaspora-remittances-into-long-term-investment).
- Micro evidence (Cameroon household survey, 2012 data): remittances reduce poverty by raising consumption and have a positive effect on human capital through more health and education spending. Another study finds that wealthier recipient households *reduce* their health spending — [UAPS 2015, "Migration, Remittances, Poverty and Human Capital in Cameroon"](https://uaps2015.popconf.org/papers/150249); [ResearchGate, "Distributional effect of international remittances on household expenditure: Evidence from Cameroon"](https://www.researchgate.net/publication/362920776_Distributional_effect_of_international_remittances_on_household_expenditure_Evidence_from_Cameroon) (search snippets).
- CDEC is studying **DIASDEV**, a regulated savings product for the diaspora (short-term savings account, term deposit, savings-investment product), sold through banks and microfinance institutions. It is still at feasibility-study stage (AFD and Expertise France, working group created 19 Jan 2026) — [Business in Cameroon](https://www.businessincameroon.com/public-management/0707-16426-cameroon-wants-to-turn-diaspora-remittances-into-long-term-investment).

**Experiments on control and direction**
- **De Arcangelis, Joxhe, McKenzie, Tiongson & Yang (JEBO 2015, vol. 111, pp. 197–208; NBER WP 20839)**, 501 Filipino migrants in Rome (73% women, median wage €900/month, median remittances **€380/month**, 72% remit monthly):
  - Labeling the transfer "for education" raises the total amount sent by **+15%**. Paying the school directly adds only **+2.2%**.
  - Take-up of the real **EduPay** product (direct payment to schools) is driven mainly by **the ability to label**, not by the direct-payment feature.
  - Varying what the household knows about the migrant's choice does not change the effect significantly.
  - **55%** of migrants would like more influence over the household's overall budget, and **37%** over how remittances are spent, even though most say they are "very well informed".
  - Source: [NBER w20839 (PDF, abstract and pp. 2–8)](https://www.nber.org/system/files/working_papers/w20839/w20839.pdf); [RePEc](https://ideas.repec.org/a/eee/jeborg/v111y2015icp197-208.html).
- **Ashraf, Aycinena, Martínez & Yang (REStat 2015, 97(2): 332–351)**, RCT with **898 Salvadoran migrants** (Washington DC) and Banco Agrícola:
  - Three accounts were offered: in the recipient's name (no control), joint (monitoring), or migrant-only (full control). Account opening rose by **+16.4 pp / +21.4 pp / +34 pp** respectively vs the control group.
  - Joint or exclusive control **roughly doubles** the transnational household's total savings, from a base of ~US$430.
  - No effect on the amount of remittances.
  - Migrants say they prefer to save ~21% of income, against <3% for recipient households.
  - Source: [J-PAL evaluation summary](https://www.povertyactionlab.org/print/pdf/node/1551?lang=en); [NBER w20024](https://www.nber.org/papers/w20024).
- **Ambler, Aycinena & Yang (El Salvador, education remittances with matching funds):**
  - **No demand** for unmatched education remittances, but **positive demand when matched**.
  - Each $1 received raised education spending by **$3.72** (crowd-in effect), along with more private-school attendance and less youth labor.
  - Source: [NBER Reporter 2025 No. 1, Dean Yang](https://www.nber.org/reporter/2025number1/international-migration-remittances-and-economic-development).
- **Batista & Narciso (World Bank Economic Review 2018, 32: 203–219)**, RCT with 1,500 migrants in Ireland. Free calls to their contacts abroad raise remittances significantly. The authors attribute this to **better information**, "better migrant control over remittance use" and more trust in the channels — [EconPapers](https://econpapers.repec.org/RePEc:oup:wbecrv:v:32:y:2018:i:1:p:203-219.); [NOVA SBE](https://www.novasbe.unl.pt/pt/docentes-e-investigacao/destaques/research-news-detail/id/195/keeping-in-touch-development-and-macroeconomics).
- **Joseph, Nyarko & Wang (AEJ: Applied 2018, 10(2): 58–100)**, administrative data on Gulf migrants. Remittances react asymmetrically to income shocks, which is consistent with migrants **hiding good news from their family** (information asymmetry runs both ways) — [NBER w20986](https://www.nber.org/system/files/working_papers/w20986/w20986.pdf).
- Batista, Silverman & Yang (Mozambique, 2015): in a lab-in-the-field experiment, people prefer to send **in kind** rather than cash, cited in [Batista & Narciso](https://www.tcd.ie/Economics/staff/narcisog/docs/Batista%20Narciso-%2025August2016.pdf) (search snippet).

### Inferences
- **Key design point for MoloPay:** the evidence suggests that **naming or labeling the project** ("Moto de Paul", "Loyer Mme Ngo") delivers most of the value: +15% sent, take-up of the real product. Strict hard control (direct payment to the supplier) adds little on its own. "Project + photo proof" UX may be enough for a large share of users. Direct payment to the supplier or school can be a premium option for users who want strong guarantees.
- Willingness to pay for control: no study found gives a monetary WTP. The indirect evidence is take-up (+34 pp with full control) and a strong response to matching (education). This supports **co-funding** mechanics (several relatives contributing to the same goal, or a "bonus" or match funded by partners).
- Control should be framed as **transparency and shared progress**, not suspicion. The literature shows the information asymmetry runs both ways, and the relative has to accept the contribution (MoloPay's flow). Messaging like "suivez le projet ensemble" fits this better than "contrôlez l'usage".

### Gaps
- No recent Cameroon survey quantifying the % of remittances going to consumption, education, health or construction (the ERI-ESI or ECAM household surveys might have this but were not found).
- No monetary WTP for control. No experiment specific to Cameroon or Central Africa.
- I did not access Ambler, Aycinena & Yang's original text (exact match rates).

---

## 4. Pain points: "black tax", misused funds, construction scams, trust

### Takeaway
The family pressure to send money ("black tax") and the fear of misused funds are well documented in African diasporas. Building a house from abroad is the iconic risk in Cameroon: Cameroonian media report recurring stories of fictitious construction sites, fake photos, and money diverted by a relative or a "cousin site manager". No reliable statistic on how common this is exists. The figures circulating come from vendors.

### Cited Findings
- Cameroonian case (2026): an expatriate sent money for **8 years** to have a house built. His wife showed him sites "progressing well", but the land held **no house**. The article highlights document fraud: **fake title deeds, fake photos** — [allAfrica / camer.be, May 2026](https://fr.allafrica.com/stories/202605200684.html); [camer.be](https://www.camer.be/93384/34:31/afrique-il-a-envoye-des-millions-a-sa-femme-a-dubai-pendant-8-ans-elle-a-tout-vole-avec-un-faux-enfant-africa.html). This is a single media case, not a statistic.
- LeFisk, a Cameroonian tax and legal advisory firm, says diverted funds are "the first cause of failure of a diaspora project" ("7 projets sur 10"). The typical example: "sending money to the cousin who manages the site with no pro forma invoice". It advises pro forma invoices, a contract, checking the land title, and filing a complaint or reporting to ANIF — [LeFisk](https://lefisk.cm/diaspora) **[company claim, figure not verified]**.
- SICC property scam: about **180 buyers**, **≈3 billion FCFA**, and no construction after 14 years — [camer.be](https://www.camer.be/87241/11:1/cameroun-escroquerie-immobiliere-sicc-un-scandale-qui-dure-depuis-14-ans-cameroon.html).
- The "feymania" (Cameroonian scam culture) is documented academically — [Sciences Po CERI, "Anatomie d'une arnaque : feymen et feymania au Cameroun"](https://www.sciencespo.fr/ceri/sites/sciencespo.fr.ceri/files/etude77.pdf) (study predates 2015, context only).
- "Black tax" (South Africa, *Development Southern Africa* 2019): substantial, usually monthly transfers, going mainly to general expenses and education. Senders are dissatisfied with their own savings — [RePEc](https://ideas.repec.org/a/taf/deveza/v36y2019i4p443-460.html).
- Nigerians in the UK (OhentPay survey, 2025, n=655): **28%** say family support limits their ability to save or invest, and **15%** have postponed major life events. This was commissioned by a remittance company — reported via [search on BusinessDay/Guardian](https://clone.businessday.ng/?p=1047773) **[company claim]**.
- In the Philippines–Italy experiment, **37%** of migrants want more influence over how remittances are spent — [NBER w20839](https://www.nber.org/system/files/working_papers/w20839/w20839.pdf).
- BuilderOS (Nigeria) advertises a "60% fraud rate" in diaspora projects. This is an unsourced marketing figure — [BuilderOS](https://builderos.live/) **[company claim, not reliable]**.

### Inferences
- The pain points MoloPay answers: (1) "I don't know where the money went" → **receipt + proof of handover**; (2) "the relative asks again and again" → a **clear goal with a progress bar**, which turns open-ended requests into a finite project; (3) fake photos → proof should be **time-stamped and geolocated**, or ideally confirmed by the **supplier or school**, not just a photo from the beneficiary.
- Diaspora messaging should **avoid accusing the family** (cultural sensitivity, dignity of the recipient). Better framings: "Offrez un projet, pas juste de l'argent", "Chaque franc a une destination", "Preuve de remise partagée avec toute la famille".
- Construction is the highest-risk and highest-value use case. MoloPay "materials" goals (cement, iron bars) should rely on **identified suppliers** and receipts, not just a cash withdrawal.

### Gaps
- No quantified survey of the Cameroonian diaspora on black tax or misuse of funds. Only individual cases and vendor claims.
- No public police or ANIF data on construction scams that target the diaspora.

---

## 5. Existing "diaspora → project" products in Africa: results and lessons

### Takeaway
Build-from-abroad services are booming (Nigeria, Kenya, Cameroon). They share a few mechanisms: verified contractors, milestone payments, escrow, photo, video or CCTV reports. One of them is founded in Cameroon (DiasporaBuild). Diaspora school-fee payment *towards* Cameroon has no clear consumer product. Flutterwave Tuition covers the reverse direction (Africa → schools abroad), and SchoolPay is domestic. No platform publishes independent impact results.

### Cited Findings
- **DiasporaBuild** (Cameroonian founders): a marketplace linking the diaspora to **verified contractors**, operating in Cameroon and Nigeria, "most projects in Cameroon", describing itself as ConstructionTech/PropTech for remote project management — [Next Capital (Substack)](https://nextcapital.substack.com/p/diasporabuild); [diasporabuild.com](https://diasporabuild.com/llm-info) **[company claim]**.
- **Pencil Home** (Nigeria): live CCTV 24/7, weekly progress reports, real-time budget tracking — [pencilhomes.com](https://pencilhomes.com/) **[company claim]**.
- **Build Africa** (Nigeria): live material prices (cement, iron rods, blocks, roofing sheets), used by the diaspora in London and Toronto to buy materials directly — [BusinessDay NG](https://businessday.ng/real-estate/article/from-price-discovery-to-10000-homes-how-build-africa-lightens-builders-burden/).
- **BuilderOS** (Nigeria, waitlist): photo proof, receipts and GPS attached to each expense — [builderos.live](https://builderos.live/) **[company claim]**.
- Kenya: Fingerprint Builders (weekly video, fixed price), **Diaspora Build Safe** (independent oversight, *does not hold funds*), Nasbridge Properties (**milestones + escrow**), Hodiaspora, Rickfes (remote tracking) — [Fingerprint](https://diaspora.fingerprintbuilders.com/), [Diaspora Build Safe](https://diasporabuildsafe.com/), [Nasbridge](https://nasbridgeproperties.com/about), [Hodiaspora](https://www.hodiaspora.com/), [Rickfes](https://rickfes.co.ke/remote-project-tracking-for-kenyan-diaspora-investors/) **[company claims]**.
- **EduPay** (Philippines, research partner bank): direct payment of remittances to schools, with grades monitoring. Take-up was driven mostly by the *label*, not the direct payment — [NBER w20839](https://www.nber.org/system/files/working_papers/w20839/w20839.pdf).
- **Flutterwave Tuition** (2023): school-fee payment in local currency, credited within 48h. This is mainly *Africa → schools abroad*, with Cameroon among the paying countries (sources disagree on coverage) — [TechEconomy](https://techeconomy.ng/flutterwave-introduces-tuition-to-ease-education-fee-payments-for-africans-abroad); [Fintech Times](https://thefintechtimes.com/flutterwave-tackles-payment-challenges-for-african-students-to-overseas-schools/).
- **SchoolPay** (domestic Cameroon): 4,000+ schools, 2M+ users — [UNDP Nigeria](https://www.undp.org/nigeria/stories/schoolpays-transformational-journey-through-timbuktoo-fintech-accelerator) **[company claim relayed]**. The government's **SchoolMap** platform covers fees at public schools — [ITWeb Africa](https://itweb.africa/content/VgZeyvJlayJMdjX9).
- Institutional route: CDEC's DIASDEV (regulated savings product for the diaspora), at feasibility stage — [Business in Cameroon](https://www.businessincameroon.com/public-management/0707-16426-cameroon-wants-to-turn-diaspora-remittances-into-long-term-investment).

### Inferences
- MoloPay's differentiation: no "build from abroad" service found covers **small everyday projects** (motorbike, rent deposit, school fees) **with several contributors** and **acceptance by the relative**. Existing products are either generic transfers (Taptap, WorldRemit) or heavy construction projects with a contractor.
- Lessons to reuse: (1) **milestones** (pay in tranches tied to proof); (2) a **third-party verified supplier** (SchoolPay or SchoolMap for school fees, a hardware store for materials); (3) **rich, dated proof** (photo, receipt, GPS). Lesson from Diaspora Build Safe: separating "oversight" from "holding funds" builds trust. MoloPay must make clear that the funds go through a **licensed partner**, not through MoloPay itself, depending on the legal setup.
- Possible integration: pay school fees directly to schools already on SchoolPay or SchoolMap (local rails) once the goal is reached.

### Gaps
- No independent evaluation (outcomes, satisfaction, fraud rates) of any build-from-abroad platform.
- No Cameroonian diaspora bond found in this research. Sendwave, Chipper, Kwara and Chaka were not documented for Cameroon (Chipper and Chaka mainly target other markets).

---

## 6. UX expectations of diaspora users

### Takeaway
Senders mainly expect **speed, reliability, security and total cost known upfront**. Digital apps dominate among young people. Public evidence on notifications and tracking is thin, but proof and transparency come up consistently as drivers of trust.

### Cited Findings
- Official survey of Ethiopian and Nigerian senders (Italy, Saudi Arabia, UAE; Mar–Oct 2024): migrants value **reliability, speed and simplicity** as well as cost. When costs drop, some send more or switch away from informal channels — [SARB conference paper, "Remittance behaviours"](https://www.resbank.co.za/content/dam/sarb/what-we-do/payments-and-settlements/cross-border-payments-conference/documents/paper-remittance-behaviours.pdf).
- Visa Money Travels 2024 (Morning Consult, ~44,000 respondents): **security, ease and speed** are the top priorities (UAE). **57%** of remittance users in the UAE prefer apps — [IBS Intelligence](https://ibsintelligence.com/ibsi-news/sending-support-57-of-uae-expatriates-rely-on-apps-for-remittances); [Visa 2025 Digital Remittances Report](https://images.globalclient.visa.com/Web/InovantElqVisaCheckout/%7B5da1349d-50ca-46cc-994c-91d00758bea2%7D_Visa-2025-Digital-Remittances-Report.pdf) **[company claim]**.
- Chubb: **39%** say strong security is the most important factor in trusting a remittance service. Platform choice tracks perceived reliability, speed and fee transparency — [Chubb](https://about.chubb.com/stories/mapping-remittance-risks-protecting-global-money-flows.html) **[company claim]**.
- Multi-market survey (~6,500 people, 10 markets): **41%** received an unexpected final amount. **49%** of 18–24-year-olds had no clear upfront view of the total cost — [CMOtech UK](https://cmotech.uk/story/one-in-three-remittance-users-struggle-with-delays) **[secondary, date not specified]**.
- Market reference point in Cameroon: credited to MTN/Orange "in under 5 minutes" (Taptap Send) — [Taptap Send](https://help.taptapsend.com/en/receiving-countries/how-can-i-send-money-to-cameroon) **[company claim]**.
- Communication affects remittances: free calls → more remittances, attributed to information and control (Batista & Narciso 2018) — [EconPapers](https://econpapers.repec.org/RePEc:oup:wbecrv:v:32:y:2018:i:1:p:203-219.). In the Philippines sample, 52% speak to their household daily and 93% at least weekly — [NBER w20839](https://www.nber.org/system/files/working_papers/w20839/w20839.pdf).

### Inferences (recommendations for MoloPay's diaspora UX)
- **Payment:** card (Visa/Mastercard debit), Apple Pay / Google Pay, SEPA bank transfer / open banking for Europe, ACH for the US. **Show the amount in the sender's currency (EUR/USD/GBP/CAD) and in FCFA**, with the exchange rate and fees *before* confirmation (a "total payé / montant crédité au projet" screen).
- **Speed and status:** a clear timeline: payment received → funds sent via [licensed partner] → contribution accepted by the relative → handover proof. Push and email notifications at each step. Because of the 2026 BEAC instruction, avoid promising "instantané".
- **Time zones:** show notification timestamps in the user's local time *and* Cameroon time (WAT, UTC+1). Payers in North America are 5–9 hours behind.
- **Proof:** a PDF receipt (useful for personal records and some tax regimes), a handover photo **with timestamp and geolocation**, a supplier or school receipt, and a shareable proof page for the family (WhatsApp is the main channel, an inference from usage).
- **Multi-contributor:** several relatives abroad funding the same goal, with a visible progress bar. This builds on the labeling effect (+15%).
- **Tone:** bilingual FR/EN. Frame the product as trust and pride in the project, not surveillance of the relative.

### Gaps
- No Cameroonian-diaspora-specific survey on UX preferences (payment methods, notifications, demand for photo proof).
- No quantified data on Apple Pay or card use among African senders in France or Belgium.
- No public data on demand for tracking or notifications. This is a candidate for primary research (diaspora interviews, a survey in Cameroonian associations in Paris, Brussels, Houston and Montreal).
