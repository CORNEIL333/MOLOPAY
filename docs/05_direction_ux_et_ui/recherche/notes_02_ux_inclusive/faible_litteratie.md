# UX/UI design for low-literacy and low-digital-literacy users of financial apps (Africa, Cameroon first): MoloPay

Evidence-strength labels used below:
- **[FORT]**: controlled or quantitative study with measured outcomes (task completion, errors, RCT)
- **[MOYEN]**: nationally representative survey, or structured qualitative fieldwork with large N
- **[FAIBLE]**: practitioner guidance, case study, press, or anecdote

Scope note: the research was capped at about 15 tool calls. Several primary sources (Medhi CHI 2009 and ToCHI 2011) were read in full text. Others are summarized from abstracts or blog posts. Context from the brief, not verified here: 41.6% of Cameroonian adults own a smartphone, and 21.9% of the poorest 40% do.

## 1. Literacy and numeracy in Cameroon (and "oral numeracy")

### Takeaway
The best estimate puts Cameroon's adult (15+) literacy at about 72.5% (UIS-modelled, 2018), so roughly 1 adult in 4 cannot read a simple sentence. Women lag men by about 11 points. More important for a money app, cross-country tests in West Africa show that more than a quarter of adults cannot match a spoken 5-digit amount to its written form. Reading numbers, not only reading words, is the binding constraint.

