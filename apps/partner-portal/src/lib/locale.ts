import { cookies, headers } from 'next/headers';
import { resolveLocale, type Locale } from '../i18n';

/** NF-UX-002 : langue de la requête (cookie `achat_locale`, sinon navigateur, sinon français). */
export async function currentLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale(cookieStore.get('achat_locale')?.value, headerStore.get('accept-language'));
}
