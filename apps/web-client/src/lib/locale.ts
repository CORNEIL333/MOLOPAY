import { cookies, headers } from 'next/headers';
import { resolveLocale, type Locale } from '../i18n';

export async function currentLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale(
    cookieStore.get('achat_locale')?.value,
    headerStore.get('accept-language'),
  );
}
