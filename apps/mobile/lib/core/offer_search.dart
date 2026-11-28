import 'models.dart';

const List<List<String>> _synonymGroups = <List<String>>[
  <String>['moto', 'scooter', 'boxer', 'motorbike', 'vehicule', 'mobilite'],
  <String>['frigo', 'refrigerateur', 'congelateur', 'froid', 'fridge', 'freezer'],
  <String>['telephone', 'smartphone', 'mobile', 'phone', 'android', 'iphone'],
  <String>['ordinateur', 'laptop', 'pc', 'portable', 'informatique'],
  <String>['loyer', 'caution', 'bail', 'logement', 'maison', 'rent', 'lease'],
  <String>['ecole', 'scolarite', 'universite', 'frais', 'school', 'tuition'],
  <String>['matelas', 'lit', 'chambre', 'meuble'],
  <String>['ciment', 'materiaux', 'tole', 'terrain', 'chantier'],
];

String normalizeOfferQuery(String raw) {
  const accented = 'àâäéèêëîïôöùûüçœ';
  const plain = 'aaaeeeeiioouuuco';
  final buf = StringBuffer();
  for (final rune in raw.toLowerCase().runes) {
    final ch = String.fromCharCode(rune);
    final idx = accented.indexOf(ch);
    final mapped = idx >= 0 ? plain[idx] : ch;
    if (RegExp(r'[a-z0-9]').hasMatch(mapped)) { buf.write(mapped); } else { buf.write(' '); }
  }
  return buf.toString().replaceAll(RegExp(r'\s+'), ' ').trim();
}

int _levenshtein(String a, String b) {
  if ((a.length - b.length).abs() > 2) return 3;
  final prev = List<int>.generate(b.length + 1, (j) => j);
  for (var i = 1; i <= a.length; i++) {
    var diag = prev[0];
    prev[0] = i;
    for (var j = 1; j <= b.length; j++) {
      final up = prev[j];
      final cost = a[i - 1] == b[j - 1] ? 0 : 1;
      var best = prev[j] + 1;
      if (prev[j - 1] + 1 < best) best = prev[j - 1] + 1;
      if (diag + cost < best) best = diag + cost;
      prev[j] = best;
      diag = up;
    }
  }
  return prev[b.length];
}

Set<String> _expand(String word) {
  final out = <String>{word};
  for (final g in _synonymGroups) {
    if (g.any((w) => w == word || (word.length >= 4 && _levenshtein(w, word) <= 1))) out.addAll(g);
  }
  return out;
}

List<Offer> searchOffersMobile(List<Offer> offers, String query) {
  final q = normalizeOfferQuery(query);
  if (q.isEmpty) return offers;
  final qWords = q.split(' ').where((w) => w.isNotEmpty).toList();
  return offers.where((o) {
    final hay = normalizeOfferQuery('${o.title} ${o.partnerName} ${o.universe.apiValue}');
    final hWords = hay.split(' ').where((w) => w.isNotEmpty).toList();
    return qWords.every((qw) {
      final cands = _expand(qw);
      return cands.any((c) => hay.contains(c) || (c.length >= 4 && hWords.any((hw) => hw.length >= 4 && _levenshtein(hw, c) <= 2)));
    });
  }).toList();
}
