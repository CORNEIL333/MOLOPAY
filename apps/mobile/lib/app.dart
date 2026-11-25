import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

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

  @override
  void initState() {
    super.initState();
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
    );
  }

  @override
  void dispose() {
    _state.dispose();
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
        return MaterialApp(
          title: s.appTitle,
          debugShowCheckedModeBanner: false,
          theme: ThemeData(
            useMaterial3: true,
            scaffoldBackgroundColor: paper,
            colorScheme: ColorScheme.fromSeed(
              seedColor: orange,
              primary: orange,
              surface: paper,
            ),
            textTheme: const TextTheme(bodyMedium: TextStyle(color: ink)),
            splashFactory: NoSplash.splashFactory,
          ),
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              disableAnimations:
                  _state.reduceMotion ||
                  MediaQuery.disableAnimationsOf(context),
            ),
            child: child!,
          ),
          home: _state.upgradeRequired
              ? UpgradeRequiredScreen(strings: s)
              : _MainShell(state: _state),
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
                indicatorColor: const Color(0xFFFFE9D8),
                leading: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Text(
                    'molopay',
                    style: type(20, weight: FontWeight.w800),
                  ),
                ),
                destinations: [
                  for (final item in items)
                    NavigationRailDestination(
                      icon: Icon(item.$2, color: muted),
                      selectedIcon: Icon(item.$2, color: orange),
                      label: Text(item.$1),
                    ),
                ],
              ),
              const VerticalDivider(width: 1, color: Color(0xFFF1E7DD)),
              Expanded(child: content),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      body: Stack(
        children: [
          Positioned(
            top: -110,
            right: -100,
            child: IgnorePointer(
              child: Container(
                width: 340,
                height: 340,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: RadialGradient(
                    colors: [
                      peach.withValues(alpha: 0.72),
                      paper.withValues(alpha: 0),
                    ],
                  ),
                ),
              ),
            ),
          ),
          SafeArea(
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(22, 10, 22, 8),
                  child: Row(
                    children: [
                      const Text(
                        'molopay',
                        style: TextStyle(
                          fontSize: 25,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -1.1,
                          color: ink,
                        ),
                      ),
                      const Spacer(),
                      if (widget.state.isAuthenticated)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: const Color(0xFFF1E7DD)),
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
                child: Glass(
                  padding: const EdgeInsets.all(8),
                  child: Row(
                    children: [
                      for (var i = 0; i < items.length; i++)
                        Expanded(
                          child: Press(
                            label: items[i].$1,
                            onTap: () => setState(() => _tabIndex = i),
                            child: AnimatedContainer(
                              duration: MediaQuery.disableAnimationsOf(context)
                                  ? Duration.zero
                                  : const Duration(milliseconds: 200),
                              padding: const EdgeInsets.symmetric(vertical: 10),
                              decoration: BoxDecoration(
                                color: _tabIndex == i
                                    ? const Color(0xFFFFE9D8)
                                    : Colors.transparent,
                                borderRadius: BorderRadius.circular(22),
                              ),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    items[i].$2,
                                    color: _tabIndex == i ? orange : muted,
                                    size: 22,
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    items[i].$1,
                                    style: type(
                                      10,
                                      color: _tabIndex == i ? ink : muted,
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
