import type { ReactElement } from 'react';
import { currentLocale } from '../lib/locale';
import { LoginPage } from './login-page';

export default async function Home(): Promise<ReactElement> {
  return <LoginPage locale={await currentLocale()} />;
}
