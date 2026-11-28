# Measured e-commerce and marketplace UX findings, applied to MoloPay (Cameroon, mobile-first savings-to-purchase marketplace)

Notes from about 17 tool calls (searches plus fetches of primary pages). Source labels: **[Independent]** means academic, peer-reviewed or regulator. **[UX research firm]** means Baymard or NN/g: these are commercial, but they run their own usability testing and benchmarks. **[Vendor/sponsored]** means the study was funded by a company with a commercial interest (for example, Google commissioning Deloitte). Many detailed Baymard figures sit behind its Premium paywall, so only the free article-level numbers are quoted here.

## 1. Baymard Institute: product lists, filtering, sorting, search, product pages, comparison

### Takeaway
Most e-commerce sites still perform at "mediocre or worse" levels, and mobile performs worse than desktop: 78% of mobile sites for product lists (2025 benchmark), 62% for product pages, and 58% for search. The usual failures are missing essential filters and sort options, poor handling of misspellings and synonyms, no in-scale images, no price per unit or total-cost information, and save features that are hard to use. The bar is low, so a well-executed basic catalogue is already a real differentiator.

### Cited Findings
**Product lists and filtering (Baymard 2025 benchmark, 170+ US/EU sites, 21,000+ manually scored UX parameters)** [UX research firm]
- 58% of desktop sites and 78% of mobile sites rate "poor" to "mediocre" on Product List UX — [Baymard, Current state of product list & filtering UX](https://baymard.com/research-articles/current-state-product-list-and-filtering)
- 51% of sites do not offer all 5 essential filter types (price, user rating, colour, size, brand). The headline of an older related article gives 57% — [Baymard](https://baymard.com/research-articles/current-state-product-list-and-filtering)
- 14% of sites do not let users select several values within the same filter type, which leads users to abandon products — [Baymard](https://baymard.com/research-articles/current-state-product-list-and-filtering)
- 20% of sites do not show an overview of applied filters (28% in an older article) — [Baymard](https://baymard.com/research-articles/current-state-product-list-and-filtering)
- 69% of sites do not offer all 4 essential sort types (price, user rating, best-selling, newest). The split is 68% desktop and 69% mobile — [Baymard](https://baymard.com/research-articles/current-state-product-list-and-filtering)
- 80% of sites show fewer than 3 thumbnails per product in lists and search results. Baymard's minimum is 2 additional thumbnails — [Baymard](https://baymard.com/research-articles/current-state-product-list-and-filtering)
- 42% of sites do not group a product's variations into a single list item — [Baymard](https://baymard.com/research-articles/current-state-product-list-and-filtering)
- 67% of sites do not show price per unit for products sold in varying quantities (86% in an older related article) — [Baymard](https://baymard.com/research-articles/current-state-product-list-and-filtering)
- In qualitative testing, participants applied 5 or 6 filters, and some applied up to 10. Horizontal filter toolbars hide options, so hidden filters are often overlooked — [Baymard](https://baymard.com/research-articles/current-state-product-list-and-filtering)
- 38% of sites (2019 study) offer no filter for attributes they already display in list items. Baymard says the problem is worse on mobile, where filters are hidden and the screen is small — [Baymard, Have filters for list item info](https://baymard.com/research-articles/have-filters-for-list-item-info)
- 61% of sites (2023) do not promote filters inside the product list. Baymard says promoted filters help mobile users in particular — [Baymard, Promoting product filters](https://baymard.com/research-articles/promoting-product-filters)

**Search (Baymard benchmark, 2026 edition)** [UX research firm]
- 46% of desktop sites, 58% of mobile sites and 64% of apps are "mediocre or worse" on search UX. Baymard identifies 8 essential query types (exact, product type, symptom, non-product, feature, thematic, relational, compatibility). The article headline says 56% of sites have issues — [Baymard, Search query types](https://baymard.com/research-articles/ecommerce-search-query-types)
- 69% of sites put users at risk of badly misreading the catalogue because their autocomplete handles misspellings poorly (older article) — reported in search-result summaries of [Baymard search research](https://baymard.com/research-articles/ecommerce-search-report-and-benchmark). I did not verify the year.
- On 60% of sites, users must type the same product-type jargon the site uses, meaning there is no synonym support — summary of [Baymard search articles](https://www.baymard.com/ecommerce-search/articles). I did not see this on the primary page.

**Product page (Baymard benchmark, 155+ sites, 30,000+ scores)** [UX research firm]
- 52% of desktop sites, 62% of mobile sites and 64% of apps are "mediocre or worse" on product page UX — [Baymard, Current state of product page UX](https://baymard.com/research-articles/current-state-ecommerce-product-page-ux)
- 42% of users try to judge a product's size from its images. 37% of sites provide no "in scale" image (product next to a person or an object of known size). Older figures were 28% (2017) and 45% — [Baymard, current state](https://baymard.com/research-articles/current-state-ecommerce-product-page-ux); [Baymard, In-scale images](https://baymard.com/research-articles/in-scale-product-images)
- 67% of sites give no estimate of the total order cost near the buy section, and 81% do not show price per unit for multi-quantity products — [Baymard](https://baymard.com/research-articles/current-state-ecommerce-product-page-ux)
- 60% of respondents (n=1,032, 2025) look for the return policy on the product page. 44% of sites neither show it nor link to it there. 15% of US shoppers (n=1,026) abandoned an order in the past quarter because of an unsatisfactory return policy — [Baymard](https://baymard.com/research-articles/current-state-ecommerce-product-page-ux)
- 89% of sites do not reply to negative reviews, and 63% do not let users browse the photos that reviewers uploaded — [Baymard](https://baymard.com/research-articles/current-state-ecommerce-product-page-ux)
- 21% of respondents (n=1,193, 2025) rely on "Save" features, yet 89% of sites make save and wishlist features hard to access or use — [Baymard](https://baymard.com/research-articles/current-state-ecommerce-product-page-ux)

**Comparison (Baymard, 2022)** [UX research firm]
- On sites selling spec-driven products, 67% of desktop test participants used comparison features. 17% of those sites offer no comparison tool. Good tools compare up to 5 products, and most sites cap at 3 to 5 — [Baymard, Provide comparison features](https://baymard.com/research-articles/provide-comparison-features)
- **On mobile, only 3 of 38 participants used a comparison feature.** Baymard recommends showing "Compare" checkboxes persistently (not only on hover) with a panel listing the selected items. Its strong recommendation applies to desktop — [Baymard](https://baymard.com/research-articles/provide-comparison-features)

### Inferences
- MoloPay's "tech & appliances" universe is spec-driven, so it needs comparison, but the mobile data (3/38) suggests a lightweight form: "compare 2 to 3 products" from the product page, or ready-made comparison tables, rather than a free-form multi-select tool.
- Translating Baymard's essential filters to MoloPay: price (and/or **daily or weekly savings amount**), brand, verified partner, city/availability, savings duration. Essential sorts: price, popularity, newest, and "fastest to reach."
- Showing the full total cost (frozen price + fees + delivery), the savings schedule, and the cancellation/refund policy on the product page maps directly to the 67%/60%/44% figures. In a reservation model, the "return policy" equivalent is the policy for cancelling a reservation and getting savings back.
- In-scale photos are critical for housing (furniture), appliances and motorbikes. Users on 3G cannot afford to load many images, so one good in-context image beats five generic ones.

### Gaps
- Mobile-specific Baymard figures for "load more vs pagination" and for search misspellings are mostly behind Premium, and I could not verify them on primary pages.
- Baymard samples are US and European sites. I found no Baymard data on African markets.

## 2. Nielsen Norman Group: search, facets, product content, comparison, trust, saving items

### Takeaway
NN/g's free articles are mostly qualitative (design principles from usability testing) and give few percentages. The robust points: use static comparison tables for fewer than 5 items, people use the cart as external memory, and the label "Wishlist" is perceived as being for gifts.

### Cited Findings
- Static comparison tables (preselected products) suit small selections (under 5 items). Dynamic tables (the user picks the items) suit large catalogues — [NN/g, Comparison tables](https://nngroup.com/articles/comparison-tables/) [UX research firm]
- Research on 49 e-commerce sites found that shoppers use the cart as a holding area to compare and save products for later sessions. The label "Wishlist" suggested to users that its purpose was sharing gift ideas, while "Favorites" or "My List" did not carry that connotation. NN/g recommends keeping save-for-later easy to find and not putting it behind a login wall — [NN/g, Shopping Carts Are External Memory](https://www.nngroup.com/articles/wishlist-or-cart/) [UX research firm]
- NN/g publishes a paid report series on e-commerce, including Vol. 08 on wishlists and gifts. I did not have access to the details — [NN/g report](https://www.nngroup.com/reports/ecommerce-ux-wishlists-and-gifts/)

### Inferences
- For MoloPay, a "Mes envies / My favourites" list available without an account (stored locally, synced after sign-up) fits NN/g's advice. A favourite is the natural step before a reservation.
- The reservation itself works as a "cart with external memory," which is consistent with how users already behave.

### Gaps
- I did not fetch NN/g quantitative figures on search, faceted navigation or trust signals during this session, so none are quoted here. Older NN/g findings (search vs browse behaviour) were not verified.

## 3. Imagery, page weight and performance on low bandwidth

### Takeaway
Small speed gains have measurable effects on mobile conversion, but most of the numbers come from Google-sponsored studies. The strongest evidence is a controlled A/B test (Vodafone, LCP -31% → sales +8%). On 3G networks and low-end Android phones, image weight is the first lever.

### Cited Findings
- **Deloitte "Milliseconds Make Millions" (2020, commissioned by Google, with 55):** 37 brands in Europe and the US over 4 weeks, with retail data from 20.5M sessions across 15 brands. A 0.1 s improvement in mobile speed was associated with +8.4% retail conversions (the full report also says "8%") and +9.2% average order value. Travel conversions rose 10.1%. In the funnel, product page to basket rose +3.9% and checkout to order +4.7% — [web.dev case study](https://web.dev/case-studies/milliseconds-make-millions); [Deloitte report PDF](https://www2.deloitte.com/content/dam/Deloitte/ie/Documents/Consulting/Milliseconds_Make_Millions_report.pdf) [Vendor/sponsored, observational correlation]
- **Vodafone (web.dev, March 2021):** In an A/B test where the two page versions differed only in Web Vitals optimisation, a 31% better field LCP (5.7 s vs 8.3 s) gave +8% sales, +15% lead-to-visit and +11% cart-to-visit — [web.dev, Vodafone](https://web.dev/case-studies/vodafone) [Vendor-published, but a controlled experiment]
- **Google/SOASTA (2017):** The probability of bounce increases 32% when mobile load time goes from 1 s to 3 s (90% for 1 s to 5 s, according to the Deloitte report) — [Think with Google](https://thinkwithgoogle.com/data/page-load-time-statistics) [Vendor, ML model]
- **Google Mobile Site Speed Playbook:** "53% of people will leave a mobile site if it takes more than three seconds to load." This figure is often confused with the 32% figure, but it measures something else — [Google Playbook PDF](https://thinkwithgoogle.com/_qs/documents/4290/c676a_Google_MobileSiteSpeed_Playbook_v2.1_digital_4JWkGQT.pdf) [Vendor, old figure (2016–2017) that is widely repeated without context]
- Baymard: 42% of users judge size from images, and 80% of sites show fewer than 3 thumbnails in lists. Images are a primary information source, not decoration — [Baymard](https://baymard.com/research-articles/in-scale-product-images); [Baymard](https://baymard.com/research-articles/current-state-product-list-and-filtering)

### Inferences
- There is a tension between "more images" (Baymard) and "lighter pages" (Google). One way to resolve it on MoloPay: in lists, show a single compressed thumbnail (WebP/AVIF, lazy-loaded) with more images available on swipe. On product pages, load 1 hero image plus an in-scale/in-context image first, then the rest on demand. Offer a data-saver mode that shows placeholders or text until the user taps.
- Note that the Vodafone test's absolute LCP values (5.7 to 8.3 s) are close to real conditions on 3G in Cameroon. The gains measured there are therefore relevant, not only theoretical.

### Gaps
- I found no independent, peer-reviewed study on how many images to show or on the effect of zoom on conversion. The Baymard figures are behavioural, not conversion figures.
- I found no web.dev or Google study specific to Africa or Cameroon, and no data on network conditions in Cameroon in this session.

## 4. Search and interfaces in emerging markets (voice, literacy, typos)

### Takeaway
For low-literacy users, the measured evidence favours visual, text-light interfaces with voice or audio support and consistent help. Voice search is promising, but accent recognition causes users to give up quickly. I found no Africa-specific figures for voice search in e-commerce.

### Cited Findings
- Google Next Billion Users (2021, "Voice playbook"): voice lets people with low literacy do things on their own and avoids the difficulty of typing. Accent recognition is a frequent complaint, users give up after a few failures, blame themselves, and fear being mocked. Recommendations: make voice entry points easy to find with simple icons, and keep spoken outputs short. The post cites Statista: 42% of the world's population recently did a voice search — [Google blog, Voice playbook](https://blog.google/technology/next-billion-users/voice-users-playbook/) [Vendor; Statista figure is secondary]
- Medhi, Patnaik, Brunskill et al. (ACM ToCHI 2011), 90 low-literacy participants in India, Kenya, the Philippines and South Africa: text interfaces (USSD, SMS, forms) were unusable for first-time low-literacy users. A graphical text-free interface reached 100% task completion versus 72% for a spoken dialogue system. A live operator was up to 10 times more accurate than text entry — [Microsoft Research, ToCHI PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf) [Independent, peer-reviewed; pre-2015 but foundational]
- Medhi, Sagar, Toyama (ITID 2007): in Bangalore, graphics plus voice feedback were necessary, consistent help was an overlooked need, and users strongly preferred text-free designs — [EconPapers](https://econpapers.repec.org/RePEc:tpr:itintd:v:4:y:2007:i:1:p:37-50) [Independent]
- Medhi et al. (CHI 2013), 60 participants in India: textual literacy correlates with non-verbal reasoning (Raven's matrices), and both predict how well people navigate hierarchical UIs, including text-free ones. Deep hierarchies are therefore costly even without text — [Microsoft Research](https://www.microsoft.com/en-us/research/?p=287) [Independent]
- Baymard: misspelling tolerance in autocomplete is poor on 69% of sites, and 60% of sites have no synonyms (see section 1) — [Baymard](https://baymard.com/research-articles/ecommerce-search-report-and-benchmark)

### Inferences
- MoloPay should use icon-based, illustrated entry points for the 4 universes and their sub-categories, with shallow navigation of at most 2 levels (per the 2013 finding). Search should tolerate typos, and the synonym dictionary should be bilingual and include local terms (Cameroonian French, Pidgin, brand names used generically, e.g. "frigo", "moto", "congélateur"). Voice search should be an optional extra, not the main path, because of the accent problems.
- An assisted channel (WhatsApp or a partner agent) is backed by the "live operator 10x more accurate" finding.

### Gaps
- I found no measured data on voice search adoption in Cameroon or francophone Africa, or on image search or transliteration in these markets. Statista-type figures are not regional.
- I did not find the primary NBU reports (only the blog post).

## 5. Choice overload, curation and price framing (per-day amounts)

### Takeaway
The "jam study" is real but does not replicate reliably: the 2010 meta-analysis finds an average effect close to zero. The 2015 meta-analysis shows the effect does appear when sets are complex, the task is difficult, preferences are uncertain, or the user wants to minimise effort. Those are exactly the conditions of a first-time, modest-income buyer facing a large-ticket purchase. Per-day price framing raises purchase intent for small daily amounts, but the effect reverses for large amounts.

### Cited Findings
- Iyengar & Lepper (2000, JPSP): a tasting booth with 6 vs 24 jams. About 30% of visitors to the 6-jam display bought, versus 3% at the 24-jam display. These exact figures come from secondary summaries — [Psychology Today](https://www.psychologytoday.com/us/blog/pop-psych/201602/is-choice-overload-real-thing); [BPS Research Digest](https://www.bps.org.uk/research-digest/less-always-more-testing-limits-choice-paradox) [Independent; field study]
- **Replication problem:** Scheibehenne, Greifeneder & Todd (2010, J. Consumer Research), 63 conditions from 50 experiments, N=5,036: mean effect "virtually zero" (D≈0.02) with high variance between studies — [Scheibehenne et al. 2010 PDF](https://abcwest.cogs.indiana.edu/pmwiki/pdf/scheibehenne.options.2010.pdf) [Independent; **flag: the famous effect is not robust on average**]
- Chernev, Böckenholt & Goodman (2015, J. Consumer Psychology 25(2):333–358), 99 observations, N=7,202: once moderators are modelled, the effect is significant. Four moderators: choice-set complexity, decision-task difficulty, preference uncertainty, effort-minimising goal. The model explains 68% of residual variance — [Kellogg](https://www.kellogg.northwestern.edu/faculty/research/detail/2015/when-product-assortment-leads-to-choice-overload-a-conceptual); [Kellogg Insight](https://insight.kellogg.northwestern.edu/article/what-predicts-consumer-choice-overload) [Independent]
- A 2022 working paper argues that the jam benchmark itself is a weak test (preference heterogeneity) — [arXiv 2212.03931](https://arxiv.org/pdf/2212.03931) [Independent, not peer-reviewed]
- Gourville (1998, J. Consumer Research 24(4), DOI 10.1086/209517): temporally reframing a cost into small daily amounts ("pennies-a-day") increases purchase intent through a comparison-retrieval mechanism, where people compare it to small everyday expenses — [IDEAS/RePEc](https://ideas.repec.org/a/oup/jconrs/v24y1998i4p395-408.html) [Independent; laboratory]
- Gourville (2003, Marketing Letters): the effect reverses with the size of the expense. "$1/day" is preferred to "$365/year," but "$4,200/year" is preferred to "$11.50/day" — [Springer](https://link.springer.com/article/10.1023/A:1025467002310) [Independent]
- Hershfield, Shu & Benartzi (2018/2020): daily framing of savings increased sign-ups to a savings programme (paper found but not fetched in detail) — [UCLA Anderson PDF](https://anderson-review.ucla.edu/wp-content/uploads/2021/03/Hershfield_Shu_Benartzi_2018_SSRN-id3097468.pdf) [Independent; check the figures before citing]

### Inferences
- MoloPay does not need to shrink its catalogue. It should **curate the default view** (a short selection per universe, "most reserved," "best value," ready-made comparisons) and let users expand to everything. The Chernev moderators (complexity, uncertainty, effort-minimising) fit first-time buyers of appliances and motorbikes.
- Showing "≈ 500 FCFA/day" fits the savings model well for small to medium amounts (essentials, phones). For housing or a motorbike, a weekly or monthly amount plus the duration may be better received (Gourville 2003 reversal). Both should be A/B tested. Always show the full frozen price next to the per-day amount, for transparency and consumer-protection reasons.

### Gaps
- I did not read the primary Iyengar & Lepper 2000 text. I found no replication of Gourville in Africa or in a mobile-money context.

## 6. Social proof and reviews (Spiegel, authenticity, FTC regulation)

### Takeaway
A few reviews are enough to capture most of the effect: purchase likelihood is +270% with 5 reviews versus 0, and it peaks at an average rating of 4.2–4.5 rather than 5.0. Authenticity is now regulated: in the US, the FTC rule has been in force since October 2024 with civil penalties.

### Cited Findings
- Spiegel Research Center (Northwestern, 2017, with PowerReviews; data from 3 retailers): a product with 5 reviews has a 270% higher purchase likelihood than a product with none. Most of the increase comes within the first 5–10 reviews. Purchase likelihood peaks at an average of 4.2–4.5 stars and falls as it approaches 5.0, because perfect ratings make shoppers suspicious — [Spiegel, How Online Reviews Influence Sales](https://spiegel.medill.northwestern.edu/How-Online-Reviews-Influence-Sales); [Whitepaper PDF](https://spiegel.medill.northwestern.edu/wp-content/uploads/sites/2/2021/04/Online-Reviews-Whitepaper.pdf) [Academic centre, but co-funded with a reviews vendor (PowerReviews); observational data]
- Baymard: 89% of sites do not reply to negative reviews, and 63% do not let users browse reviewer photos — [Baymard](https://baymard.com/research-articles/current-state-ecommerce-product-page-ux)
- FTC final rule on consumer reviews and testimonials (announced 14 Aug 2024, in force 21 Oct 2024). It bans fake reviews (including AI-generated ones), buying positive or negative reviews, undisclosed insider reviews, review suppression through intimidation or unfounded threats, and fake social-media indicators. Civil penalties of up to $51,744 per violation (amount indexed to inflation) apply to violators with actual or implied knowledge — [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials); [Federal Register](https://www.federalregister.gov/documents/2024/08/22/2024-18519/trade-regulation-rule-on-the-use-of-consumer-reviews-and-testimonials) [Regulator]

### Inferences
- At launch, MoloPay should aim to get at least 5 verified reviews per product as a priority, for example by asking at delivery. Reviews should be labelled "achat vérifié / verified purchase," all ratings should be shown including negative ones, and the partner or MoloPay should reply publicly. Do not filter for 5-star ratings only. The FTC rule does not apply in Cameroon, but it is a good international benchmark for review-collection policy.
- For low-literacy users, show star ratings with icons, add reviewer photos, and possibly short voice reviews (not measured, to be tested).

### Gaps
- I did not verify on the primary page the Spiegel figures on the difference between expensive and cheap products. I found no measured data on trust in online reviews in Cameroon or Central Africa.

## 7. Wishlists, favourites and saved items

### Takeaway
The measured evidence is thin. A meaningful minority of users rely on save features (21%, Baymard 2025), sites execute them badly (89%), and the "wishlist" label is misunderstood (NN/g). I found no independent study measuring the causal effect of wishlists on return visits or purchases.

### Cited Findings
- 21% of respondents (n=1,193, 2025) rely on "Save" features, and 89% of sites make them hard to access or use — [Baymard](https://baymard.com/research-articles/current-state-ecommerce-product-page-ux) [UX research firm]
- Users use the cart as external memory for comparing and returning across sessions. Avoid the "Wishlist" label in favour of "Favorites / My List" and do not require a login — [NN/g](https://www.nngroup.com/articles/wishlist-or-cart/) [UX research firm]

### Inferences
- In MoloPay's model, a favourite can become a "goal": "save toward this product" or "notify me if the price changes." This links the favourite to the savings action, but it is not supported by a measured study, so it should be A/B tested.

### Gaps
- I found no independent, quantified study (peer-reviewed or regulator) on how wishlists affect return visits or conversion. Claims like "wishlist users convert X times more" seen elsewhere usually come from vendors and were not verified.
