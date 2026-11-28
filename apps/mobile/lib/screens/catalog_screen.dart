import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/models.dart';
import '../core/offer_search.dart';
import '../core/problem.dart';
import '../l10n/strings.dart';
import '../ui/components.dart';
import '../ui/design.dart';
import 'offer_quote_panel.dart';

class CatalogScreen extends StatefulWidget {
  const CatalogScreen({super.key, required this.state});

  final AppState state;

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  Universe? _selectedUniverse;
  String _search = '';
  bool _loading = true;
  OfferList? _offerList;
  List<PaymentPlan> _plans = const [];
  ApiProblem? _problem;

  @override
  void initState() {
    super.initState();
    widget.state.addListener(_onStateChanged);
    _load();
  }

  @override
  void dispose() {
    widget.state.removeListener(_onStateChanged);
    super.dispose();
  }

  void _onStateChanged() {
    if (mounted) {
      _load();
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _problem = null;
    });
    try {
      final results = await Future.wait<Object>([
        widget.state.api.listOffers(
          universe: _selectedUniverse,
          city: widget.state.selectedCity,
        ),
        widget.state.api.listPlans(),
      ]);
      if (!mounted) return;
      setState(() {
        _offerList = results[0] as OfferList;
        _plans = results[1] as List<PaymentPlan>;
        _loading = false;
      });
    } on ApiProblemException catch (error) {
      if (!mounted) return;
      setState(() {
        _problem = error.problem;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppStrings.of(widget.state.locale);
    final allOffers = _offerList?.offers ?? const <Offer>[];
    final filtered = searchOffersMobile(allOffers, _search);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Flexible(child: Text(s.exploreTitle, style: type(34, weight: FontWeight.w800))),
            MpChoiceChip(
              label: s.isEn ? 'My wishlist (${widget.state.favoriteOfferIds.length})' : 'Mes envies (${widget.state.favoriteOfferIds.length})',
              selected: widget.state.favoriteOfferIds.isNotEmpty,
              onTap: () => showMpBottomSheet<void>(
                context,
                _FavoritesSheet(offers: allOffers, state: widget.state),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text(s.isEn ? 'What’s your next project?' : 'Quel est votre prochain projet ?', style: type(14, color: muted)),
        const SizedBox(height: 18),
        TextField(
          key: const Key('catalog-search-field'),
          decoration: InputDecoration(
            hintText: s.searchHint,
            prefixIcon: const Icon(CupertinoIcons.search, color: muted),
            filled: true,
            fillColor: MpColors.paper,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(20),
              borderSide: const BorderSide(color: MpColors.mist2),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(20),
              borderSide: const BorderSide(color: MpColors.mist2),
            ),
          ),
          onChanged: (value) => setState(() => _search = value),
        ),
        const SizedBox(height: 14),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              _FilterPill(
                label: s.allUniverses,
                selected: _selectedUniverse == null,
                onTap: () {
                  setState(() => _selectedUniverse = null);
                  _load();
                },
              ),
              for (final u in Universe.values)
                _FilterPill(
                  label: s.universeName(u),
                  selected: _selectedUniverse == u,
                  onTap: () {
                    setState(() => _selectedUniverse = u);
                    _load();
                  },
                ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              _FilterPill(
                label: s.allCities,
                selected: widget.state.selectedCity == null,
                onTap: () => widget.state.setCity(null),
              ),
              for (final c in City.values)
                _FilterPill(
                  label: s.cityName(c),
                  selected: widget.state.selectedCity == c,
                  onTap: () => widget.state.setCity(c),
                ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        if (_loading)
          const Center(
            child: Padding(
              padding: EdgeInsets.symmetric(vertical: 36),
              child: CircularProgressIndicator(color: ink),
            ),
          )
        else if (_problem != null)
          ProblemBanner(problem: _problem!, strings: s, onRetry: _load)
        else if (filtered.isEmpty)
          Blank(
            CupertinoIcons.bag,
            s.noOffersTitle,
            s.noOffersDetail,
            actionLabel: s.refresh,
            onAction: _load,
          )
        else ...[
          if (_offerList != null) ...[
            Text(
              s.dataAsOf(_offerList!.asOf),
              style: type(12, color: muted),
            ),
            const SizedBox(height: 12),
          ],
          for (final offer in filtered)
            Tile(
              _iconForUniverse(offer.universe),
              offer.title,
              '${offer.partnerName} · ${offer.priceXaf.format(locale: s.locale)}',
              () => Navigator.of(context).push(
                CupertinoPageRoute<void>(
                  builder: (_) => OfferDetailScreen(
                    offer: offer,
                    plans: _plans,
                    state: widget.state,
                  ),
                ),
              ),
              trailing: MpIconButton(
                icon: CupertinoIcons.heart,
                label: s.isEn ? 'Wishlist ${offer.title}' : 'Envies ${offer.title}',
                active: widget.state.isFavorite(offer.offerId),
                onPressed: () => setState(() => widget.state.toggleFavorite(offer)),
              ),
            ),
        ],
      ],
    );
  }

  IconData _iconForUniverse(Universe u) {
    return switch (u) {
      Universe.essentials => CupertinoIcons.bag,
      Universe.technology => CupertinoIcons.device_laptop,
      Universe.housing => CupertinoIcons.house,
      Universe.mobility => CupertinoIcons.car,
    };
  }
}

class _FilterPill extends StatelessWidget {
  const _FilterPill({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(right: 8),
    child: Press(
      label: label,
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 44),
        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 10),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? ink : MpColors.paper,
          borderRadius: BorderRadius.circular(30),
          border: Border.all(
            color: selected ? ink : MpColors.mist2,
          ),
        ),
        child: Text(
          label,
          style: type(
            12,
            color: selected ? Colors.white : muted,
            weight: FontWeight.w600,
          ),
        ),
      ),
    ),
  );
}

