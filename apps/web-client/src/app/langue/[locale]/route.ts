import { NextResponse } from 'next/server';
import { isLocale } from '../../../i18n';
import { serverApi } from '../../../lib/server-api';

export async function GET(_request: Request, { params }: { readonly params: Promise<{ locale: string }> }): Promise<NextResponse> {
  const { locale } = await params;
  if (!isLocale(locale)) return new NextResponse(null, { status: 404 });
  try {
    await (await serverApi()).PUT('/v1/me/language', {
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: { language: locale },
      cache: 'no-store',
    });
  } catch { /* session absente ou réseau indisponible : le témoin local reste appliqué */ }
  const response = new NextResponse(null, { status: 303, headers: { Location: '/', 'Cache-Control': 'no-store' } });
  response.cookies.set('achat_locale', locale, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 31_536_000,
  });
  return response;
}