### Cited Findings
- Adult literacy rate (15+), Cameroon 2018: 72.55% ([Macrotrends, from World Bank/UIS](https://www.macrotrends.net/global-metrics/countries/cmr/cameroon/literacy-rate)); 72.6% for 2018 per the World Bank series SE.ADT.LITR.ZS, which notes that the World Bank uses UIS model-based estimates ([Statistics of the World / World Bank](https://statisticsoftheworld.com/country/cameroon/SE.ADT.LITR.ZS); [FRED series](https://fred.stlouisfed.org/data/SEADTLITRZSCMR)). [MOYEN]
- Conflicting figures: a report citing UNESCO's country page gives 77% for 2018 (men 83%, women 72%) ([africaknows.eu](https://www.africaknows.eu/pdfs/copr07.pdf)). IndexMundi lists 82.41 for 2018 from UIS, but the age group is unclear and may be youth 15–24 ([IndexMundi](https://www.indexmundi.com/facts/cameroon/literacy-rate)). The gaps likely reflect different data vintages or age groups. Use about 72.5% (adults 15+) as the conservative headline. [MOYEN, conflicting]
- Older sex gap: in 2005, literacy was 64.3% for women and 75.4% for men ([Macrotrends](https://www.macrotrends.net/global-metrics/countries/cmr/cameroon/literacy-rate)). [MOYEN]
- Literacy breakdowns by region and urban/rural exist in the 2018 Cameroon DHS (EDS-V), but I did not extract them. The DHS summary also warns that South-West data cover only urban areas ([DHS SR266](https://www.dhsprogram.com/pubs/pdf/SR266/SR266.pdf); [microdata variable v155 literacy](https://microdata.worldbank.org/catalog/3717/variable/F13/V612?name=v155)).
- Oral numeracy (CGAP / My Oral Village, Brett Matthews): in nationally randomized CGAP-funded surveys, respondents heard the spoken number "ten thousand, seven hundred and fifty" and had to pick its written form from five options (including 1,750 and 107,500). **30% in Côte d'Ivoire** and **26% in Myanmar** picked the wrong order of magnitude ([CGAP, "Financial Innumeracy: A Global Problem for Digital Finance?"](https://www.cgap.org/blog/financial-innumeracy-global-problem-for-digital-finance)). [MOYEN–FORT: nationally representative test]
- In Côte d'Ivoire, being financially numerate raised the odds of financial inclusion by "over 500 percent" (InterMedia, Sam Schueth, cited by CGAP). The same source reports a "large gap" between reading 1-digit numbers and reading large money amounts ($10–100 equivalent) ([CGAP](https://www.cgap.org/blog/financial-innumeracy-global-problem-for-digital-finance)). [MOYEN]
- Financial numeracy is weak among oral populations, and oral lifestyles shift incentives away from learning written-number skills ([CGAP, "A Multi-Digit Divide? Building Basic Financial Numeracy"](https://cgap.org/node/2644)). [FAIBLE–MOYEN]
- Fieldwork with 90 low-literacy subjects (India, Kenya, Philippines, South Africa) found typical users were "functionally illiterate or semiliterate but partially numerate." Almost all could identify the numbers on SMS receipts and what they meant, even when they could not read the text. Receipts listing multiple transactions still confused them ([Medhi et al., ACM ToCHI 18(1), 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)). [MOYEN]
- Nonliterate users identify and count cash with few errors, using colour, relative note size, imagery and the number of zeros. Money-handling experience, not schooling, drives their numeracy. Many still struggle to read multi-digit number strings ([Anand & Poddar, MicroSave, NextBillion, 21 Sept 2017](https://nextbillion.net/designing-a-mobile-wallet-for-nonliterate-people-a-beginners-guide/)). [FAIBLE–MOYEN]

### Inferences
- Côte d'Ivoire is the closest proxy for Cameroon: francophone, CFA zone, similar mobile money market. A rough planning figure is that 25–30% of MoloPay's mass-market users may misread the magnitude of a written 5–6-digit FCFA amount. Typical savings goals fall in that range (10,000–500,000 FCFA).
- Users who cannot read words often can read digits, so digits plus icons, audio and cash images will reach more people than translated text alone.
- Urban Douala and Yaoundé are likely above the national literacy average, but the rural-to-urban migrants and older women among MoloPay's targets are likely below it. This is an inference; regional data was not extracted.

### Gaps
- I did not retrieve 2018 DHS literacy by region, urban/rural, or francophone vs anglophone zone. The next step is EDS-V 2018, education chapter.
- I found no Cameroon-specific financial numeracy test like the CGAP/MOV one. The Côte d'Ivoire figures are a proxy.
- PASEC 2019 Cameroon reading and math proficiency was not retrieved.

## 2. Tested design patterns (Medhi, CGAP, GSMA, MSC, etc.) and measured effects

### Takeaway
The strongest quantitative evidence comes from Medhi et al. (Microsoft Research India). Low-literate first-time users had **0% task completion on text UIs**, **72% on a voice/IVR UI** (faster, less help), and **100% on a graphical, text-free UI with voice feedback** (twice as slow, three times more prompts). Text UIs cause about 5% error rates even for literate novices. Shallow menus, no scrolling, no soft keys, no text entry, and human mediators are the core recommendations.

### Cited Findings
- **Mobile money-transfer experiment (N=58 non-/semi-literate adults, Bangalore, aged 25–65):** text UI completion was 0/20. Voice-based (IVR) UI completion was 72% (13/18). Rich-client graphical UI (hand-drawn graphics plus voice feedback) completion was 100% (20/20). The graphical UI took more than twice as long (ANOVA F=21.49, p<0.05) and needed more than three times as many assistance prompts (F=30.48, p<0.05) as voice ([Medhi, Gautama & Toyama, CHI 2009](https://microsoft.com/en-us/research/wp-content/uploads/2016/02/medhi_chi2009.pdf)). [FORT, small N]
- In the same study, voice-UI completion was 60% (6/10) for women vs about 88% (7/8) for men. Women took twice as long overall (F=14.6, p<0.05), but needed a similar number of prompts ([Medhi et al., CHI 2009](https://microsoft.com/en-us/research/wp-content/uploads/2016/02/medhi_chi2009.pdf)). [FORT, small N]
- Why the graphical UI was slow: users "required significant prompting, encouragement, and time to press any key as they were nervous that they might 'break' or 'spoil' the phone." Voice failures came from users lacking understanding of "the context, the terminology, or the interface" ([Medhi et al., ToCHI 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)). [FORT]
- **Text vs live operator (13 literate health workers, Gujarat):** error rates were 4.2% on electronic forms and 4.5% on SMS, versus 0.45% with a live operator, a tenfold reduction ([Medhi et al., ToCHI 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)). [FORT, small N]
- **Ethnography with 90 low-literacy subjects (India, Kenya, Philippines, South Africa; 100 hours):** [MOYEN]
  - 56/90 could not initially navigate hierarchical menus. All 40 non-phone-users failed, and only 16/50 phone users succeeded.
  - 23 of the 34 who could perform tasks on their own handset could not do them on a different handset.
  - 48/90 did not understand vertical scrollbars ("did not realize there were functions 'beneath'").
  - 45 had difficulty with soft keys.
  - 27/50 phone users used voice calls only, and 24 of those could not type a single word.
  - Users could type digits but could not find "*" and "#".
  - Banking terms ("View last transaction", "Get balance", "Change PIN") were "alien concepts" even in the local language.
  - Manuals went unread, and "human mediation was critical for most successful transactions."
  ([Medhi et al., ToCHI 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf))
- **Medhi et al.'s 8 design recommendations:**
  1. Provide graphical cues.
  2. Provide voice annotation wherever possible.
  3. Provide local-language support in text and audio.
  4. Minimize hierarchical structures.
  5. Avoid non-numeric text input.
  6. Avoid menus that require scrolling.
  7. Minimize soft-key mappings.
  8. Integrate human mediators to familiarize users.

  The authors suggest that "spoken input, graphical output could combine benefits" ([Medhi et al., ToCHI 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)). [MOYEN–FORT]
- **Text-free UI (2007, Bangalore slum domestic workers):** text-free designs were strongly preferred over text. The study confirmed the need for semi-abstract graphics and voice feedback, and found an overlooked need for a consistent help feature ([Medhi, Sagar & Toyama, "Text-Free User Interfaces for Illiterate and Semi-literate Users", ITID 2007 / MSR](https://www.microsoft.com/en-us/research/?p=160568)). [MOYEN]
- **Full-context video (ICTD 2007, 35 non-literate Bangalore residents):** looping dramatized videos of the whole usage scenario "dramatically improved" task completion and reduced first-use barriers ([Medhi & Toyama, ICTD 2007](https://microsoft.com/en-us/research/wp-content/uploads/2016/02/ictd2007_medhi_toyama.pdf); summary in [ToCHI 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)). [FORT, small N]
- **MicroSave + My Oral Village, "MoWO" (Mobile Wallet for the Oral segment), India:** [FAIBLE–MOYEN, qualitative]
  - The process used a literacy/numeracy screening, a counting/money capacity test, and 26 focus-group sessions on wireframes.
  - Images were tested for guessability (time and errors to guess meaning) and recall.
  - The wallet uses a cash-based input method for entering large numbers safely and an image-based phone book.
  - Iterations: a black border was added around note images so users can count notes at a glance, and too many input fields per screen caused problems.

  ([MicroSave, MoWO deck 2018](https://www.microsave.net/wp-content/uploads/2018/10/Mobile_Wallets_for_the_Oral_Segment_MoWO.pdf); [MicroSave project page](https://www.microsave.net/signature_projects/designing-a-mobile-wallet-application-for-the-oral-segment/); [Mobile Wallet Design for Oral Users, 2017](https://www.microsave.net/wp-content/uploads/2017/05/Mobile_Wallet_Design_for_Oral_Users.pdf))
- MicroSave advises testing icons separately with literate and nonliterate users, because icons guessable by the literate may not be by the nonliterate ([NextBillion/MicroSave 2017](https://nextbillion.net/designing-a-mobile-wallet-for-nonliterate-people-a-beginners-guide/)). [FAIBLE]
- GSMA: about half of mobile money account owners report needing help with their account ([GSMA, Advancing Digital Financial Literacy: Insights from Two Pilots, 2025](https://www.gsma.com/solutions-and-impact/connectivity-for-good/mobile-for-development/gsma_resources/advancing-digital-financial-literacy-insights-from-two-pilots/); [PDF](https://www.gsma.com/solutions-and-impact/connectivity-for-good/mobile-for-development/wp-content/uploads/2025/08/Advancing-Digital-Financial-Literacy-Report.pdf)). GSMA also has a Digital Financial Literacy toolkit with guidelines for agent and end-user training ([GSMA DFL](https://www.gsma.com/solutions-and-impact/connectivity-for-good/mobile-for-development/mobile-money/digital-financial-literacy/)). [MOYEN; the figure is from a search snippet and was not verified in the PDF]
- CGAP and Continuum used human-centred design with non-literate and non-numerate users to redesign ATMs in Pakistan ([Financial Access Initiative, 2015](https://www.financialaccess.org/blog/2015/8/3/bringing-financial-services-to-illiterate-populations)). [FAIBLE]

### Inferences
- For MoloPay: build a graphical, icon-plus-digit UI with optional voice playback on every screen (Medhi's "graphical output plus voice" hybrid). Use one action per screen, no hidden menus, no scroll-to-find, and a large persistent "help/écouter" button.
- First-use fear ("I will break it") is a real cost. A short onboarding video showing a Douala vendor saving toward a goal is supported by the ICTD 2007 evidence.
- Expect about 2x slower completion and more help requests from women and first-time users. Agent- or relative-assisted onboarding should be designed in, not treated as a failure.

### Gaps
- The Busara Center iconography comprehension studies were not found in this pass.
- I found no Google Next Billion Users or BRAC study with measured outcomes.
- There is no Cameroon- or francophone-Africa-specific usability test of a financial app.
- Most quantitative studies are from India, with small Ns (around 20 per arm), around 2007–2011.

## 3. Icons and imagery (icon styles, cultural interpretation, banknote photos, colour, avatars)

### Takeaway
Earlier HCI evidence favours semi-abstract, hand-drawn, concrete icons with action elements over abstract glyphs, and some studies favour them over photos too. Newer work suggests low-literate users prefer concrete, photorealistic depictions over stylized glyphs. The consistent rule is to be concrete, avoid abstract metaphors, and test guessability locally. For amounts, images of real banknotes and coins are among the most validated oral-user tools.

### Cited Findings
- "Static hand-drawn representations are better understood than photographs or icons" (citing Medhi et al. 2007a). The 2007 text-free work recommended semi-abstracted graphics ([Medhi et al., ToCHI 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf); [Medhi et al., CHI 2009](https://microsoft.com/en-us/research/wp-content/uploads/2016/02/medhi_chi2009.pdf)). [MOYEN]
- Contrast: a 2026 arXiv paper states that icons are often semantically opaque to low-literacy users, who prefer concrete, photorealistic representations over stylized glyphs. Its user study found **85% of low-literacy participants did not understand basic app permissions** ([Pervez et al., "(Mis-)Informed Consent: Predatory Apps and the Exploitation of Populations with Limited Literacy", arXiv 2601.17025, 2026](https://arxiv.org/abs/2601.17025)). [MOYEN; preprint, not peer reviewed]
- A thesis that collected drawings from illiterate users and built an icon-based phone prototype found that concreteness, low complexity, a balanced level of detail and action elements help users understand new icons ([Univ. of Bergen thesis, "Exploring the text free interface for illiterate users"](https://bora.uib.no/handle/1956/4843)). [FAIBLE]
- "Text is not the enemy": research on how illiterate people use their phones found they use text-bearing interfaces through memorised patterns, which argues against fully text-free design ([Knoche & Huang](https://vbn.aau.dk/ws/files/309756266/TextIsNotTheEnemy_NUI_Workshop.pdf)). [FAIBLE; details not extracted]
- Banknote and cash imagery: nonliterate users rely on note colour, size, imagery and the number of zeros. MoWO used a cash-based input method editor and added black borders so the count of notes is visible at a glance ([NextBillion/MicroSave 2017](https://nextbillion.net/designing-a-mobile-wallet-for-nonliterate-people-a-beginners-guide/); [MicroSave MoWO](https://www.microsave.net/wp-content/uploads/2018/10/Mobile_Wallets_for_the_Oral_Segment_MoWO.pdf)). CGAP recommends "cash scrollbars and keyboards" and cash-based place-value guides ([CGAP](https://www.cgap.org/blog/financial-innumeracy-global-problem-for-digital-finance)). The Orali Money (GNU Taler and My Oral Village) Android wallet implements oral information management principles ([User guide](https://myoralvillage.github.io/OIM-Taler-Wallet/user-guide/)). [MOYEN]
- Image-based phone book (photos of contacts instead of names) is part of the MoWO design ([MicroSave](https://www.microsave.net/wp-content/uploads/2018/10/Mobile_Wallets_for_the_Oral_Segment_MoWO.pdf)). [FAIBLE–MOYEN]

### Inferences
- For MoloPay: show amounts as digits plus a strip of FCFA note and coin images (e.g., 25,000 = 2×10,000 + 1×5,000, using the BEAC CEMAC 2022-series notes users actually handle). Show the goal product as a real photo, with a fill bar or jar for progress. Use semi-abstract action icons (send arrow with hand, padlock) and test every icon with 10–20 target users for guessability.
- Use contact photos or avatars on recipient screens to reduce wrong-recipient errors.
- Colour: use green and red redundantly with icons and sound, never colour alone.

### Gaps
- I found no direct comprehension rates for photo vs drawing icons, and no African study measuring icon interpretation (Busara not found).
- I found no evidence on cultural colour meaning in Cameroon or on avatar use.
- Legal use of BEAC banknote images in apps was not checked.

## 4. Voice and audio (IVR, audio prompts, local languages)

### Takeaway
Voice lowers the barrier: it is the fastest modality and needs the least help. In an RCT in Ghana, IVR calls explaining how to transact raised mobile-banking use. Pure voice interfaces fail users who do not understand the underlying concepts, so pair voice with visuals.

### Cited Findings
- Voice/IVR mobile-money UI: 72% completion, more than twice as fast and less than a third of the prompts compared with the graphical UI ([Medhi et al., CHI 2009](https://microsoft.com/en-us/research/wp-content/uploads/2016/02/medhi_chi2009.pdf)). [FORT, small N]
- **Ghana RCT (J-PAL, Opportunity International Savings & Loans + Viamo, 15,000 clients):** ten weekly IVR calls on how to use mobile banking, in English and two local languages. Monthly transacting rose by 6.3 percentage points from a 2.4% comparison base, and transaction value roughly tripled. Five months later, 4.2% vs 2.8% still transacted monthly. IVR calls about savings benefits alone did not increase mobile-banking use. The authors conclude that "information on how to make a mobile transaction was critical." Survey response was only 15% ([J-PAL evaluation summary](https://www.povertyactionlab.org/print/pdf/node/8135986?lang=en)). [FORT]
- SMS campaigns have mixed success where literacy is low, which is the rationale for voice ([J-PAL](https://www.povertyactionlab.org/print/pdf/node/8135986?lang=en)). [MOYEN]
- UNCDF "Efie Ni Efie" (Ghana, Fidelity Bank and Viamo): an IVR line in local languages walks users through onboarding ([UNCDF case study](https://www.uncdf.org/article/8861/providing-financial-literacy-via-interactive-voice-response)). [FAIBLE]
- Practitioner account: voice messages with branching by customer response engage better given literacy limits ([ICTworks](https://www.ictworks.org/ivr-reach-african-women/)). [FAIBLE]

### Inferences
- For MoloPay: give each screen a speaker button with prerecorded human voice (Medhi used prerecorded human speech) in French and English, and later Pidgin English and possibly Ewondo or Duala for Yaoundé and Douala. Content should be "how-to" (procedural), not only benefits.
- Read amounts aloud on confirmation ("Vous allez envoyer vingt-cinq mille francs à Marie"). This directly targets the 26–30% order-of-magnitude error.

### Gaps
- I found no Cameroon voice/IVR fintech study, no data on Cameroonian Pidgin or local-language audio adoption, and no voice-input speech-recognition accuracy data for Cameroonian French accents.

## 5. Numbers and amounts (FCFA display, separators, "mille" conventions, read-back, wrong-number prevention)

### Takeaway
Amount entry and reading is the highest-risk step. More than 25% misread magnitude (CGAP), and users count zeros. Use cash-based entry or presets, show amounts in several redundant ways (digits with clear separators, spoken words, banknote images), and require a read-back confirmation. Wrong transfers in Cameroon are reversible only if the recipient agrees and has not withdrawn the funds.

### Cited Findings
- 26–30% order-of-magnitude errors matching spoken to written 5-digit amounts ([CGAP](https://www.cgap.org/blog/financial-innumeracy-global-problem-for-digital-finance)). [MOYEN–FORT]
- Users count zeros and use note colour and size to identify amounts ([NextBillion/MicroSave](https://nextbillion.net/designing-a-mobile-wallet-for-nonliterate-people-a-beginners-guide/)). [FAIBLE–MOYEN]
- Cash-based input method "to enter large numbers safely" ([MicroSave MoWO](https://www.microsave.net/wp-content/uploads/2018/10/Mobile_Wallets_for_the_Oral_Segment_MoWO.pdf)). [FAIBLE–MOYEN]
- Users comfortably type digits, and many nonliterate people read digits ([Medhi et al., ToCHI 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)). [MOYEN]
- Users redial numbers from scratch instead of using call logs or address books ([Medhi et al., ToCHI 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)). This makes typos in recipient numbers more likely. [MOYEN]
- Cameroon transfer reversal (May 2024): Orange Money uses `#150*15#` to cancel a mistaken transfer, possible only if the recipient agrees and has not withdrawn. MTN MoMo uses `*126#` then option 7, 6, or customer service on 8787. No time limits are specified ([Digital Business Africa, 21 May 2024](https://www.digitalbusiness.africa/cameroun-les-conditions-pour-annuler-un-transfert-dargent-en-cas-derreur-chez-orange-et-mtn/)). [FAIBLE–MOYEN]

### Inferences
- **Separators:** French typography uses a space (thin non-breaking space) for thousands, e.g. "25 000 FCFA", while English uses commas ("25,000"). For bilingual low-literate users, pick one large, spaced format, ideally a non-breaking space, which is unambiguous in both languages. Avoid "." as a thousands separator, because it can be confused with decimals. FCFA has no decimals in practice, so never show ",00". This is an inference, not tested.
- Write the amount in words or show a "mille" chip ("25 mille") alongside the digits, play audio, and show note images. Keep the amount field large, and for savings deposits offer preset chips (500 / 1 000 / 2 000 / 5 000 / 10 000).
- **Wrong-number prevention:** show the recipient's registered name and photo before confirmation (name lookup, as MTN and Orange do). For new recipients, require entering the number twice or confirming the last 3 digits. Use a short delay or "undo" window on MoloPay-internal transfers, since operator reversal depends on recipient goodwill.
- Large-amount friction: add an extra confirm step and audio read-back when an amount is 10 times or more the user's typical deposit, to catch magnitude errors.

### Gaps
- I could not verify Camfranglais money slang ("kolo", "bâton", etc.). The search confirmed only "nkap" (money, from Ghomala') ([Wikipedia Camfranglais / sources](https://Www.Wikipedia.org/wiki/Camfranglais)). Validate local amount vocabulary with Douala and Yaoundé users before using slang in UI or audio.
- I found no study testing thousands-separator formats with low-literate users.

## 6. Errors and help (assisted digital, tutorials, undo, confirmation) and scam protection

### Takeaway
Human help is the most effective single intervention: a live operator cut errors tenfold, and human mediation was "critical for most successful transactions." About half of mobile-money users need help. Scams in Cameroon centre on account takeover, rogue agents and fake transfers, so protective UX must assume shared phones and assisted use without exposing PINs.

### Cited Findings
- Live operator: 0.45% errors vs 4.2–4.5% for text ([Medhi et al., ToCHI 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)). [FORT]
- Human mediation was critical, and manuals went unread ([Medhi et al., ToCHI 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)). [MOYEN]
- A consistent help feature was an overlooked need, and voice-recorded help is valuable ([Medhi et al. 2007, MSR](https://www.microsoft.com/en-us/research/?p=160568); [ToCHI 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)). [MOYEN]
- Dramatized full-context video improved first-time task completion ([Medhi & Toyama, ICTD 2007](https://microsoft.com/en-us/research/wp-content/uploads/2016/02/ictd2007_medhi_toyama.pdf)). [FORT, small N]
- About half of mobile money account owners need help ([GSMA 2025](https://www.gsma.com/solutions-and-impact/connectivity-for-good/mobile-for-development/gsma_resources/advancing-digital-financial-literacy-insights-from-two-pilots/)). [MOYEN]
- 85% of low-literacy participants did not understand app permissions. Predatory loan, gambling and trading apps (50 apps analysed) omit or obscure disclosures ([Pervez et al., arXiv 2026](https://arxiv.org/abs/2601.17025)). [MOYEN, preprint]
- **Cameroon scam patterns:** [FAIBLE]
  - Complaints number "in the thousands" (anecdotal).
  - One documented account takeover drained 117,000 FCFA (about 99% of the balance) within minutes of a fraudster's new device connecting, with no cooling-off hold ([237online](https://www.237online.com/?p=187998)).
  - A legal note lists rogue-agent cash-outs and account takeover via malware, shared devices or weak authentication ([Global Law Experts, 2026](https://globallawexperts.com/cameroon-fintech-platforms-navigating-mobile-money-fraud-or-unauthorized-transactions/)).
  - Operator measures: MTN `*126*15#` blocks withdrawals ([AllAfrica, Sept 2025](https://fr.allafrica.com/stories/202509300387.html)), and Orange runs "OM Anti-arnaques" reporting ([Digital Business Africa](https://www.digitalbusiness.africa/cameroun-les-conditions-pour-annuler-un-transfert-dargent-en-cas-derreur-chez-orange-et-mtn/)).
  - A 2023 overview covers common money-transfer scams in Cameroon ([Guardian.ng / Africa.com](https://africa.com/ama/four-money-transfer-scams-to-beware-of-in-cameroon-in-2023-2)).

### Inferences
- For MoloPay:
  - Provide an "assisted mode" in which an agent or relative can guide the user while the user, never the helper, enters the PIN. On-screen and audio warnings should say "Ne donnez jamais votre code" (never give your code).
  - Hold withdrawals or large purchases for 24 hours after a new-device login. This counters the 117k FCFA takeover pattern, and savings products tolerate the delay.
  - Show in-app transaction proof that cannot be faked by SMS, and teach "check your MoloPay balance, not the SMS."
  - Use a 2-step confirmation summary (photo of recipient or merchant, amount in digits, words and audio, notes image) plus an undo window.
  - Explain permissions with pictures and audio.
- A savings-to-purchase model where funds go to a merchant, not cash-out, inherently reduces scam surface. Stress this in UX copy.

### Gaps
- I found no measured study of confirmation screens or undo reducing wrong transfers in Africa.
- I found no quantified data on Cameroon mobile money fraud prevalence (only anecdotes).
- The Busara and MSC scam-UX studies were not found in this pass.

## 7. Low-end devices, data cost, Lite apps and PWA performance

### Takeaway
Lite-app experience shows that data cost is the users' top concern. Facebook Lite targeted an APK under 1 MB, 2G networks, and 2009-era Android devices, and shipped at 252 KB. The same constraints apply to a MoloPay PWA: a tiny initial payload, offline tolerance, and simple screens.

### Cited Findings
- Facebook engineering: "cost of data and overall data usage" mattered most to emerging-market users. Engineering targets were an APK under 1 MB, data-minimal client-server interaction working on 2G, Gingerbread support, and a 2009-era device ([Engineering at Meta, 9 Mar 2016](https://engineering.fb.com/2016/03/09/android/how-we-built-facebook-lite-for-every-android-phone-and-network/)). [MOYEN]
- At launch in 2015, Facebook Lite was 252 KB and required Android 2.2+ ([HotHardware](https://hothardware.com/news/facebook-lite-for-android-trims-bloat-weighs-in-at-just-252kb)). It dropped video and advanced location to save resources ([TechCrunch](https://techcrunch.com/2015/01/25/facebook-lite-rides-again)). [FAIBLE]
- Facebook Lite works on 2G, uses less data than the main app, and is also on KaiOS feature phones (2020) ([Tech at Meta 2020](https://tech.facebook.com/engineering/2020/8/facebook-lite-made-in-tel-aviv)). [FAIBLE]
- Some users could operate only their own handset: 23/34 failed on an unfamiliar phone ([Medhi et al., ToCHI 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)). This argues for following familiar Android or mobile-money conventions. [MOYEN]

### Inferences
- For the MoloPay PWA:
  - Keep the initial load small (a few hundred KB), and cache the shell and audio via a service worker.
  - Prefer compressed audio clips (short Opus/AAC) loaded lazily.
  - Use SVG icons and low-resolution product photos.
  - Make the app tolerant of an offline queue.
  - Offer a USSD/SMS fallback for the 58% of adults without smartphones (figure from the brief).
  - Use large touch targets and a one-column layout for small screens.

### Gaps
- I found no measured data on PWA performance on low-end Android in Africa, Google Go design lessons, or Cameroonian data prices and typical device RAM. Recommended next sources: GSMA Mobile Economy Sub-Saharan Africa 2025, A4AI affordability data, and the Google web.dev PWA case studies (e.g., Jumia).
