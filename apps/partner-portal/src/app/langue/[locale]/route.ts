import { NextResponse } from 'next/server';
import { isLocale } from '../../../i18n';

/** NF-UX-002 : choix explicite de la langue (cookie d'un an), retour à l'accueil. */
export async function GET(_request: Request, { params }: { readonly params: Promise<{ locale: string }> }): Promise<NextResponse> {
  const { locale } = await params;
  if (!isLocale(locale)) return new NextResponse(null, { status: 404 });
  const response = new NextResponse(null, { status: 303, headers: { Location: '/', 'Cache-Control': 'no-store' } });
  response.cookies.set('achat_locale', locale, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 31_536_000,
  });
  return response;
}
