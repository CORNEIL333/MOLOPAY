import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:molopay_mobile/core/api_client.dart';
import 'package:molopay_mobile/core/app_state.dart';
import 'package:molopay_mobile/core/models.dart';
import 'package:molopay_mobile/core/money.dart';
import 'package:molopay_mobile/core/offer_search.dart';
import 'package:molopay_mobile/core/problem.dart';

Offer _makeOffer({required String id, required String title, required String price, Universe universe = Universe.essentials}) {
  return Offer(
    offerId: id,
    title: title,
    partnerId: 'p1',
    partnerName: 'Boutique Centrale',
    universe: universe,
    models: const [OfferModel.saveThenBuy],
    cities: const [City.yaounde],
    priceXaf: MoneyXaf.parse(price),
    availability: const InStockAvailability(3),
    warranty: '12 mois',
    discountTerms: '',
    status: OfferStatus.published,
  );
}

void main() {
  group('MVP 0.0.1 · U3a recherche tolérante, favoris locaux et contrat 0.46.0 (D69, D121)', () {
    test('searchOffersMobile trouve par synonyme et faute légère sans jamais inventer de résultat', () {
      final offers = [
        _makeOffer(id: '1', title: 'Réfrigérateur 220 L', price: '250000'),
        _makeOffer(id: '2', title: 'Moto urbaine 125', price: '650000', universe: Universe.mobility),
      ];
      expect(searchOffersMobile(offers, 'frigo').map((o) => o.offerId), ['1']);
      expect(searchOffersMobile(offers, 'refrigirateur').map((o) => o.offerId), ['1']);
      expect(searchOffersMobile(offers, 'scooter').map((o) => o.offerId), ['2']);
      expect(searchOffersMobile(offers, 'tractopelle'), isEmpty);
    });

    test('AppState gère les favoris locaux et calcule la baisse/hausse exacte en MoneyXaf (I-12)', () {
      final api = MoloPayApiClient(baseUrl: 'http://localhost:3000', origin: 'http://localhost:3000');
      final state = AppState(api: api);
      final initial = _makeOffer(id: 'off-1', title: 'Frigo', price: '250000');
      state.toggleFavorite(initial);
      expect(state.isFavorite('off-1'), isTrue);

      final lower = _makeOffer(id: 'off-1', title: 'Frigo', price: '235000');
      final delta = state.favoritePriceDelta(lower);
      expect(delta?.isDown, isTrue);
      expect(delta?.amount.toApiString(), '15000');

      state.toggleFavorite(lower);
      expect(state.isFavorite('off-1'), isFalse);
    });

    test('getHandoverCode (D69) et declareLanguage PUT /v1/me/language (D121) + refus IDENTITY_LANGUAGE_INVALID', () async {
      String? lastMethod;
      String? lastPath;
      String? idemHeader;
      final mockHttp = MockClient((req) async {
        lastMethod = req.method;
        lastPath = req.url.path;
        idemHeader = req.headers['idempotency-key'];
        if (req.url.path.endsWith('/handover-code')) {
          return http.Response(
            jsonEncode({'code': '849201', 'expiresAt': '2026-12-05T18:00:00Z', 'status': 'ACTIVE'}),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        final body = jsonDecode(req.body) as Map<String, Object?>;
        if (body['language'] != 'fr' && body['language'] != 'en') {
          return http.Response(
            jsonEncode({'title': 'Langue invalide', 'status': 400, 'code': 'IDENTITY_LANGUAGE_INVALID'}),
            400,
            headers: {'content-type': 'application/problem+json'},
          );
        }
        return http.Response(jsonEncode({'language': body['language']}), 200, headers: {'content-type': 'application/json'});
      });

      final api = MoloPayApiClient(baseUrl: 'http://localhost:3000', origin: 'http://localhost:3000', httpClient: mockHttp);
      final code = await api.getHandoverCode('goal-1');
      expect(code.code, '849201');
      expect(code.status, 'ACTIVE');

      await api.declareLanguage('en');
      expect(lastMethod, 'PUT');
      expect(lastPath, '/v1/me/language');
      expect(idemHeader, isNotNull);

      expect(
        () => api.declareLanguage('es'),
        throwsA(isA<ApiProblemException>().having((e) => e.problem.code, 'code', 'IDENTITY_LANGUAGE_INVALID')),
      );
      debugPrint('U3a contract checks OK');
    });
  });
}
