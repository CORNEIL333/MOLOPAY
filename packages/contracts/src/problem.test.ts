import { describe, expect, it } from 'vitest';
import { readProblem } from './problem';

function response(status: number): Response {
  return new Response(null, { status });
}

describe('readProblem', () => {
  it('ne retient que les champs affichables du problème RFC 9457', () => {
    const problem = readProblem(
      {
        type: 'https://api.example/errors/PAYMENT_ALREADY_CONFIRMED',
        title: 'Paiement déjà confirmé',
        status: 409,
        detail: 'Aucun second débit ne sera effectué.',
        code: 'PAYMENT_ALREADY_CONFIRMED',
        instance: '/v1/payments/abc',
        stack: 'Error: interne',
        accessToken: 'ne doit jamais sortir',
      },
      response(409),
      'Erreur inattendue',
    );
    expect(problem).toEqual({
      title: 'Paiement déjà confirmé',
      detail: 'Aucun second débit ne sera effectué.',
      code: 'PAYMENT_ALREADY_CONFIRMED',
      status: 409,
    });
    expect(JSON.stringify(problem)).not.toContain('ne doit jamais sortir');
    expect(JSON.stringify(problem)).not.toContain('stack');
  });

  it('utilise le titre localisé de l’écran si le corps est inexploitable', () => {
    expect(readProblem(undefined, response(503), 'Service indisponible')).toEqual(
      { title: 'Service indisponible', status: 503 },
    );
    expect(
      readProblem({ title: '', code: 42 }, response(500), 'Erreur du serveur'),
    ).toEqual({ title: 'Erreur du serveur', status: 500 });
  });

  it('reprend le statut HTTP réel de la réponse', () => {
    expect(
      readProblem({ title: 'Refusé', status: 418 }, response(403), 'Refusé'),
    ).toEqual({ title: 'Refusé', status: 403 });
  });
});
