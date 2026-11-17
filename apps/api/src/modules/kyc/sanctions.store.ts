import { createHash } from 'node:crypto';
import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { findPotentialMatches, normalizeName } from './name-match';
import { parseUnConsolidatedList } from './un-list';

type SqlClient = Pick<PoolClient, 'query'>;

const ACTOR = /^[^\s]{1,200}$/;
const SUBJECT = /^[^\s]{1,200}$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function invalid(message: string): never {
  throw new BusinessError('KYC_INVALID_REQUEST', message);
}

/**
 * REG-LBC-002 / D66 : importe une version de la liste consolidée ONU en une
 * transaction. Le fichier est celui téléchargé depuis la source officielle
 * (jamais modifié) ; son empreinte rend tout réimport impossible et la base
 * vérifie à la validation que toutes les entrées sont présentes.
 */
export async function importUnSanctionsList(
  client: SqlClient,
  input: { readonly versionId: string; readonly xml: string; readonly sourceUrl: string; readonly actorId: string },
): Promise<{ readonly versionId: string; readonly entryCount: number; readonly generatedAt: string }> {
  if (!ACTOR.test(input.actorId) || !UUID_V7.test(input.versionId)) invalid('acteur ou identifiant invalide');
  const list = parseUnConsolidatedList(input.xml);
  const versionId = input.versionId;
  await client.query(
    `INSERT INTO kyc.sanctions_list_version (id, source, source_url, generated_at, content_sha256, entry_count, imported_by, imported_at)
     VALUES ($1, 'UN_SC_CONSOLIDATED', $2, $3, $4, $5, $6, now())`,
    [versionId, input.sourceUrl, list.generatedAt, createHash('sha256').update(input.xml, 'utf8').digest(), list.entries.length, input.actorId],
  );
  for (let start = 0; start < list.entries.length; start += 200) {
    const chunk = list.entries.slice(start, start + 200);
    await client.query(
      `INSERT INTO kyc.sanctions_entry (version_id, reference, kind, names, listed_on)
       SELECT $1, e.reference, e.kind, ARRAY(SELECT jsonb_array_elements_text(e.names)), e.listed_on::date
         FROM jsonb_to_recordset($2::jsonb) AS e(reference text, kind text, names jsonb, listed_on text)`,
      [versionId, JSON.stringify(chunk.map((entry) => ({ reference: entry.reference, kind: entry.kind, names: entry.names, listed_on: entry.listedOn })))],
    );
  }
  return Object.freeze({ versionId, entryCount: list.entries.length, generatedAt: list.generatedAt });
}

export type Screening = {
  readonly screeningId: string;
  readonly versionId: string;
  readonly outcome: 'CLEAR' | 'POTENTIAL_MATCH';
  readonly matchedReferences: readonly string[];
};

/**
 * Filtre un nom contre la version de liste la plus récente (par date de
 * génération). Sans liste importée : refus (KYC_LIST_UNAVAILABLE), jamais
 * « aucun rapprochement » par défaut.
 */
