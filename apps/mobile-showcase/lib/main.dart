import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'design.dart';
import 'screens.dart';

final reduceMotion = ValueNotifier(false);

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      systemNavigationBarColor: paper,
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
  );
  runApp(const MolopayShowcase());
}

class MolopayShowcase extends StatelessWidget {
  const MolopayShowcase({super.key, this.initialPage = 'splash'});
  final String initialPage;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Molopay · Maquette',
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
    builder: (context, child) => ValueListenableBuilder<bool>(
      valueListenable: reduceMotion,
      builder: (context, value, _) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          disableAnimations: value || MediaQuery.disableAnimationsOf(context),
        ),
        child: child!,
      ),
    ),
    home: ShowcasePage(id: initialPage),
    onGenerateRoute: (settings) => CupertinoPageRoute<void>(
      settings: settings,
      builder: (_) => ShowcasePage(id: settings.name ?? 'home'),
    ),
  );
}

void go(BuildContext context, String id) {
  if (id == 'exit') {
    showCupertinoDialog<void>(
      context: context,
      builder: (ctx) => CupertinoAlertDialog(
        title: const Text('Fermer la maquette ?'),
        content: const Text(
          'Vous pourrez la retrouver en ouvrant à nouveau Molopay.',
        ),
        actions: [
          CupertinoDialogAction(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Rester'),
          ),
          CupertinoDialogAction(
            isDestructiveAction: true,
            onPressed: () => SystemNavigator.pop(),
            child: const Text('Fermer'),
          ),
        ],
      ),
    );
  } else if ([
    'home',
    'explore',
    'projects',
    'profile',
    'welcome',
  ].contains(id)) {
    Navigator.of(context).pushNamedAndRemoveUntil(id, (_) => false);
  } else {
    Navigator.of(context).pushNamed(id);
  }
}