class OfferDetailScreen extends StatelessWidget {
  const OfferDetailScreen({
    super.key,
    required this.offer,
    required this.plans,
    required this.state,
  });

  final Offer offer;
  final List<PaymentPlan> plans;
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final locale = state.locale;
    final s = AppStrings.of(locale);
    final availabilityText = switch (offer.availability) {
      InStockAvailability(:final units) =>
        units > 0 ? s.inStockUnits(units) : s.inStockEmpty,
      PreorderAvailability(:final leadDays) => s.preorderDays(leadDays),
    };
    final compatiblePlans = plans
        .where((p) => p.model != OfferModel.financedPurchase && offer.models.contains(p.model))
        .toList();

    return Scaffold(
      backgroundColor: paper,
      appBar: AppBar(
        backgroundColor: paper,
        elevation: 0,
        foregroundColor: ink,
        title: Text(offer.title, style: type(17, weight: FontWeight.w700)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  s.universeName(offer.universe).toUpperCase(),
                  style: type(11, color: ink, weight: FontWeight.w800),
                ),
                const SizedBox(height: 8),
                Text(offer.title, style: type(30, weight: FontWeight.w800)),
                const SizedBox(height: 16),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: MpColors.mist,
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(s.frozenPriceLabel, style: type(12, color: muted)),
                      const SizedBox(height: 6),
                      Text(
                        offer.priceXaf.format(locale: locale),
                        style: type(28, weight: FontWeight.w800),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                _DetailRow(label: s.partnerLabel, value: offer.partnerName),
                _DetailRow(label: s.availabilityLabel, value: availabilityText),
                _DetailRow(label: s.warrantyLabel, value: offer.warranty),
                _DetailRow(label: s.termsLabel, value: offer.discountTerms),
                _DetailRow(
                  label: s.allCities,
                  value: offer.cities.map(s.cityName).join(', '),
                ),
                const SizedBox(height: 18),
                if (offer.models.contains(OfferModel.financedPurchase)) ...[
                  Text(s.modelBNotice, style: type(12, color: muted)),
                  const SizedBox(height: 12),
                ],
                Text(s.plansLabel, style: type(18, weight: FontWeight.w700)),
                const SizedBox(height: 10),
                OfferQuotePanel(
                  offer: offer,
                  plans: compatiblePlans,
                  state: state,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: MpColors.paper,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: MpColors.mist2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: type(12, color: muted, weight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text(value, style: type(15, weight: FontWeight.w600)),
        ],
      ),
    ),
  );
}

class _FavoritesSheet extends StatelessWidget {
  const _FavoritesSheet({required this.offers, required this.state});
  final List<Offer> offers;
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final isEn = state.locale == 'en';
    final saved = offers.where((o) => state.isFavorite(o.offerId)).toList();
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(isEn ? 'My wishlist' : 'Mes envies', style: type(20, display: true, weight: FontWeight.w600)),
        const SizedBox(height: 6),
        Text(
          isEn ? 'A wishlist price can change. It is locked only when you reserve.' : 'Le prix d’un favori peut changer. Il est figé seulement quand vous réservez.',
          style: type(12, color: muted),
        ),
        const SizedBox(height: 12),
        if (saved.isEmpty)
          Text(isEn ? 'No saved offers yet.' : 'Aucune envie enregistrée.', style: type(14, color: muted))
        else
          for (final offer in saved) ...[
            Builder(builder: (_) {
              final d = state.favoritePriceDelta(offer);
              return ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(offer.title, style: type(15, weight: FontWeight.w600)),
                subtitle: Text(
                  d == null ? offer.priceXaf.format() : (d.isDown ? 'Baisse de ${d.amount.format()}' : 'Hausse de ${d.amount.format()}'),
                  style: type(13, color: muted, tabular: true),
                ),
              );
            }),
          ],
      ],
    );
  }
}
