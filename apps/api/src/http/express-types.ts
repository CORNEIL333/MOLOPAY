/**
 * Formes minimales des objets requête/réponse d'Express utilisées par la
 * couche HTTP (évite une dépendance de types supplémentaire).
 */
export type HttpRequest = {
  readonly method: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
};

export type HttpResponse = {
  status(code: number): HttpResponse;
  type(contentType: string): HttpResponse;
  json(body: unknown): unknown;
};
