'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import { useId, useState, type ReactElement } from 'react';
import { uuidv7 } from '../lib/uuidv7';

export type AdminPort = (input: {
  readonly path: string;
  readonly body: Readonly<Record<string, unknown>>;
}) => Promise<{ readonly ok: true; readonly body: Readonly<Record<string, unknown>> } | { readonly ok: false; readonly problem: ProblemSummary }>;

const LOGIN = /^[a-z][a-z0-9._-]{2,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Paramètres financiers publiables (clés connues du serveur ; bornes vérifiées par la base). */
const SETTINGS = ['merchant_commission_bps', 'settlement_contestation_days', 'handover_code_validity_days'] as const;
const ROLES = ['SUPPORT_N1', 'SUPPORT_N2', 'OPERATIONS', 'FINANCE', 'COMPLIANCE', 'RISK', 'PARTNER_NETWORK', 'AUDIT', 'TECH_ADMIN'] as const;
const CITIES = ['yaounde', 'douala'] as const;

/**
 * SEC-AUTHZ-003 / D62 : administration. Chaque acte passe par une demande
 * préparée ici puis approuvée par une autre personne ; l'écran prépare les
 * charges exactes attendues par la base. Le jeton d'enrôlement est affiché
 * une seule fois et effacé dès l'action suivante.
 */
export function AdminPanel({ post }: { readonly post: AdminPort }): ReactElement {
  const ids = { login: useId(), request: useId(), reason: useId(), setting: useId(), value: useId(), approved: useId(), staff: useId(), target: useId(), staffApproved: useId() };
  const [target, setTarget] = useState('');
  const [staffApproved, setStaffApproved] = useState('');
  const [roles, setRoles] = useState<readonly string[]>([]);
  const [cities, setCities] = useState<readonly string[]>([]);
  const [login, setLogin] = useState('');
  const [requestId, setRequestId] = useState('');
  const [reason, setReason] = useState('');
  const [setting, setSetting] = useState<(typeof SETTINGS)[number]>('merchant_commission_bps');
  const [value, setValue] = useState('');
  const [approved, setApproved] = useState('');
  const [staffId, setStaffId] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);

  async function send(path: string, body: Record<string, unknown>, success: (response: Readonly<Record<string, unknown>>) => void): Promise<void> {
    setPending(true);
    setProblem(null);
    setNotice(null);
    setToken(null);
    try {
      const result = await post({ path, body });
      if (result.ok) {
        success(result.body);
      } else {
        setProblem(result.problem);
      }
    } catch {
      setProblem({ title: 'Action impossible', detail: 'Une connexion réseau est nécessaire.' });
    } finally {
      setPending(false);
    }
  }

  function prepareStaff(): void {
    if (!LOGIN.test(login)) {
      setError('Identifiant invalide (minuscules, chiffres, point, tiret).');
      return;
    }
    setError(undefined);
    const staff = uuidv7();
    void send('/v1/backoffice/admin/approvals', { id: uuidv7(), kind: 'ROLE_GRANT', payload: { operation: 'CREATE_STAFF', staff_id: staff, login }, reason: `Création du compte ${login}` }, (response) => {
      setNotice(`Demande préparée : ${String(response['requestId'])} (agent ${staff}). À faire approuver par un autre administrateur.`);
    });
  }

  function toggle(list: readonly string[], item: string): readonly string[] {
    return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
  }

  function staffTarget(): boolean {
    if (!UUID.test(target)) {
      setError('Identifiant d’agent invalide.');
      return false;
    }
    setError(undefined);
    return true;
  }

  function finalizeStaff(): void {
    if (!staffTarget() || !LOGIN.test(login) || !UUID.test(staffApproved)) {
      setError('Agent, identifiant de connexion et demande approuvée requis.');
      return;
    }
    void send('/v1/backoffice/admin/staff', { staffId: target, login, approvalRequestId: staffApproved }, () => { setNotice('Compte créé.'); });
  }

  function prepareRoles(): void {
    if (!staffTarget() || roles.length === 0) {
      setError('Agent et au moins un rôle requis.');
      return;
    }
    // Ordre canonique : la base compare la charge approuvée à l'attribution, éléments compris.
    const payload = { operation: 'GRANT_ROLES', staff_id: target, roles: ROLES.filter((role) => roles.includes(role)), city_ids: CITIES.filter((city) => cities.includes(city)), max_amount_xaf: null };
    void send('/v1/backoffice/admin/approvals', { id: uuidv7(), kind: 'ROLE_GRANT', payload, reason: `Rôles de l’agent ${target}` }, (response) => {
      setNotice(`Demande préparée : ${String(response['requestId'])}. À faire approuver par un autre administrateur.`);
    });
  }

  function grantRoles(): void {
    if (!staffTarget() || !UUID.test(staffApproved)) {
      setError('Agent et demande approuvée requis.');
      return;
    }
    const body = { roles: ROLES.filter((role) => roles.includes(role)), cityIds: CITIES.filter((city) => cities.includes(city)), maxAmountXaf: null, approvalRequestId: staffApproved };
    void send(`/v1/backoffice/admin/staff/${target}/roles`, body, () => { setNotice('Rôles attribués.'); });
  }

  function disable(): void {
    if (!staffTarget()) {
      return;
    }
    if (reason.trim().length === 0) {
      setError('Une désactivation exige un motif.');
      return;
    }
    void send(`/v1/backoffice/admin/staff/${target}/disable`, { reason: reason.trim() }, () => { setNotice('Agent désactivé.'); });
  }

  function decide(decision: 'APPROVED' | 'REJECTED'): void {
    if (!UUID.test(requestId)) {
      setError('Identifiant de demande invalide.');
      return;
    }
    if (decision === 'REJECTED' && reason.trim().length === 0) {
      setError('Un refus exige un motif.');
      return;
    }
    setError(undefined);
    const body = decision === 'REJECTED' ? { decision, reason: reason.trim() } : { decision };
    void send(`/v1/backoffice/admin/approvals/${requestId}/decision`, body, () => { setNotice(`Demande ${decision === 'APPROVED' ? 'approuvée' : 'refusée'}.`); });
  }

  function prepareSetting(): void {
    if (!/^[0-9]{1,6}$/.test(value)) {
      setError('Valeur entière attendue.');
      return;
    }
    setError(undefined);
    void send('/v1/backoffice/admin/approvals', { id: uuidv7(), kind: 'FINANCIAL_SETTING', payload: { key: setting, value: Number(value) }, reason: `Paramètre ${setting}` }, (response) => {
      setNotice(`Demande préparée : ${String(response['requestId'])}. À faire approuver par une autre personne de la finance.`);
    });
  }

  function publishSetting(): void {
    if (!UUID.test(approved) || !/^[0-9]{1,6}$/.test(value)) {
      setError('Demande approuvée et valeur requises.');
      return;
    }
    setError(undefined);
    void send('/v1/backoffice/admin/settings', { key: setting, value: Number(value), approvalRequestId: approved }, (response) => {
      setNotice(`Paramètre publié (version ${String(response['version'])}).`);
    });
  }

  function enroll(): void {
    if (!UUID.test(staffId)) {
      setError('Identifiant d’agent invalide.');
      return;
    }
    setError(undefined);
    void send(`/v1/backoffice/admin/staff/${staffId}/enrollments`, {}, (response) => {
      const issued = response['enrollmentToken'];
      const challengeId = response['challengeId'];
      const challenge = response['challenge'];
      // Code unique à remettre en main propre : seul le jeton est secret.
      setToken(typeof issued === 'string' && typeof challengeId === 'string' && typeof challenge === 'string' ? `${challengeId}.${challenge}.${issued}` : null);
    });
  }

  return (
    <section>
      <h1>Administration</h1>
      {problem === null ? null : <ErrorState problem={problem} />}
      {notice === null ? null : <p role="status">{notice}</p>}
      {error === undefined ? null : <p role="alert">{error}</p>}
      {token === null ? null : (
        <div role="status">
          <p>Code d’enrôlement à remettre en main propre à l’agent (valable 5 minutes) ; il ne sera plus affiché :</p>
          <p><code>{token}</code></p>
        </div>
      )}

      <h2>Nouvel agent</h2>
      <TextField id={ids.login} label="Identifiant du nouvel agent" value={login} onChange={(event) => { setLogin(event.target.value.trim()); }} />
      <Button disabled={pending} onClick={prepareStaff}>Préparer la création</Button>

      <h2>Agent existant</h2>
      <TextField id={ids.target} label="Agent concerné" value={target} onChange={(event) => { setTarget(event.target.value.trim()); }} />
      <TextField id={ids.staffApproved} label="Demande approuvée (agent)" value={staffApproved} onChange={(event) => { setStaffApproved(event.target.value.trim()); }} />
      <Button disabled={pending} onClick={finalizeStaff}>Finaliser la création</Button>
      <fieldset>
        <legend>Rôles</legend>
        {ROLES.map((role) => (
          <label key={role}>
            <input type="checkbox" checked={roles.includes(role)} onChange={() => { setRoles(toggle(roles, role)); }} /> {role}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Villes</legend>
        {CITIES.map((city) => (
          <label key={city}>
            <input type="checkbox" checked={cities.includes(city)} onChange={() => { setCities(toggle(cities, city)); }} /> {city}
          </label>
        ))}
      </fieldset>
      <Button disabled={pending} onClick={prepareRoles}>Préparer l’attribution des rôles</Button>
      <Button disabled={pending} onClick={grantRoles}>Attribuer les rôles approuvés</Button>
      <Button variant="danger" disabled={pending} onClick={disable}>Désactiver l’agent</Button>

      <h2>Décider une demande</h2>
      <TextField id={ids.request} label="Identifiant de la demande" value={requestId} onChange={(event) => { setRequestId(event.target.value.trim()); }} />
      <TextField id={ids.reason} label="Motif de la décision" value={reason} onChange={(event) => { setReason(event.target.value); }} />
      <Button disabled={pending} onClick={() => { decide('APPROVED'); }}>Approuver la demande</Button>
      <Button variant="danger" disabled={pending} onClick={() => { decide('REJECTED'); }}>Refuser la demande</Button>

      <h2>Paramètres financiers</h2>
      <div className="achat-field">
        <label className="achat-field__label" htmlFor={ids.setting}>Paramètre</label>
        <select id={ids.setting} className="achat-field__input" value={setting} onChange={(event) => { setSetting(SETTINGS.find((key) => key === event.target.value) ?? 'merchant_commission_bps'); }}>
          {SETTINGS.map((key) => <option key={key} value={key}>{key}</option>)}
        </select>
      </div>
      <TextField id={ids.value} label="Valeur" inputMode="numeric" value={value} onChange={(event) => { setValue(event.target.value.trim()); }} />
      <Button disabled={pending} onClick={prepareSetting}>Préparer le paramètre</Button>
      <TextField id={ids.approved} label="Demande approuvée" value={approved} onChange={(event) => { setApproved(event.target.value.trim()); }} />
      <Button disabled={pending} onClick={publishSetting}>Publier le paramètre</Button>

      <h2>Enrôlement d’une clé</h2>
      <TextField id={ids.staff} label="Agent à enrôler" value={staffId} onChange={(event) => { setStaffId(event.target.value.trim()); }} />
      <Button disabled={pending} onClick={enroll}>Émettre un jeton d’enrôlement</Button>
    </section>
  );
}
