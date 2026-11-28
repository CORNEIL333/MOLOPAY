import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/models.dart';
import '../core/problem.dart';
import '../l10n/strings.dart';
import '../ui/design.dart';

/// Fil des notifications client (`GET /v1/me/notifications`, Contrat 0.37.0, F-NOT-001).
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, required this.state});

  final AppState state;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  bool _loading = true;
  bool _loadingMore = false;
  final List<CustomerNotification> _items = [];
  String? _nextBefore;
  DateTime? _asOf;
  ApiProblem? _problem;

  @override
  void initState() {
    super.initState();
    _load(reset: true);
  }

  Future<void> _load({required bool reset}) async {
    if (reset) {
      setState(() {
        _loading = true;
        _problem = null;
      });
    } else {
      if (_nextBefore == null || _loadingMore) return;
      setState(() => _loadingMore = true);
    }
    try {
      final feed = await widget.state.api.listNotifications(
        before: reset ? null : _nextBefore,
      );
      if (!mounted) return;
      setState(() {
        if (reset) _items.clear();
        _items.addAll(feed.items);
        _nextBefore = feed.nextBefore;
        _asOf = feed.asOf;
        _loading = false;
        _loadingMore = false;
      });
    } on ApiProblemException catch (error) {
      if (!mounted) return;
      setState(() {
        _problem = error.problem;
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppStrings.of(widget.state.locale);
    final title = s.isEn ? 'Notifications' : 'Notifications';

    return Scaffold(
      backgroundColor: paper,
      appBar: AppBar(
        backgroundColor: paper,
        elevation: 0,
        foregroundColor: ink,
        title: Text(title, style: type(17, weight: FontWeight.w700)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_problem != null) ...[
                  ProblemBanner(
                    problem: _problem!,
                    strings: s,
                    onRetry: () => _load(reset: true),
                  ),
                  const SizedBox(height: 16),
                ],
                if (_loading)
                  const Center(
                    child: Padding(
                      padding: EdgeInsets.symmetric(vertical: 32),
                      child: CircularProgressIndicator(color: ink),
                    ),
                  )
                else if (_items.isEmpty && _problem == null)
                  Blank(
                    CupertinoIcons.bell,
                    s.isEn ? 'No notifications yet' : 'Aucune notification',
                    s.isEn
                        ? 'Your payment confirmations and goal updates will appear here.'
                        : 'Vos confirmations de versement et mises à jour de projets apparaîtront ici.',
                    actionLabel: s.refresh,
                    onAction: () => _load(reset: true),
                  )
                else ...[
                  if (_asOf != null) ...[
                    Text(s.dataAsOf(_asOf!), style: type(12, color: muted)),
                    const SizedBox(height: 12),
                  ],
                  for (final item in _items)
                    Container(
                      width: double.infinity,
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: const Color(0xFFF3ECE5)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(item.title, style: type(15, weight: FontWeight.w700)),
                          const SizedBox(height: 4),
                          Text(item.body, style: type(13, color: ink)),
                        ],
                      ),
                    ),
                  if (_nextBefore != null) ...[
                    const SizedBox(height: 10),
                    Primary(
                      s.isEn ? 'Load older notifications' : 'Charger plus',
                      () => _load(reset: false),
                      key: const Key('notifications-load-more'),
                      loading: _loadingMore,
                      dark: true,
                    ),
                  ],
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