void sheet(BuildContext context, String title, Widget child) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    sheetAnimationStyle: MediaQuery.disableAnimationsOf(context)
        ? AnimationStyle.noAnimation
        : null,
    builder: (ctx) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: .7,
      minChildSize: .4,
      maxChildSize: .94,
      builder: (_, controller) => Container(
        decoration: const BoxDecoration(
          color: paper,
          borderRadius: BorderRadius.vertical(top: Radius.circular(36)),
        ),
        child: ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 36),
          children: [
            Center(
              child: Container(
                width: 38,
                height: 5,
                decoration: BoxDecoration(
                  color: muted.withValues(alpha: .3),
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
            const SizedBox(height: 22),
            Row(
              children: [
                Expanded(
                  child: Text(title, style: type(27, weight: FontWeight.w700)),
                ),
                IconButton(
                  tooltip: 'Fermer le panneau',
                  onPressed: () => Navigator.pop(ctx),
                  icon: const Icon(
                    CupertinoIcons.xmark_circle_fill,
                    color: muted,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            child,
          ],
        ),
      ),
    ),
  );
}

class ShowcasePage extends StatefulWidget {
  const ShowcasePage({super.key, required this.id});
  final String id;
  @override
  State<ShowcasePage> createState() => _ShowcasePageState();
}

class _ShowcasePageState extends State<ShowcasePage> {
  int intro = 0;
  bool reminders = true;
  String city = 'Toutes les villes';
  bool get isTab =>
      ['home', 'explore', 'projects', 'profile'].contains(widget.id);
  void open(String id) => go(context, id);
  @override
  Widget build(BuildContext context) {
    if (widget.id == 'splash') return _splash();
    if (widget.id == 'welcome') return _welcome();
    final spec = screens[widget.id];
    return Scaffold(
      body: Stack(
        children: [
          Positioned(
            top: -110,
            right: -100,
            child: Container(
              width: 380,
              height: 380,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    peach.withValues(alpha: .75),
                    paper.withValues(alpha: 0),
                  ],
                ),
              ),
            ),
          ),
          SafeArea(
            child: Column(
              children: [
                _header(),
                Expanded(
                  child: SingleChildScrollView(
                    padding: EdgeInsets.fromLTRB(24, 8, 24, isTab ? 135 : 40),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 560),
                        child: Enter(
                          key: ValueKey(widget.id),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (widget.id == 'home')
                                ..._home()
                              else if (widget.id == 'index')
                                ..._index()
                              else if (spec != null) ...[
                                Text(
                                  _eyebrow(),
                                  style: type(
                                    10,
                                    color: orange,
                                    weight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 13),
                                Text(
                                  spec.title,
                                  style: type(38, weight: FontWeight.w800),
                                ),
                                const SizedBox(height: 14),
                                Text(
                                  spec.caption,
                                  style: type(15, color: muted),
                                ),
                                const SizedBox(height: 27),
                                ..._body(spec),
                              ],
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (isTab)
            Positioned(
              left: 20,
              right: 20,
              bottom: 18 + MediaQuery.paddingOf(context).bottom,
              child: _dock(),
            ),
          if (widget.id == 'home' || widget.id == 'projects')
            Positioned(
              right: 25,
              bottom: 110 + MediaQuery.paddingOf(context).bottom,
              child: Press(
                label: 'Créer un projet',
                onTap: _newProjectSheet,
                child: Container(
                  width: 58,
                  height: 58,
                  decoration: BoxDecoration(
                    color: orange,
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: orange.withValues(alpha: .25),
                        blurRadius: 22,
                        offset: const Offset(0, 8),
                      ),
                    ],
                  ),
                  child: const Icon(
                    CupertinoIcons.plus,
                    color: Colors.white,
                    size: 28,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  String _eyebrow() {
    if ([
      'phone',
      'otp',
      'signup',
      'pin',
      'login',
      'biometrics',
      'recovery',
    ].contains(widget.id)) {
      return 'VOTRE PREMIER PAS';
    }
    if ([
      'payment',
      'payment-review',
      'contributions',
      'receipt',
    ].contains(widget.id)) {
      return 'CHAQUE PAS COMPTE';
    }
    return 'À VOTRE RYTHME';
  }

  Widget _header() => Padding(
    padding: const EdgeInsets.fromLTRB(18, 10, 18, 16),
    child: Row(
      children: [
        if (!isTab)
          SizedBox(
            width: 44,
            height: 44,
            child: IconButton(
              tooltip: 'Retour',
              onPressed: () => Navigator.canPop(context)
                  ? Navigator.pop(context)
                  : open('welcome'),
              icon: const Icon(
                CupertinoIcons.chevron_left,
                size: 21,
                color: ink,
              ),
            ),
          )
        else
          const Flexible(
            child: Padding(
              padding: EdgeInsets.only(left: 6),
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  'molopay',
                  style: TextStyle(
                    fontSize: 26,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -1.2,
                    color: ink,
                  ),
                ),
              ),
            ),
          ),
        const Spacer(),
        Press(
          label: 'Plan de la maquette',
          onTap: () => open('index'),
          child: Container(
            constraints: const BoxConstraints(minHeight: 44),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .8),
              borderRadius: BorderRadius.circular(30),
              border: Border.all(color: const Color(0xFFF1E7DD)),
            ),
            child: Row(
              children: [
                Container(
                  width: 5,
                  height: 5,
                  decoration: const BoxDecoration(
                    color: orange,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  'MAQUETTE',
                  style: type(9, color: muted, weight: FontWeight.w800),
                ),
              ],
            ),
          ),
        ),
        if (isTab) ...[
          const SizedBox(width: 8),
          SizedBox(
            width: 44,
            height: 44,
            child: IconButton(
              tooltip: 'Notifications',
              onPressed: () => open('notifications'),
              icon: const Icon(CupertinoIcons.bell, color: ink, size: 22),
            ),
          ),
        ],
      ],
    ),
  );

  Widget _dock() => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 480),
      child: Glass(
        padding: const EdgeInsets.all(8),
        child: Row(
          children: [
            for (final item in <(String, String, IconData)>[
              ('home', 'Accueil', CupertinoIcons.house),
              ('explore', 'Explorer', CupertinoIcons.compass),
              ('projects', 'Projets', CupertinoIcons.square_stack_3d_up),
              ('profile', 'Profil', CupertinoIcons.person_crop_circle),
            ])
              Expanded(
                child: Press(
                  onTap: () {
                    if (widget.id != item.$1) open(item.$1);
                  },
                  child: AnimatedContainer(
                    duration: MediaQuery.disableAnimationsOf(context)
                        ? Duration.zero
                        : const Duration(milliseconds: 230),
                    padding: const EdgeInsets.symmetric(vertical: 11),
                    decoration: BoxDecoration(
                      color: widget.id == item.$1
                          ? const Color(0xFFFFE9D8)
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(22),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          item.$3,
                          color: widget.id == item.$1 ? orange : muted,
                          size: 22,
                        ),
                        const SizedBox(height: 5),
                        Text(
                          item.$2,
                          style: type(
                            10,
                            color: widget.id == item.$1 ? ink : muted,
                            weight: widget.id == item.$1
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
  );

  List<Widget> _home() => [
    Wrap(
      spacing: 14,
      runSpacing: 10,
      children: [
        Text(
          'UN NOUVEL HORIZON',
          style: type(10, color: muted, weight: FontWeight.w800),
        ),
        Press(
          onTap: _citySheet,
          child: Row(
            children: [
              const Icon(
                CupertinoIcons.location_solid,
                size: 12,
                color: orange,
              ),
              const SizedBox(width: 4),
              Text(city, style: type(11)),
              const Icon(CupertinoIcons.chevron_down, size: 12),
            ],
          ),
        ),
      ],
    ),
    const SizedBox(height: 16),
    Text(
      'Vos envies.\nVotre rythme.',
      style: type(43, weight: FontWeight.w800),
    ),
    const SizedBox(height: 14),
    Text(
      'L’avenir se prépare, un pas à la fois.',
      style: type(15, color: muted),
    ),
    const SizedBox(height: 24),
    Press(
      onTap: () => open('new-project'),
      child: Container(
        decoration: BoxDecoration(
          color: const Color(0xFFFFEDD9),
          borderRadius: BorderRadius.circular(34),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const HeroArt(height: 210),
            Padding(
              padding: const EdgeInsets.fromLTRB(22, 6, 22, 22),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Les grands projets\ncommencent petit.',
                          style: type(24, weight: FontWeight.w700),
                        ),
                        const SizedBox(height: 9),
                        Text(
                          'Et si on préparait le vôtre ?',
                          style: type(13, color: muted),
                        ),
                      ],
                    ),
                  ),
                  Container(
                    width: 44,
                    height: 44,
                    decoration: const BoxDecoration(
                      color: orange,
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
    const SizedBox(height: 27),
    _section('À portée de main', 'Tout voir', 'index'),
    const SizedBox(height: 15),
    Row(
      children: [
        Expanded(
          child: _shortcut(
            CupertinoIcons.plus_circle,
            'Mon projet',
            'new-project',
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _shortcut(CupertinoIcons.globe, 'Un proche', 'diaspora'),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _shortcut(
            CupertinoIcons.chat_bubble_2,
            'De l’aide',
            'support',
          ),
        ),
      ],
    ),
    const SizedBox(height: 26),
    _section('Votre prochain chapitre', 'Projets', 'projects'),
    const SizedBox(height: 15),
    Tile(
      CupertinoIcons.flag,
      'Votre premier projet vous attend',
      'Aucun projet ouvert pour le moment',
      () => open('new-project'),
    ),
    const SizedBox(height: 14),
    Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(23),
        color: const Color(0xFFF3EEE6),
      ),
      child: Row(
        children: [
          const Icon(CupertinoIcons.lock_shield, color: muted, size: 23),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'Vos fonds seront détenus par un établissement agréé.',
              style: type(12, color: muted),
            ),
          ),
        ],
      ),
    ),
  ];

  Widget _section(String title, String link, String id) => Row(
    children: [
      Expanded(
        child: Text(title, style: type(19, weight: FontWeight.w700)),
      ),
      TextButton(
        onPressed: () => open(id),
        child: Text(
          link,
          style: type(12, color: orange, weight: FontWeight.w700),
        ),
      ),
    ],
  );
  Widget _shortcut(IconData icon, String text, String id) => Press(
    onTap: () => open(id),
    child: Container(
      padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 5),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFF0E7DD)),
      ),
      child: Column(
        children: [
          Icon(icon, color: orange, size: 25),
          const SizedBox(height: 12),
          Text(text, style: type(12, weight: FontWeight.w600)),
        ],
      ),
    ),
  );

  List<Widget> _body(Screen spec) {
    final list = <Widget>[];
    if (['biometrics', 'save', 'expense', 'finance'].contains(widget.id)) {
      list.addAll([_symbol(spec.icon), const SizedBox(height: 24)]);
    }
    if (widget.id == 'explore') list.addAll(_explore());
    if (widget.id == 'profile') list.addAll(_profile());
    if (widget.id == 'preferences') list.addAll(_preferences());
    if (widget.id == 'faq') list.addAll(_faq());
    for (final field in spec.fields) {
      list.add(PreviewField(field.$1, field.$2));
    }
    if (spec.empty != null) {
      list.addAll([
        Blank(spec.icon, spec.empty!, 'Cet espace est vide dans la maquette.'),
        const SizedBox(height: 22),
      ]);
    }
    for (final link in spec.links) {
      list.add(Tile(link.$3, link.$1, '', () => open(link.$2)));
    }
    if (spec.cta != null) {
      list.addAll([
        const SizedBox(height: 18),
        Primary(spec.cta!, () => open(spec.next!)),
      ]);
    }
    if (!isTab) {
      list.addAll([
        const SizedBox(height: 26),
        Text(
          'Présentation uniquement · aucune action réelle',
          textAlign: TextAlign.center,
          style: type(11, color: muted),
        ),
      ]);
    }
    return list;
  }

  Widget _symbol(IconData icon) => Center(
    child: Container(
      width: 142,
      height: 142,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Colors.white, peach],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(48),
        boxShadow: [
          BoxShadow(
            color: orange.withValues(alpha: .08),
            blurRadius: 32,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      child: Icon(icon, size: 62, color: orange),
    ),
  );

  List<Widget> _explore() => [
    Press(
      onTap: () => sheet(
        context,
        'Rechercher',
        Column(
          children: [
            const PreviewField(
              'Article ou univers',
              'Recherche non connectée',
              icon: CupertinoIcons.search,
            ),
            Tile(
              CupertinoIcons.square_grid_2x2,
              'Voir les univers',
              'Aucune offre chargée',
              () {
                Navigator.pop(context);
              },
            ),
          ],
        ),
      ),
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: const Color(0xFFEFE6DC)),
        ),
        child: Row(
          children: [
            const Icon(CupertinoIcons.search, color: muted, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'Qu’aimeriez-vous préparer ?',
                style: type(14, color: muted),
              ),
            ),
            const Icon(
              CupertinoIcons.slider_horizontal_3,
              color: orange,
              size: 20,
            ),
          ],
        ),
      ),
    ),
    const SizedBox(height: 18),
    Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final text in ['Tous les univers', 'Yaoundé', 'Douala'])
          Press(
            onTap: _citySheet,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 11),
              decoration: BoxDecoration(
                color: text == 'Tous les univers' ? ink : Colors.white,
                borderRadius: BorderRadius.circular(30),
              ),
              child: Text(
                text,
                style: type(
                  11,
                  color: text == 'Tous les univers' ? Colors.white : muted,
                ),
              ),
            ),
          ),
      ],
    ),
    const SizedBox(height: 24),
    for (final item in <(String, String, IconData)>[
      ('Essentiels', 'Le quotidien, en mieux.', CupertinoIcons.bag),
      (
        'Technologie',
        'Restez dans le mouvement.',
        CupertinoIcons.device_laptop,
      ),
      ('Logement', 'Faites place à vos envies.', CupertinoIcons.house),
      ('Mobilité', 'De nouveaux horizons.', CupertinoIcons.car),
    ])
      Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Press(
          onTap: () => open('category'),
          child: Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFFFFE5CD), Color(0xFFFFF5EB)],
              ),
              borderRadius: BorderRadius.circular(30),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(item.$1, style: type(26, weight: FontWeight.w700)),
                      const SizedBox(height: 8),
                      Text(item.$2, style: type(12, color: muted)),
                      const SizedBox(height: 18),
                      const Icon(
                        CupertinoIcons.arrow_up_right,
                        size: 20,
                        color: orange,
                      ),
                    ],
                  ),
                ),
                Icon(item.$3, color: orange.withValues(alpha: .8), size: 66),
              ],
            ),
          ),
        ),
      ),
  ];

  List<Widget> _profile() => [
    Glass(
      child: Row(
        children: [
          Container(
            width: 62,
            height: 62,
            decoration: const BoxDecoration(
              color: peach,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              CupertinoIcons.person_fill,
              color: orange,
              size: 28,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Bienvenue chez vous',
                  style: type(18, weight: FontWeight.w700),
                ),
                const SizedBox(height: 5),
                Text('Aucun compte connecté', style: type(12, color: muted)),
              ],
            ),
          ),
        ],
      ),
    ),
    const SizedBox(height: 24),
    for (final item in <(String, String, IconData)>[
      ('Mes informations', 'personal', CupertinoIcons.person),
      ('Vérification d’identité', 'identity', CupertinoIcons.checkmark_shield),
      ('Sécurité et accès', 'security', CupertinoIcons.lock_shield),
      ('Préférences', 'preferences', CupertinoIcons.slider_horizontal_3),
      ('Activité et reçus', 'activity', CupertinoIcons.clock),
      ('Aide et réclamations', 'support', CupertinoIcons.chat_bubble_2),
      ('Confidentialité', 'privacy', CupertinoIcons.hand_raised),
      ('À propos', 'about', CupertinoIcons.info_circle),
    ])
      Tile(item.$3, item.$1, '', () => open(item.$2)),
    const SizedBox(height: 12),
    Primary('Découvrir la déconnexion', () => _logoutSheet(), dark: true),
  ];

  List<Widget> _preferences() => [
    Tile(
      CupertinoIcons.globe,
      'Langue',
      'Présentation en français',
      () => sheet(
        context,
        'Langue de présentation',
        const Blank(
          CupertinoIcons.globe,
          'Version française',
          'Les parcours anglais restent à préparer pour la présentation.',
        ),
      ),
    ),
    Tile(CupertinoIcons.location, 'Ville', city, _citySheet),
    Tile(
      CupertinoIcons.bell,
      'Aperçu des rappels',
      'Réglage visuel, non enregistré',
      () => setState(() => reminders = !reminders),
      trailing: CupertinoSwitch(
        value: reminders,
        activeTrackColor: orange,
        onChanged: (v) => setState(() => reminders = v),
      ),
    ),
    Tile(
      CupertinoIcons.wind,
      'Réduire les animations',
      'Respecte aussi le réglage système',
      () => setState(() {
        reduceMotion.value = !reduceMotion.value;
      }),
      trailing: CupertinoSwitch(
        value: reduceMotion.value,
        activeTrackColor: orange,
        onChanged: (v) {
          setState(() {
            reduceMotion.value = v;
          });
        },
      ),
    ),
    const SizedBox(height: 16),
    const Blank(
      CupertinoIcons.paintbrush,
      'Orange ciel. Blanc ciel.',
      'Une palette chaude et lumineuse, sans bleu.',
    ),
  ];

  List<Widget> _faq() => [
    for (final item in <(String, String)>[
      (
        'Comment fonctionne l’achat planifié ?',
        'Vous préparez votre achat progressivement. Pour le modèle A, la remise intervient une fois l’objectif atteint.',
      ),
      (
        'Qui détient les fonds ?',
        'Un établissement agréé détient les fonds clients. Molopay tient le registre des opérations.',
      ),
      (
        'Qui accorde le crédit ?',
        'Pour le modèle B, seul un financeur agréé octroie le crédit. La plateforme ne prend pas cette décision.',
      ),
      (
        'Peut-on utiliser cette maquette pour payer ?',
        'Non. Cette application présente uniquement la navigation et les écrans. Aucune opération n’est exécutée.',
      ),
    ])
      Tile(
        CupertinoIcons.question_circle,
        item.$1,
        'Toucher pour lire',
        () => sheet(context, item.$1, Text(item.$2, style: type(17))),
      ),
  ];

  void _citySheet() => sheet(
    context,
    'Votre ville',
    Column(
      children: [
        for (final value in ['Toutes les villes', 'Yaoundé', 'Douala'])
          Tile(
            CupertinoIcons.location,
            value,
            'Filtre de présentation uniquement',
            () {
              setState(() => city = value);
              Navigator.pop(context);
            },
          ),
      ],
    ),
  );
  void _newProjectSheet() => sheet(
    context,
    'Une envie en tête ?',
    Column(
      children: [
        Text('Choisissez un point de départ.', style: type(15, color: muted)),
        const SizedBox(height: 22),
        for (final item in <(String, String, IconData)>[
          ('Épargner pour acheter', 'save', CupertinoIcons.bag),
          ('Préparer une dépense', 'expense', CupertinoIcons.house),
          (
            'Découvrir le financement',
            'finance',
            CupertinoIcons.building_2_fill,
          ),
        ])
          Tile(item.$3, item.$1, 'Découvrir le parcours', () {
            Navigator.pop(context);
            open(item.$2);
          }),
      ],
    ),
  );
  void _logoutSheet() => sheet(
    context,
    'On se retrouve bientôt ?',
    Column(
      children: [
        const Blank(
          CupertinoIcons.arrow_right_square,
          'Quitter votre espace',
          'La maquette ne contient aucune session réelle.',
        ),
        const SizedBox(height: 22),
        Primary('Voir l’écran de déconnexion', () {
          Navigator.pop(context);
          open('logout');
        }),
      ],
    ),
  );

  List<Widget> _index() => [
    Text('Tous les écrans.', style: type(36, weight: FontWeight.w800)),
    const SizedBox(height: 12),
    Text(
      'Une visite libre de la maquette. Aucun service connecté.',
      style: type(15, color: muted),
    ),
    const SizedBox(height: 24),
    Tile(
      CupertinoIcons.sun_max,
      'Ouverture de l’application',
      'splash',
      () => open('splash'),
    ),
    Tile(
      CupertinoIcons.play_circle,
      'Introduction',
      'welcome',
      () => open('welcome'),
    ),
    Tile(CupertinoIcons.house, 'Accueil', 'home', () => open('home')),
    for (final entry in screens.entries)
      Tile(
        entry.value.icon,
        entry.value.title.replaceAll('\n', ' '),
        entry.key,
        () => open(entry.key),
      ),
  ];

  Widget _splash() => Scaffold(
    backgroundColor: paper,
    body: SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          children: [
            const Spacer(),
            Enter(
              child: Column(
                children: [
                  Container(
                    width: 112,
                    height: 112,
                    decoration: BoxDecoration(
                      color: orange,
                      borderRadius: BorderRadius.circular(36),
                      boxShadow: [
                        BoxShadow(
                          color: orange.withValues(alpha: .2),
                          blurRadius: 45,
                          offset: const Offset(0, 14),
                        ),
                      ],
                    ),
                    child: const Icon(
                      CupertinoIcons.sun_max_fill,
                      color: Colors.white,
                      size: 56,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Text('molopay', style: type(46, weight: FontWeight.w800)),
                  const SizedBox(height: 12),
                  Text('Le futur prend forme.', style: type(17, color: muted)),
                ],
              ),
            ),
            const Spacer(),
            Primary('Ouvrir la maquette', () => open('welcome')),
            const SizedBox(height: 20),
            Text(
              'Présentation investisseurs · sans connexion',
              style: type(11, color: muted),
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    ),
  );

  Widget _welcome() {
    const headings = [
      'Les envies d’aujourd’hui.\nLa vie de demain.',
      'Un petit pas.\nUn nouvel horizon.',
      'Votre avenir.\nÀ votre rythme.',
    ];
    const descriptions = [
      'Une autre façon de préparer vos achats et les étapes qui comptent.',
      'Équipement, logement, études : donnez une direction à vos projets.',
      'Découvrez un espace simple, serein et pensé pour avancer avec vous.',
    ];
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(26),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Text(
                            'molopay',
                            style: type(26, weight: FontWeight.w800),
                          ),
                        ),
                      ),
                      const Spacer(),
                      TextButton(
                        onPressed: () => open('home'),
                        child: Text('Explorer', style: type(13, color: orange)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 25),
                  GestureDetector(
                    onHorizontalDragEnd: (details) => setState(() {
                      intro =
                          (intro + (details.primaryVelocity! < 0 ? 1 : 2)) % 3;
                    }),
                    child: const HeroArt(height: 300),
                  ),
                  const SizedBox(height: 28),
                  Row(
                    children: [
                      for (int i = 0; i < 3; i++)
                        AnimatedContainer(
                          duration: MediaQuery.disableAnimationsOf(context)
                              ? Duration.zero
                              : const Duration(milliseconds: 240),
                          margin: const EdgeInsets.only(right: 6),
                          width: intro == i ? 28 : 7,
                          height: 7,
                          decoration: BoxDecoration(
                            color: intro == i ? orange : peach,
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  AnimatedSwitcher(
                    duration: MediaQuery.disableAnimationsOf(context)
                        ? Duration.zero
                        : const Duration(milliseconds: 250),
                    child: Text(
                      headings[intro],
                      key: ValueKey(intro),
                      style: type(36, weight: FontWeight.w800),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(descriptions[intro], style: type(15, color: muted)),
                  const SizedBox(height: 28),
                  Primary(
                    intro < 2 ? 'Continuer' : 'Découvrir mon espace',
                    () => intro < 2 ? setState(() => intro++) : open('phone'),
                  ),
                  const SizedBox(height: 10),
                  Center(
                    child: TextButton(
                      onPressed: () => open('login'),
                      child: Text(
                        'J’ai déjà un compte',
                        style: type(14, color: ink, weight: FontWeight.w600),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Center(
                    child: Text(
                      'Maquette navigable · aucune donnée enregistrée',
                      style: type(10, color: muted),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
