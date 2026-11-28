import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/models.dart';
import '../l10n/strings.dart';
import '../ui/design.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({
    super.key,
    required this.state,
    required this.onNavigateTab,
    required this.onOpenLogin,
  });

  final AppState state;
  final ValueChanged<int> onNavigateTab;
  final VoidCallback onOpenLogin;

  @override
  Widget build(BuildContext context) {
    final s = AppStrings.of(state.locale);
    final cityLabel = state.selectedCity == null
        ? s.allCities
        : s.cityName(state.selectedCity!);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 14,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(
              s.homeEyebrow,
              style: type(11, color: muted, weight: FontWeight.w800),
            ),
            Press(
              label: cityLabel,
              onTap: () => _openCitySheet(context, s),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: MpColors.paper,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: MpColors.mist2),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      CupertinoIcons.location_solid,
                      size: 13,
                      color: ink,
                    ),
                    const SizedBox(width: 5),
                    Text(cityLabel, style: type(12, weight: FontWeight.w600)),
                    const SizedBox(width: 4),
                    const Icon(CupertinoIcons.chevron_down, size: 12),
                  ],
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        Text(s.homeHeadline, style: type(38, weight: FontWeight.w800)),
        const SizedBox(height: 10),
        Text(s.homeSubtitle, style: type(15, color: muted)),
        const SizedBox(height: 22),
        Press(
          label: s.exploreTitle,
          onTap: () => onNavigateTab(1),
          child: Container(
            decoration: BoxDecoration(
              color: MpColors.universeEssentials,
              borderRadius: BorderRadius.circular(32),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const HeroArt(height: 196),
                Padding(
                  padding: const EdgeInsets.fromLTRB(22, 14, 22, 22),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              s.homeHeroTitle,
                              style: type(23, weight: FontWeight.w700),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              s.homeHeroCaption,
                              style: type(13, color: muted),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      Container(
                        width: 44,
                        height: 44,
                        decoration: const BoxDecoration(
                          color: ink,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          CupertinoIcons.arrow_up_right,
                          color: Colors.white,
                          size: 20,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 22),
        Tile(
          CupertinoIcons.compass,
          s.exploreTitle,
          s.exploreCaption,
          () => onNavigateTab(1),
        ),
        if (state.isAuthenticated)
          Tile(
            CupertinoIcons.square_stack_3d_up,
            s.goalsTitle,
            s.goalsCaption,
            () => onNavigateTab(2),
          )
        else
          Tile(
            CupertinoIcons.person_crop_circle,
            s.loginTitle,
            s.loginRequiredDetail,
            onOpenLogin,
          ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(22),
            color: MpColors.mist,
          ),
          child: Row(
            children: [
              const Icon(CupertinoIcons.lock_shield, color: muted, size: 22),
              const SizedBox(width: 12),
              Expanded(
                child: Text(s.custodyNotice, style: type(12, color: muted)),
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _openCitySheet(BuildContext context, AppStrings s) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: paper,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(s.allCities, style: type(20, weight: FontWeight.w700)),
              const SizedBox(height: 12),
              Tile(CupertinoIcons.globe, s.allCities, '', () {
                state.setCity(null);
                Navigator.pop(ctx);
              }),
              for (final city in City.values)
                Tile(CupertinoIcons.location, s.cityName(city), '', () {
                  state.setCity(city);
                  Navigator.pop(ctx);
                }),
            ],
          ),
        ),
      ),
    );
  }
}
