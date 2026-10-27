const MAX_LENGTH = 512;
const hasForbiddenCharacter = (value: string): boolean =>
  [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === '\\');

/**
 * N'accepte qu'un chemin interne. Toute valeur douteuse retombe sur le
 * catalogue : jamais de redirection vers un autre site.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '/';
  }
  if (value.length === 0 || value.length > MAX_LENGTH) {
    return '/';
  }
  if (!value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }
  if (hasForbiddenCharacter(value)) {
    return '/';
  }
  return value;
}
