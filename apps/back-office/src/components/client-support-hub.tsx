'use client';

import { StatusPill } from '@achat/ui';
import type { ReactElement } from 'react';

const COPY = {
  fr: {
    title: 'Clients et support',
    subtitle: 'Accès motivé aux réclamations, à la chronologie des objectifs et aux actes de protection du compte.',
    auditNotice: 'Chaque consultation est journalisée avec un motif obligatoire et visible par l’audit.',
    toolsHeading: 'Outils opérationnels actifs',
    claims: ['Réclamations (F-SUP-001)', 'Consultation motivée et ouverture de litige suspensif.', '/reclamations'],
    goals: ['Historique d’un objectif (F-SUP-003)', 'Chronologie complète des statuts, versements et litiges.', '/objectifs'],
    agency: ['Inscription en agence (C13)', 'Vérification physique de la pièce et émission d’un code à usage unique.', '/clients/inscription-agence'],
    block: ['Bloquer un compte client (F-ACC-006)', 'Perte, vol ou fraude présumée : fermeture immédiate des sessions.', '/clients/blocage'],
    decease: ['Déclaration de décès (F-ACC-007)', 'Déclaration puis approbation par une seconde personne et gel des objectifs.', '/clients/deces'],
    crmHeading: 'Fiche client 360° et registre d’échanges (CRM)',
    crmBadge: 'En intégration (PR #10)',
    crmDetail: 'La fiche client unifiée, le journal d’échanges en ajout seul et les tâches de rappel sont portés par la PR #10 (lot Q5). Aucune route CRM n’est simulée ici ; la vue CrmCustomer360 héritera directement de cette coque plate dès sa fusion.',
  },
  en: {
    title: 'Customers and support',
    subtitle: 'Reason-logged access to claims, goal timelines and account protection actions.',
    auditNotice: 'Every consultation is logged with a mandatory reason and visible to audit.',
    toolsHeading: 'Active operational tools',
    claims: ['Claims (F-SUP-001)', 'Reason-logged lookup and suspensive dispute opening.', '/reclamations'],
    goals: ['Goal history (F-SUP-003)', 'Complete timeline of statuses, contributions and disputes.', '/objectifs'],
    agency: ['In-agency enrolment (C13)', 'In-person ID check and single-use enrolment code.', '/clients/inscription-agence'],
    block: ['Block customer account (F-ACC-006)', 'Lost/stolen phone or suspected fraud: immediate session revocation.', '/clients/blocage'],
    decease: ['Decease declaration (F-ACC-007)', 'Two-person declaration and approval freezing active goals.', '/clients/deces'],
    crmHeading: 'Customer 360° sheet and support log (CRM)',
    crmBadge: 'Pending merge (PR #10)',
    crmDetail: 'The unified 360° customer sheet, append-only interaction log and follow-up tasks are delivered in PR #10 (Q5). No CRM route is simulated here; CrmCustomer360 automatically adopts this flat shell upon merge.',
  },
} as const;

export function ClientSupportHub({ locale = 'fr' }: { readonly locale?: 'fr' | 'en' }): ReactElement {
  const t = COPY[locale];
  const cards = [t.claims, t.goals, t.agency, t.block, t.decease] as const;
  return (
    <section className="mp-page">
      <header className="mp-top">
        <div><h1>{t.title}</h1><p className="mp-sub">{t.subtitle}</p></div>
      </header>
      <p className="mp-banner mp-banner--audit">{t.auditNotice}</p>
      <section className="mp-panel" aria-label={t.toolsHeading}>
        <div className="mp-ph"><h2>{t.toolsHeading}</h2></div>
        <ul className="mp-kpis">
          {cards.map(([label, desc, href]) => (
            <li key={href} className="mp-kpi">
              <strong><a href={href}>{label}</a></strong>
              <span className="mp-kpi__hint">{desc}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="mp-panel" aria-label={t.crmHeading}>
        <div className="mp-ph">
          <h2>{t.crmHeading}</h2>
          <StatusPill tone="warn">{t.crmBadge}</StatusPill>
        </div>
        <p className="mp-sub">{t.crmDetail}</p>
      </section>
    </section>
  );
}
