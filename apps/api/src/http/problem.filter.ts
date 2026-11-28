import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { HttpResponse } from './express-types';
import { toProblem, type Problem } from './problem';

function fromHttpException(error: HttpException): Problem {
  const status = error.getStatus();
  if (status === 404) {
    return { type: 'urn:achat:problem:route-not-found', title: 'Ressource introuvable', status: 404, code: 'ROUTE_NOT_FOUND' };
  }
  return { type: 'urn:achat:problem:request-invalid', title: 'Requête invalide', status: 400, code: 'REQUEST_INVALID' };
}

/**
 * Toute erreur sort en `application/problem+json` (RFC 9457) avec un code
 * métier stable. Les erreurs internes ne divulguent ni pile ni SQL.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  public catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const body = error instanceof HttpException ? fromHttpException(error) : toProblem(error);
    response.status(body.status).type('application/problem+json').json(body);
  }
}
