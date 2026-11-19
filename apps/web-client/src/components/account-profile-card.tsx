import type { components } from '@achat/contracts/api';
import type { ReactElement } from 'react';
import type { Locale } from '../i18n';

type Account = components['schemas']['Account'];

/**
 * C2 / D77 : affiche le profil minimal renvoyé par `GET /v1/me`.
 * Ni numéro complet, ni nom légal, ni niveau KYC ni résultat de filtrage.
 */
export function AccountProfileCard({
  account,
  locale,
}: {
  readonly account: Account;
  readonly locale: Locale;
}): ReactElement {
  const isEn = locale === 'en';
  return (
    <section aria-label={isEn ? 'Account profile' : 'Profil du compte'}>
      <dl>
        <div>
          <dt>{isEn ? 'Phone' : 'Téléphone'}</dt>
          <dd>{account.phoneMasked}</dd>
        </div>
        <div>
          <dt>{isEn ? 'Member since' : 'Membre depuis'}</dt>
          <dd>
            <time dateTime={account.memberSince}>{account.memberSince}</time>
          </dd>
        </div>
        <div>
          <dt>{isEn ? 'Identity' : 'Identité'}</dt>
          <dd>
            {account.legalNameDeclared ? (
              isEn ? 'Legal name declared' : 'Nom légal déclaré'
            ) : (
              <a href="/compte/identite">
                {isEn ? 'Declare your legal name' : 'Déclarer votre nom légal'}
              </a>
            )}
          </dd>
        </div>
      </dl>
      <p><a href="/compte/notifications">Notifications</a></p>
    </section>
  );
}
