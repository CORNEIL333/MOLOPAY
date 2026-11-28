import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import 'core/api_client.dart';
import 'core/app_state.dart';
import 'core/device_key.dart';
import 'l10n/strings.dart';
import 'screens/catalog_screen.dart';
import 'screens/goals_screen.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/upgrade_required_screen.dart';
import 'ui/design.dart';
import 'ui/theme.dart';

/// Paramètre de marque séparé de l'anneau (H8 : nom commercial provisoire).
const String kBrandWordmark = 'molopay';

class MoloPayApp extends StatefulWidget {
  const MoloPayApp({
    super.key,
    this.apiClient,
    this.deviceKeys,
    this.initialLocale = 'fr',
  });

  final MoloPayApiClient? apiClient;

  /// Clé d'appareil de la plateforme (D71) ; aucune tant que D90 n'est pas tranchée.
  final DeviceKeyProvider? deviceKeys;
  final String initialLocale;

  @override
  State<MoloPayApp> createState() => _MoloPayAppState();
}

class _MoloPayAppState extends State<MoloPayApp> {
  late final MoloPayApiClient _client;
  late final bool _ownsClient;
  late final AppState _state;
  final MpVisualEffectsController _effects = MpVisualEffectsController();

  void _onTimings(List<FrameTiming> timings) => _effects.recordFrameTimings(timings);
  void _syncEffects() {
    _effects.setReduceMotion(_state.reduceMotion);
    _effects.setSoberEffects(_state.soberEffects);
  }

  @override
  void initState() {
    super.initState();
    registerMolopayFontLicenses();
    _ownsClient = widget.apiClient == null;
    _client =
        widget.apiClient ??
        MoloPayApiClient(
          baseUrl: MoloPayApiClient.defaultBaseUrl,
          origin: MoloPayApiClient.defaultOrigin,
        );
    _state = AppState(
      api: _client,
      deviceKeys: widget.deviceKeys,
      initialLocale: widget.initialLocale,
    )..addListener(_syncEffects);
    SchedulerBinding.instance.addTimingsCallback(_onTimings);
  }

  @override
  void dispose() {
    SchedulerBinding.instance.removeTimingsCallback(_onTimings);
    _state.removeListener(_syncEffects);
    _state.dispose();
    _effects.dispose();
    if (_ownsClient) {
      _client.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _state,
      builder: (context, _) {
        final s = AppStrings.of(_state.locale);
        return MpVisualEffectsScope(
          controller: _effects,
          child: MaterialApp(
            title: s.appTitle,
            debugShowCheckedModeBanner: false,
            theme: buildMolopayTheme(brightness: Brightness.light),
            darkTheme: buildMolopayTheme(brightness: Brightness.dark),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                disableAnimations:
                    _state.reduceMotion ||
                    MediaQuery.disableAnimationsOf(context),
              ),
              child: MpScreenGlassScope(child: child!),
            ),
            home: _state.upgradeRequired
                ? UpgradeRequiredScreen(strings: s)
                : _MainShell(state: _state),
          ),
        );
      },
    );
  }
}

class _MainShell extends StatefulWidget {
  const _MainShell({required this.state});

  final AppState state;

  @override
  State<_MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<_MainShell> {
  int _tabIndex = 0;

  void _openLogin() {
    Navigator.of(context).push<bool>(
      CupertinoPageRoute<bool>(
        builder: (_) => LoginScreen(state: widget.state),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = AppStrings.of(widget.state.locale);
    final isDesktop = MediaQuery.sizeOf(context).width >= 840;
    final items = <(String, IconData)>[
      (s.navHome, CupertinoIcons.house),
      (s.navExplore, CupertinoIcons.compass),
      (s.navProjects, CupertinoIcons.square_stack_3d_up),
      (s.navProfile, CupertinoIcons.person_crop_circle),
    ];

    final content = SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(24, 12, 24, isDesktop ? 40 : 124),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 640),
          child: switch (_tabIndex) {
            0 => HomeScreen(
              state: widget.state,
              onNavigateTab: (index) => setState(() => _tabIndex = index),
              onOpenLogin: _openLogin,
            ),
            1 => CatalogScreen(state: widget.state),
            2 => GoalsScreen(state: widget.state, onOpenLogin: _openLogin),
            _ => ProfileScreen(state: widget.state, onOpenLogin: _openLogin),
          },
        ),
      ),
    );

    if (isDesktop) {
      return Scaffold(
        body: SafeArea(
          child: Row(
            children: [
              NavigationRail(
                backgroundColor: paper,
                selectedIndex: _tabIndex,
                onDestinationSelected: (i) => setState(() => _tabIndex = i),
                labelType: NavigationRailLabelType.all,
                indicatorColor: MpColors.mist2,
                leading: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Text(
                    kBrandWordmark,
                    style: type(20, weight: FontWeight.w600, display: true),
                  ),
                ),
                destinations: [
                  for (final item in items)
                    NavigationRailDestination(
                      icon: Icon(item.$2, color: muted),
                      selectedIcon: Icon(item.$2, color: ink),
                      label: Text(item.$1),
                    ),
                ],
              ),
              const VerticalDivider(width: 1, color: MpColors.mist2),
              Expanded(child: content),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(
            child: LiquidBackground(
              universe: MpLiquidUniverse.home,
              frozen: _tabIndex == 3,
            ),
          ),
          SafeArea(
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(22, 10, 22, 8),
                  child: Row(
                    children: [
                      Text(
                        kBrandWordmark,
                        style: type(24, weight: FontWeight.w600, display: true),
                      ),
                      const Spacer(),
                      if (widget.state.isAuthenticated)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: MpColors.paper,
                            borderRadius: BorderRadius.circular(MpRadius.md),
                            border: Border.all(color: MpColors.mist2),
                          ),
                          child: Text(
                            widget.state.session!.displayName ??
                                AppStrings.of(widget.state.locale).signedIn,
                            style: type(12, weight: FontWeight.w600),
                          ),
                        ),
                    ],
                  ),
                ),
                Expanded(child: content),
              ],
            ),
          ),
          Positioned(
            left: 20,
            right: 20,
            bottom: 16 + MediaQuery.paddingOf(context).bottom,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
                child: GlassSurface(
                  tone: MpGlassTone.dark,
                  borderRadius: MpRadius.pill,
                  padding: const EdgeInsets.all(6),
                  child: Row(
                    children: [
                      for (var i = 0; i < items.length; i++)
                        Expanded(
                          child: Press(
                            label: items[i].$1,
                            onTap: () => setState(() => _tabIndex = i),
                            child: AnimatedContainer(
                              duration: MpMotionConfig.reduced(context)
                                  ? Duration.zero
                                  : MpMotion.base,
                              curve: MpMotion.standardCurve,
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              decoration: BoxDecoration(
                                color: _tabIndex == i
                                    ? MpColors.paper
                                    : Colors.transparent,
                                borderRadius: BorderRadius.circular(MpRadius.pill),
                              ),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    items[i].$2,
                                    color: _tabIndex == i
                                        ? MpColors.ink
                                        : MpColors.mutedDark,
                                    size: 20,
                                  ),
                                  const SizedBox(height: 3),
                                  Text(
                                    items[i].$1,
                                    style: type(
                                      10,
                                      color: _tabIndex == i
                                          ? MpColors.ink
                                          : MpColors.mutedDark,
                                      weight: _tabIndex == i
                                          ? FontWeight.w700
                                          : FontWeight.w500,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
