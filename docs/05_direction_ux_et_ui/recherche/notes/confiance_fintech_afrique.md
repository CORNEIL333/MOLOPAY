# Trust in fintech and mobile money in sub-Saharan Africa, with Cameroon data (for MoloPay brand and UX)

Research date: 20 Nov 2026. Notes are in English; French source titles are kept as published.
Status labels: **[VERIFIED]** = read directly in the primary source (for example extracted from the World Bank PDF); **[SECONDARY]** = reported by press or an aggregator citing a primary source I could not open; **[ESTIMATE/UNCERTAIN]** = conflicting or unweighted figures.

---

## 1. Latest statistics on Cameroon: accounts, mobile money, savings, smartphones, USSD

### Takeaway
Global Findex 2025 (survey fielded in 2024) shows Cameroon is a mobile-money-first market. 60.9% of adults have an account, but only 21.0% have a bank account, while 55.1% have a mobile money account. Informal saving through savings clubs (tontines/njangi) or a person outside the family (38.3%) is still more common than formal saving in an account (31.2%), and Cameroon's informal rate is well above the SSA average (28.1%). About 42% of adults own a smartphone, but only 22% of the poorest 40% do. That has direct consequences for a smartphone-only app.

### Cited Findings
**Global Findex 2025, Cameroon page (data year 2024, % of adults 15+; columns are Cameroon / SSA / lower-middle-income average) [VERIFIED, extracted from the PDF]** — [World Bank, The Little Data Book on Financial Inclusion 2025](https://thedocs.worldbank.org/en/doc/be6615202d1f08a25855c8ac2d615122-0050012025/related/Little-Data-Book-2025-Web.pdf)
- Adult population 15+: 16.5 million. GNI per capita: US$1,640.
- Any account: **60.9%** in 2024 (SSA 58.2), up from 51.7% in 2021 and 14.8% in 2011.
- Account at a bank or similar financial institution: **21.0%** (SSA 37.8).
- Mobile money account: **55.1%** (SSA 40.0).
- Digitally enabled account: 56.2%.
- Account ownership among women: 52.9%. Poorest 40%: 44.9%. Rural: 49.3%. Out of the labor force: 37.2%.
- Made or received a digital payment: 59.6% in 2024, up from 49.9% in 2021. Made a digital merchant payment: **20.3%** in 2024, up from 8.9% in 2021. Paid a bill online: 16.2%.
- Saved formally or informally: **65.7%**. Saved formally using an account: **31.2%** in 2024, up from 23.5% in 2021. **Saved informally using a savings club or a person outside the family: 38.3%** (SSA 28.1, LMI 14.4).
- Borrowed formally or informally: 69.2%. Borrowed formally: only **10.1%**.
- Financial resilience (not difficult to find extra money within 30 days): 52.4% of all adults, 38.6% of the poorest 40%. Could cover more than 2 months of expenses if income stopped: 36.1%.
- Owns a mobile phone: **77.8%** (women 73.9, poorest 40% 67.1).
- **Owns a smartphone: 41.6%** (women 39.9, **poorest 40%: 21.9%**). SSA average is 32.9.
- **Has a password on their mobile phone: 44.3%.**
- Sampling caveat: some arrondissements in the East, North, Far North, North-West and South-West regions were excluded for insecurity, along with neighbourhoods of fewer than 50 households. Together these exclusions represent **21% of the population**. Douala and Yaoundé are covered.

**Unweighted Findex 2024 microdata** — [World Bank Microdata Library, Cameroon 2024](https://microdata.worldbank.org/catalog/7880/variable/F1/V61?name=fin16)
- Variable-level counts are published, but these are unweighted samples. Do not use them as prevalence figures; use the Little Data Book figures above. [ESTIMATE/UNCERTAIN]

**BEAC: e-money accounts in CEMAC, 2024 [SECONDARY]** — BEAC *Rapport sur les services de paiement dans la CEMAC 2024* as reported by [Africtelegraph/Investir au Cameroun, May 2026](https://africtelegraph.com/?p=79421). Primary report: [BEAC PDF](https://www.beac.int/wp-content/uploads/2026/04/RAPPORT-SUR-LES-SERVICES-DE-PAIEMENT-DANS-LA-CEMAC-2024-.pdf)
- CEMAC: just over **51.2 million** mobile money accounts at 31 Dec 2024 (+28% year on year). **3.7 billion transactions** (+6.42%), worth **FCFA 34,778.5 billion** (+20.33%).
- Cameroon: **30.9 million** accounts at end-2024, up from 24.86 million at end-2023. Reported share of CEMAC accounts: **65.1%** (62.1% in 2023). Cameroon transaction value: **FCFA 26,773 billion**, or 57% of CEMAC value (63.58% in 2023).
- **Inconsistency:** 30.9M ÷ 51.2M ≈ 60.3%, not 65.1%. [Ecomatin](https://ecomatin.net/mobile-money-avec-77-des-parts-de-marche-le-cameroun-domine-les-transactions-dans-la-cemac/) cites a "77%" share without saying what it measures. Check against the BEAC PDF before quoting either.
- A summary of the report says the **activity rate of accounts fell by 17.30% in 2024** even though active users increased. Many accounts are therefore dormant or duplicated (multi-SIM). 30.9M accounts for 16.5M adults shows heavy multi-account holding. [SECONDARY, from search-result summary]

**GSMA [VERIFIED press release]** — [GSMA, State of the Industry Report on Mobile Money 2026](https://www.gsma.com/newsroom/press-release/mobile-money-accounted-for-2-trillion-in-transactions-in-2025-doubling-since-2021-as-active-accounts-continue-to-grow/)
- In 2025, more than **US$2 trillion** passed through mobile money globally, double the 2021 level. Registered accounts reached 2.3 billion (+268M), and 30-day active accounts reached 593M (+15%). Sub-Saharan Africa accounted for most of the new registered and active accounts.
- I did not find a Cameroon-specific figure in the press release.

### Inferences
- In Cameroon the default mental model of "money on the phone" is MTN MoMo or Orange Money, not a bank. MoloPay's funding and payout rails should be MoMo/OM, and the brand should borrow familiarity from them rather than from banking.
- 38% of adults save in tontines/njangi and only 31% save in an account. Goal-based saving is already a cultural habit; the trust gap is with the vehicle, not the behaviour. MoloPay competes with tontines more than with banks.
- Formal credit is very low (10.1%) and digital merchant payments are growing fast (20.3%, up from 8.9%). A "save, then buy from a verified merchant" model sits between the two.
- Only 21.9% of the poorest 40% own a smartphone. A smartphone-only app reaches a mid-income urban segment in Douala and Yaoundé. A USSD or WhatsApp channel, or agent/merchant-assisted onboarding, would broaden reach. Because only 44% of phones have a password, account security, PIN and OTP education matter.

### Gaps
- No FinScope Cameroon survey after 2018–2020 found. FinScope Cameroon 2017 exists in principle but was not retrieved.
- No reliable recent figure on USSD versus app usage split for MoMo/OM in Cameroon.
- I could not read the full BEAC 2024 PDF (active accounts, agents). The activity-rate figure is secondary.
- Senegal and Côte d'Ivoire smartphone and transaction details beyond the Findex lines below were not extracted.

**Comparators: Findex 2025 (2024 data) [VERIFIED, same PDF]**
| Country | Any account | Bank/FI | Mobile money | Saved formally | Saved informally (club/person) | Smartphone |
|---|---|---|---|---|---|---|
| Cameroon | 60.9 | 21.0 | 55.1 | 31.2 | 38.3 | 41.6 |
| Gabon | 68.2 | 24.8 | 61.6 | 39.1 | 32.4 | 59.9 |
| Congo, Rep. | 55.6 | 14.7 | 51.6 | 28.6 | 23.2 | 26.6 |
| Côte d'Ivoire | 57.6 | 16.8 | 53.4 | 35.6 | 26.7 | 45.7 |
| Senegal | 76.5 | 48.0 | 66.9 | 58.3 | 43.5 | 60.8 |
| Ghana | 81.2 | 38.7 | 78.3 | 67.2 | 24.9 | 53.5 |
| Kenya | 90.1 | 45.4 | 87.5 | 54.4 | 33.9 | 54.9 |
| Nigeria | 63.3 | 59.7 | 32.8 | 43.4 | 28.0 | 33.7 |
| SSA average | 58.2 | 37.8 | 40.0 | 34.7 | 28.1 | 32.9 |

---

## 2. Determinants of trust in mobile money and fintech in Africa

### Takeaway
Studies agree that trust and perceived risk sit alongside the standard TAM/UTAUT drivers (usefulness, ease of use, social influence). Trust lowers perceived risk. In practice, trust is earned or lost through reliability (downtime), access to one's own money (agent liquidity), fee transparency, and the existence of working recourse. Perceived value and convenience can keep people using a service even when institutional trust is low.

### Cited Findings
- **Cameroon:** A PLS-SEM study of cybersecurity, trust and continued mobile money use found that usage keeps growing despite high cyber exposure and weaker institutional trust. The authors attribute this to perceived value, convenience and personal risk management. — [Abertay University repository, "The role of cybersecurity and trust on customers' continuous usage…" (listed 2026)](https://rke.abertay.ac.uk/en/publications/the-role-of-cybersecurity-and-trust-on-customers-continuous-usage/)
- **Cameroon (Yaoundé and Douala):** An SEM study of **462 current mobile money adopters** on intention to use mobile payment services. — [EconPapers record](https://econpapers.repec.org/RePEc:cxb:issued:v19:ihs:n29). I did not see the full model or whether it includes trust or risk.
- **Cameroon (Far North):** A review reports that perceived risk negatively affects mobile wallet use. — [conference paper, low-quality source](https://jurnalfebi.iainkediri.ac.id/index.php/proceedings/article/download/247/189) [UNCERTAIN]
- **Ghana:** A UTAUT2 model extended with perceived risk and trust, using **373 mobile money users**, found that both constructs significantly affect behavioural intention. — [SAGE Open study, via Bohrium index](https://bohrium.dp.tech/paper/arxiv/812597336537563137)
- **Tanzania:** UTAUT lacks risk and trust constructs, which consumers see as important, and trust reduces perceived risk in mobile payments. — [Business Management Review, UDSM](https://journals.udsm.ac.tz/index.php/bmr/article/view/459/425)
- **CGAP/MicroSave/BFA multi-country qualitative study** (Bangladesh, Colombia, Philippines, Uganda; about 500 interviews plus focus groups; **2015, outside the requested window but foundational**) — [MicroSave, "A Question of Trust" (Wright, 2015)](https://www.microsave.net/wp-content/uploads/2023/08/Synthesis_Paper_A_Question_of_Trust.pdf):
  - "DFS depend on customers' trust in the systems and agents used to deliver the service even more than traditional financial services."
  - **Service downtime** was the most common issue in all four countries and "erodes trust." Customers then leave cash with agents, which creates opportunities for fraud.
  - **Unauthorised fees** arise when agents don't display price lists. In Uganda, many customers came to believe all agent fees were fraudulent.
  - **Agent illiquidity** means non-users won't sign up "for fear of not being able to access their money when they need it."
  - **Money sent to a wrong number** is a common loss and a widespread fear. It drives people to agent-assisted over-the-counter transactions so they can check with the recipient first.
  - **Recourse:** call centres are hard to reach, sometimes paid, and poorly staffed, so they are used only as a last resort. In Colombia, customers had "no idea how or where to seek redress."
  - **Word of mouth spreads distrust to non-users:** "We keep hearing mobile money users complaining about unstable network, delayed service, missing money… Why then should we register?"
  - Downtime and wrong-number losses "damage the reputation of DFS providers most seriously." In the Philippines, active regulator monitoring coincided with fewer customer-reported problems.
- **Tanzania, CGAP/Busara behavioural study:** Mental accounting, trust and risk, agency, and social influence were the main themes shaping how low-income people save on mobile wallets. — [FinDev Gateway, Behavioural applications in digital finance](https://www.findevgateway.org/library/behavioural-applications-digital-finance)
- **Tontines/njangi as trust infrastructure:** Njangi members have "an intimate knowledge of and trust in one another." Reciprocity sustains the groups, and they offer flexibility and social relations that banks do not. Mobile money can make money circulate more efficiently because a culture of solidarity already exists. — [Nyamnjoh & Fuh, IMTFI blog, 2015](https://blog.imtfi.uci.edu/2015/09/njangi-sociality-new-money-technologies.html)

### Inferences
- For MoloPay, the "hygiene factors" are uptime, instant access to and visibility of one's money, no hidden fees, and a reachable human. Failing any one of these spreads by word of mouth to non-users.
- Social proof and existing social structures matter. Group or family goals, sponsor or referral flows, and "your njangi, digitised" framing can borrow tontine trust. But see section 4: digital tontines have their own failures.
- Regulatory backing likely matters more as a *negative* filter ("is it legal?") than as a positive driver. Since the May 2025 MINFI ban (section 3), being demonstrably licensed or partnered with a licensed bank is a precondition.

### Gaps
- No Cameroon study found that ranks specific trust signals (bank partner, agent, brand) quantitatively.
- I found no rigorous measure of how speed of customer support affects adoption; the evidence is qualitative.

---

## 3. Fraud and scams: prevalence in Cameroon and the region, effects on adoption

### Takeaway
Fraud is rising across the region, and it measurably lowers trust and usage. Cameroon has three distinct threat categories: mobile money social-engineering scams ("wrong transfer," phishing), large Ponzi schemes (Liyeplimal and other crypto or "investment" schemes), and unlicensed digital lenders and fundraising platforms. The Finance Ministry outlawed the last category in May 2025. A new app that holds money will be judged against all three.

### Cited Findings
**Cameroon**
- ANTIC reported that cybercrime cost the Cameroonian economy **FCFA 12.2 billion in 2021**, double the 2019 level. [SECONDARY: cited in a WorldRemit-sponsored article] — [African Media Agency](https://africanmediaagency.com/with-cyber-fraud-on-the-rise-in-cameroon-customer-security-remains-essential/)
- Common schemes described include the fake "wrong transfer" scam, where a caller says they sent money by mistake and begs the victim to send it back. — [WorldRemit / African Media Agency, "Four money transfer scams to beware of in Cameroon in 2023"](https://africanmediaagency.com/four-money-transfer-scams-to-beware-of-in-cameroon-in-2023/); [Cameroon Tribune](https://www.cameroon-tribune.cm/articles/10654/fr/details_2)
- A legal overview reports a sharp increase in cyber-enabled fraud in Cameroon over the past three years. Payment operators must meet ANTIC requirements: incident reporting, penetration testing and data minimisation. — [Global Law Experts, Cameroon fintech and mobile money fraud](https://globallawexperts.com/cameroon-fintech-platforms-navigating-mobile-money-fraud-or-unauthorized-transactions/)
- MTN Cameroon has published account-protection material, including a USSD code to block unauthorised withdrawals (*126*15#, Sept 2025). [SECONDARY, from search summary; not verified on MTN's site]
- **MINFI communiqué, 5 May 2025 (Louis Paul Motaze)** [VERIFIED via legal-news site]: bans payment and banking operations without a licence, covering fund collection, credit, transfers and digital-platform payments. It orders online fundraising and lending platforms to stop immediately and halt advertising. Licensed providers, businesses and administrations must end partnerships with unlicensed players. Promoters had 3 months to apply for payment-institution approval or face closure under Regulation N°04/18/CEMAC/UMAC/COBAC. The stated reasons were "risques réels d'escroquerie, de blanchiment des capitaux et de financement des activités illicites." — [Droit Médias Finance](https://droitmediasfinance.com/index.php/actualites/droit-tech-fintech/1002-cameroun-le-ministre-des-finances-interdit-les-fintechs-et-les-plateformes-de-paiement-exercant-sans-agrement-prealable)
- **Cyberprêts (instant mobile loans)** are described as leading to over-indebtedness and harassment. Around 17 providers are officially registered, and the main danger comes from individuals or entities with no Cameroonian head office. Victims are advised to keep e-contracts and evidence of harassment. — [Digital Business Africa, Jan 2026](https://www.digitalbusiness.africa/cyberpret-lengrenage-fatal-du-credit-mobile-au-cameroun/)
- **Liyeplimal / Global Investment Trading (crypto Ponzi):**
  - COSUMAF (the CEMAC market regulator) warned on 19 Oct 2020 and again later about "campagnes frauduleuses de collecte de fonds." The schemes promised returns of 100% to 500%. — [Digital Business Africa](https://www.digitalbusiness.africa/crypto-monnaies-la-cosumaf-met-a-nouveau-en-garde-les-populations-contre-les-campagnes-frauduleuses-de-collecte-de-fonds-effectuees-par-global-investment-trading-liyeplimal-et-cie/)
  - In October 2020 MINFI banned 17 crypto firms. Press reports said several ignored the ban. — same source; [Cameroon Tribune](https://cameroon-tribune.cm/article.html/59921/fr.html/details_2)
  - Cameroon was more than 13% of Liyeplimal's portfolio, and the scheme collapsed in late 2021. — [BehindMLM](https://behindmlm.com/companies/liyeplimals-ponzi-reboot-collapses-in-less-than-two-months) (watchdog blog) and [Ecomatin](https://ecomatin.net/cryptomonnaie-incursion-au-coeur-de-la-nebuleuse-liyeplimal)
  - Founder Émile Parfait Simb was sentenced to 7 years by Benin's CRIET for online fraud. — [Camer.be](https://www.camer.be/amp/83840/11:1/cameroun-emile-parfait-simb-condamne-a-7-ans-de-prison-ferme-par-la-criet-du-benin-pour-escroquerie-en-ligne-cameroon.html)

**Region and global**
- **CGAP (16 July 2026, E. Duflos):**
  - In Kenya, Rwanda and Uganda, users who lost money to fraud showed **significantly lower trust** in DFS providers (CGAP/IPA national surveys).
  - In Uganda, the median fraud loss was **23% of household monthly income** (IPA 2026).
  - Kenyan victims reported anxiety, anger and shame.
  - In Peru, **11%** of fraud victims stopped using DFS and **25%** reduced use.
  - Close to 70% of 60 jurisdictions reported more fraud in 2024–25 (OECD 2026). 59% of financial authorities in 30 countries named fraud the top consumer risk (World Bank 2025). — [CGAP blog](https://www.cgap.org/blog/fraud-in-digital-finance-crisis-calling-for-ecosystem-solutions)
- **Kenya FinAccess 2024:** **9.8%** of mobile money users lost money from their accounts, down from 47.4% in the 2021 round. The main cause was accidental sending (reported as about 70%, ambiguous whether of losses or users), followed by external fraud (about 19.5%). Among bank users, 56.5% of losses came from internal fraud. — [FSD Kenya infographic](https://www.fsdkenya.org/wp-content/uploads/2024/12/2024-FinAccess-household-survey-infographic.pdf); [CBK main report](https://www.centralbank.go.ke/wp-content/uploads/2024/12/2024-FINACCESS-HOUSEHOLD-SURVEY-MAIN-REPORT.pdf); [Kenyans.co.ke](https://www.kenyans.co.ke/news/107313-knbs-report-outlines-7-ways-kenyans-lost-money-2024) [figures SECONDARY; 70% ambiguous]
- **Kenya, qualitative (AfriCHI 2025, Kotut; interviews with M-PESA users in English and Kiswahili):** [VERIFIED from the paper]
  - Users verify legitimacy through **origin signals**: messages from the official "MPESA" short code versus a personal number. One participant: "it was a message from an individual number, not the official M-PESA number."
  - Users also check **receipt-number serialisation** and whether a balance appears in the confirmation SMS. Fake confirmations come from personal numbers.
  - These stylistic cues fail when fraudsters copy them or when the provider changes message formats.
  - Older users fall for SMS "help me" scams; younger users fall for loan and job scams. Elders defer to family to verify transactions ("I stopped sending the money myself").
  - **Shame** dampens reporting, and users "expect to absorb the losses."
  - Official guidance on scams is vague. — [Kotut, "Terms and Conditions (Do Not) Apply," AfriCHI 2025](https://faculty.washington.edu/kotut/papers/AfriCHI2025-Terms-and-Conditions.pdf)

### Inferences
- In Cameroon, any new app that collects money and promises an outcome (an object at the end of a saving plan) pattern-matches to both Ponzi schemes and illegal platforms. MoloPay must actively dissociate from them:
  - no promised returns
  - a visible licence or partner-bank status
  - an explicit statement such as "we never ask for your PIN/OTP"
  - a single official sender ID or number, communicated consistently
- Consistent official origin signals (one short code or WhatsApp business account, numbered receipts showing the balance) are what users already use as trust heuristics. MoloPay should make them stable and teach them, so that impersonation is easy to spot.
- Fraud victims carry shame and assume they will absorb the loss. A clear, non-judgmental reporting path and a visible refund or dispute policy are strong differentiators.

### Gaps
- No ANTIC cybercrime figures after 2021 were found. No Cameroon survey measures the share of mobile money users who lost money; FinAccess-style data is missing for Cameroon.
- I did not verify the MTN or Orange Cameroon warnings directly on operator sites.
- No data was found on "tontine scams" in Cameroon beyond the Djangui anecdote in section 4.

---

## 4. Failures and lessons: cases of lost trust

### Takeaway
Users in the region have learned to fear several distinct things:
- disappearing money with no one accountable (Ponzi schemes, failed digital tontines)
- harassment and contact-list shaming by digital lenders (Kenya, and cyberprêts in Cameroon)
- unlicensed operators shut down by regulators

Kenya shows that regulation plus public directories cut abuse sharply, but licensing alone did not end it.

### Cited Findings
- **Kenya digital lenders:**
  - The CBK (Digital Credit Providers) Regulations 2022 ban threats, harassment and unauthorised access to contact lists.
  - The crackdown followed a reported suicide linked to debt-shaming.
  - The CBK publishes a directory of licensed digital credit providers.
  - The Data Protection Office and the DFS Association of Kenya report harassment down **about 74–75%** after the 2021 CBK Amendment Act.
  - Shaming persists among some *licensed* lenders, for example Chapeo Capital, licensed in March 2024.
  - The data regulator fined lenders; one firm, Whitepath, was ordered to pay KSh 1.15M to three people.
  - Sources: [Capital FM](https://www.capitalfm.co.ke/business/?p=96644); [Eastleigh Voice](https://eastleighvoice.co.ke/digital%20credit%20providers/41923/harassment-cases-of-borrowers-by-digital-lenders-decline-by-75-data-protection-office); [Business Daily, "Debt-shaming back as digital lenders defy CBK"](https://www.businessdailyafrica.com/bd/economy/debt-shaming-back-as-digital-lenders-defy-cbk-5094888); [Kenyans.co.ke](https://www.kenyans.co.ke/news/125231-cbk-directs-kenyans-report-illegal-mobile-loan-apps-fresh-crackdown); [TechCabal 2023](https://techcabal.com/2023/09/26/digital-lenders-fined-in-kenya/)
- **Cameroon digital tontine (Djangui), AFP, March 2024:**
  - Djangui launched in 2016 and is cited as having about **50,000 users**.
  - The founder built it because he could not tell who had paid in his paper tontine.
  - One user reported losing **over FCFA 1 million (about US$1,700) saved over a year**; the group administrator "was unable to tell me where the money had gone."
  - Source: [The Star / AFP](https://www.thestar.com.my/tech/tech-news/2024/03/12/ancient-community-banking-enters-digital-age-in-cameroon)
- **Liyeplimal Ponzi** (see section 3): people lost savings in a scheme promising returns of 100–500%, despite regulator warnings from 2020.
- **Cameroon regulatory crackdown (May 2025)** on unlicensed fintechs and lending or fundraising platforms (see section 3). Licensed operators were ordered to cut ties with unlicensed partners.
- **Earlier DFS trust erosion (2015 multi-country):** many registered customers become inactive when transacting is impossible (downtime, illiquid agents) or too scary (wrong number, PIN compromise). Only 34.4% of registered accounts were active globally in December 2014. — [MicroSave 2015](https://www.microsave.net/wp-content/uploads/2023/08/Synthesis_Paper_A_Question_of_Trust.pdf)

### Inferences
- Lessons Cameroonian users have likely absorbed, and that MoloPay copy and UX should answer directly:
  - "Where exactly is my money?"
  - "Who is accountable if it disappears?"
  - "Is this legal?"
  - "Can I get it back before the goal?"
  - "Will they access my contacts or shame me?"
- MoloPay is not a lender. Saying so explicitly ("no credit, no interest, no access to your contacts") separates it from the most feared category.
- The Djangui case shows that the administrator is the weak point in digital tontines. Bank-segregated funds and individual (not admin-held) balances are a real structural advantage worth communicating.

### Gaps
- No documented collapse of a licensed Cameroonian fintech was found.
- Other Cameroon Ponzi cases were not researched in depth. CEMAC-wide reporting on EMF/microfinance failures (for example COFINEST in Cameroon, 2010s) was not researched within the 2018–2026 window.

---

## 5. Evidence on trust signals in the UI

### Takeaway
Rigorous experimental evidence on specific UI trust signals for low-income African users is scarce. What exists is qualitative and points to:
- consistent origin and confirmation signals (official sender, numbered receipts with balance)
- visible fees
- help available at every step and a reachable human
- clear redress information

I found no controlled study on regulator logos, human faces, testimonials or local-language UI in Cameroon.

### Cited Findings
- **Receipts and origin signals:** M-PESA users treat official short-code SMS, receipt-number serialisation and balance display as legitimacy cues. These cues are fragile when formats change or are imitated. The author recommends design that supports users' own trust mechanisms and understanding of processes. — [Kotut, AfriCHI 2025](https://faculty.washington.edu/kotut/papers/AfriCHI2025-Terms-and-Conditions.pdf)
- **Fee transparency:** When agents do not display price schedules, customers assume they are being overcharged and come to see all fees as fraudulent, which reduces willingness to transact. — [MicroSave 2015](https://www.microsave.net/wp-content/uploads/2023/08/Synthesis_Paper_A_Question_of_Trust.pdf)
- **Recourse visibility:** Not knowing "how or where to seek redress" limits trust (Colombia). Hard-to-reach or paid call centres are used only as a last resort. — same source. The ITU-T DFS Focus Group also states that "providing consumers with information and transparency in all digital financial services… is crucial to develop trust and uptake." — [ITU-T FG-DFS, 2017](https://www.itu.int/en/publications/Documents/tsb/2017-DFS-ConsumerExperienceProtection/files/basic-html/page13.html)
- **Help at every step (practitioner, self-reported):** A redesign of UBA (Nigeria) banking platforms added help options at every stage and gentle nudges when users stalled. The author reports onboarding drop-off fell **40%**. Not peer-reviewed. — [BusinessDay](https://businessday.ng/opinion/article/designing-for-financial-inclusion-in-africa-lessons-from-redesigning-ubas-banking-platforms/)
- **Behavioural design:** The CGAP/Busara Tanzania savings research identifies mental accounting, trust and risk, agency, and social influence as levers. Goal-labelled "pots" (mental accounting) are directly relevant to goal-based savings. — [FinDev Gateway](https://www.findevgateway.org/library/behavioural-applications-digital-finance); see also [Cenfri, Driving DFS with behavioural science](https://cenfri.org/publications/driving-digital-financial-services-with-behavioural-science/)
- **Social verification:** Elders rely on family to verify transactions, and young adults use their trusted circle to check offers. — [Kotut 2025](https://faculty.washington.edu/kotut/papers/AfriCHI2025-Terms-and-Conditions.pdf)

### Inferences (proposals for MoloPay, not evidence-tested)
- Show "where your money is" persistently: the partner bank's name, the words "segregated account," and the balance, in each SMS or push receipt with a reference number.
- Publish an approval or partnership reference that users can check. Note that Kenya's licensed-lender *directory* was used as a verification tool.
- Add a one-tap human contact (WhatsApp or phone, free to the user) on every screen, a visible dispute and refund policy, and a visible "withdraw / cancel goal" path.
- Display all fees up front in FCFA.
- Use one official sender ID, a "we will never ask for your PIN" line, and simple anti-scam education. Include a "share with family to verify" feature for older users.
- Use local trust proxies: verified merchant storefronts with physical addresses in Douala and Yaoundé, plus real customer testimonials. Testimonials are unproven in the literature here, so they should be A/B tested.
- French, English (and possibly Pidgin) copy fits Cameroon's bilingual context, but I found no study measuring its effect on trust.

### Gaps
- No CGAP, BFA, Caribou Digital, GSMA or MSC study was found that experimentally tests regulator logos, human faces, testimonials or local language in a Francophone African fintech UI. Targeted searches on Caribou Digital and BFA returned nothing relevant.
- No Cameroon-specific UX research on fintech trust signals was found.