export async function screenName(
  client: SqlClient,
  input: { readonly screeningId: string; readonly subjectType: 'PARTNER' | 'CUSTOMER'; readonly subjectId: string; readonly name: string; readonly actorId: string },
): Promise<Screening> {
  if (!ACTOR.test(input.actorId) || !SUBJECT.test(input.subjectId) || !UUID_V7.test(input.screeningId)) invalid('acteur, sujet ou identifiant invalide');
  const normalized = normalizeName(input.name);
  if (normalized === '' || normalized.length > 500) invalid('nom à filtrer vide ou trop long');
  const version = (await client.query<{ id: string }>(
    'SELECT id FROM kyc.sanctions_list_version ORDER BY generated_at DESC, imported_at DESC LIMIT 1',
  )).rows[0];
  if (version === undefined) {
    throw new BusinessError('KYC_LIST_UNAVAILABLE', 'aucune liste de sanctions importée');
  }
  const entries = (await client.query<{ reference: string; names: string[] }>(
    'SELECT reference, names FROM kyc.sanctions_entry WHERE version_id = $1',
    [version.id],
  )).rows;
  const matched = findPotentialMatches(input.name, entries);
  const screeningId = input.screeningId;
  const outcome = matched.length === 0 ? 'CLEAR' : 'POTENTIAL_MATCH';
  await client.query(
    `INSERT INTO kyc.screening (id, subject_type, subject_id, normalized_name, version_id, matched_references, outcome, screened_by, screened_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
    [screeningId, input.subjectType, input.subjectId, normalized, version.id, matched, outcome, input.actorId],
  );
  return Object.freeze({ screeningId, versionId: version.id, outcome, matchedReferences: Object.freeze(matched) });
}

/** Examen d'un rapprochement par une autre personne que l'auteur du filtrage (la base le vérifie). */
export async function recordScreeningReview(
  client: SqlClient,
  input: { readonly screeningId: string; readonly decision: 'FALSE_POSITIVE' | 'CONFIRMED_MATCH'; readonly reason: string; readonly actorId: string },
): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > 1000 || !ACTOR.test(input.actorId)) invalid('motif ou acteur invalide');
  if (input.decision !== 'FALSE_POSITIVE' && input.decision !== 'CONFIRMED_MATCH') invalid('décision invalide');
  await client.query(
    `INSERT INTO kyc.screening_review (screening_id, decision, reason, reviewed_by, reviewed_at) VALUES ($1, $2, $3, $4, now())`,
    [input.screeningId, input.decision, reason, input.actorId],
  );
}

/**
 * État de filtrage d'un sujet, d'après son filtrage le plus récent :
 * CLEAR, FALSE_POSITIVE (rapprochement écarté), PENDING_REVIEW,
 * CONFIRMED_MATCH ou NOT_SCREENED.
 */
export async function getScreeningStatus(
  client: SqlClient,
  input: { readonly subjectType: 'PARTNER' | 'CUSTOMER'; readonly subjectId: string },
): Promise<'NOT_SCREENED' | 'CLEAR' | 'FALSE_POSITIVE' | 'PENDING_REVIEW' | 'CONFIRMED_MATCH'> {
  const row = (await client.query<{ outcome: string; decision: string | null }>(
    `SELECT s.outcome, r.decision FROM kyc.screening s LEFT JOIN kyc.screening_review r ON r.screening_id = s.id
      WHERE s.subject_type = $1 AND s.subject_id = $2 ORDER BY s.screened_at DESC, s.id DESC LIMIT 1`,
    [input.subjectType, input.subjectId],
  )).rows[0];
  if (row === undefined) return 'NOT_SCREENED';
  if (row.outcome === 'CLEAR') return 'CLEAR';
  if (row.decision === null) return 'PENDING_REVIEW';
  return row.decision === 'FALSE_POSITIVE' ? 'FALSE_POSITIVE' : 'CONFIRMED_MATCH';
}

/** D68 : rattache un filtrage à la déclaration de nom qu'il couvre (même compte, vérifié par la base). */
export async function linkLegalNameScreening(client: SqlClient, input: { readonly declarationId: string; readonly screeningId: string }): Promise<void> {
  await client.query('INSERT INTO kyc.legal_name_screening (declaration_id, screening_id) VALUES ($1, $2)', [input.declarationId, input.screeningId]);
}

/** D68 : seule voie d'élévation au niveau 1 ; renvoie le niveau obtenu ou le motif d'attente. */
export async function grantBasicLevel(client: SqlClient, accountId: string): Promise<string> {
  const row = (await client.query<{ level: string }>('SELECT kyc.grant_basic_level($1) AS level', [accountId])).rows[0];
  return row?.level ?? 'NONE';
}

/** Sujet d'un filtrage (pour enchaîner l'élévation après un examen). */
export async function getScreeningSubject(client: SqlClient, screeningId: string): Promise<{ readonly subjectType: 'PARTNER' | 'CUSTOMER'; readonly subjectId: string } | null> {
  const row = (await client.query<{ subject_type: 'PARTNER' | 'CUSTOMER'; subject_id: string }>(
    'SELECT subject_type, subject_id FROM kyc.screening WHERE id = $1',
    [screeningId],
  )).rows[0];
  return row === undefined ? null : { subjectType: row.subject_type, subjectId: row.subject_id };
}
