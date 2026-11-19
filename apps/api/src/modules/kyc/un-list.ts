import { BusinessError } from '@achat/contracts';

/**
 * REG-LBC-002 / D66 : lecture de la liste consolidée du Conseil de sécurité
 * de l'ONU (XML officiel, scsanctions.un.org). Analyseur minimal et strict,
 * sans dépendance : éléments, attributs, texte et entités prédéfinies ou
 * numériques. DOCTYPE (entités externes, XXE), CDATA, instructions autres
 * que la déclaration et tout document mal formé sont refusés.
 */
export type SanctionsEntry = {
  readonly kind: 'INDIVIDUAL' | 'ENTITY';
  readonly reference: string;
  readonly names: readonly string[];
  readonly listedOn: string | null;
};

export type SanctionsList = { readonly generatedAt: string; readonly entries: readonly SanctionsEntry[] };

type Node = { readonly name: string; readonly attributes: Readonly<Record<string, string>>; readonly children: Node[]; text: string };

const MAX_BYTES = 64 * 1024 * 1024;
const NAME = '[A-Za-z_][A-Za-z0-9_.:-]*';
const TAG = new RegExp(`^<(/?)(${NAME})((?:\\s+${NAME}\\s*=\\s*"[^"<]*")*)\\s*(/?)>$`);
const ATTRIBUTE = new RegExp(`(${NAME})\\s*=\\s*"([^"<]*)"`, 'g');
const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const REFERENCE = /^[A-Za-z]{2}[ei]\.\d{3,4}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function invalid(message: string): never {
  throw new BusinessError('KYC_LIST_INVALID', `liste de sanctions invalide : ${message}`);
}

function decode(raw: string): string {
  return raw.replace(/&([^;\s&<]*);|&/g, (whole, entity: string | undefined) => {
    if (entity === undefined) invalid('« & » isolé');
    const known = ENTITIES[entity];
    if (known !== undefined) return known;
    const numeric = /^#(x[0-9A-Fa-f]{1,6}|\d{1,7})$/.exec(entity)?.[1];
    if (numeric === undefined) invalid(`entité inconnue ${whole}`);
    const point = numeric.startsWith('x') ? Number.parseInt(numeric.slice(1), 16) : Number.parseInt(numeric, 10);
    if (point > 0x10ffff) invalid('caractère hors Unicode');
    // XML 1.0 « Char » : ni caractère nul, ni contrôle, ni demi-substitut, ni U+FFFE/U+FFFF.
    const allowed = point === 0x9 || point === 0xa || point === 0xd || (point >= 0x20 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd) || point >= 0x10000;
    if (!allowed) invalid(`caractère interdit en XML ${whole}`);
    return String.fromCodePoint(point);
  });
}

function parseTree(xml: string): Node {
  if (xml.length === 0 || Buffer.byteLength(xml, 'utf8') > MAX_BYTES) invalid('taille');
  let body = xml.replace(/^\uFEFF/, '');
  const declaration = /^<\?xml[^?]*\?>/.exec(body);
  if (declaration !== null) body = body.slice(declaration[0].length);
  if (body.includes('<!') || body.includes('<?')) invalid('DOCTYPE, CDATA, commentaire ou instruction refusés');
  const stack: Node[] = [];
  let root: Node | null = null;
  const pieces = body.split(/(<[^>]*>)/);
  for (const piece of pieces) {
    if (piece === '') continue;
    if (!piece.startsWith('<')) {
      if (piece.includes('>')) invalid('« > » isolé');
      const text = decode(piece);
      const current = stack[stack.length - 1];
      if (current === undefined) {
        if (text.trim() !== '') invalid('texte hors de la racine');
        continue;
      }
      current.text += text;
      continue;
    }
    const tag = TAG.exec(piece);
    if (tag === null) invalid('balise mal formée');
    const [, closing, name, rawAttributes, selfClosing] = tag;
    if (name === undefined) invalid('balise sans nom');
    if (closing === '/') {
      if (selfClosing === '/' || (rawAttributes ?? '') !== '') invalid('balise fermante mal formée');
      const open = stack.pop();
      if (open?.name !== name) invalid(`fermeture inattendue </${name}>`);
      continue;
    }
    const attributes: Record<string, string> = {};
    for (const match of (rawAttributes ?? '').matchAll(ATTRIBUTE)) {
      attributes[match[1] ?? ''] = decode(match[2] ?? '');
    }
    const node: Node = { name, attributes, children: [], text: '' };
    const parent = stack[stack.length - 1];
    if (parent === undefined) {
      if (root !== null) invalid('plusieurs racines');
      root = node;
    } else {
      parent.children.push(node);
    }
    if (selfClosing !== '/') stack.push(node);
  }
  if (stack.length !== 0 || root === null) invalid('document incomplet');
  return root;
}

function child(node: Node, name: string): Node | undefined {
  return node.children.find((candidate) => candidate.name === name);
}

function text(node: Node | undefined): string {
  return (node?.text ?? '').replace(/\s+/g, ' ').trim();
}

function entry(node: Node, kind: SanctionsEntry['kind'], aliasTag: string): SanctionsEntry {
  const reference = text(child(node, 'REFERENCE_NUMBER'));
  if (!REFERENCE.test(reference)) invalid(`référence absente ou invalide (${reference || 'vide'})`);
  const primary = ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME'].map((part) => text(child(node, part))).filter((part) => part !== '').join(' ');
  const aliases = node.children.filter((candidate) => candidate.name === aliasTag).map((alias) => text(child(alias, 'ALIAS_NAME')));
  const original = text(child(node, 'NAME_ORIGINAL_SCRIPT'));
  const names = [...new Set([primary, ...aliases, original].filter((name) => name !== ''))];
  if (names.length === 0) invalid(`entrée ${reference} sans nom`);
  const listedOn = text(child(node, 'LISTED_ON'));
  return Object.freeze({ kind, reference, names: Object.freeze(names), listedOn: DATE.test(listedOn) ? listedOn : null });
}

export function parseUnConsolidatedList(xml: string): SanctionsList {
  const root = parseTree(xml);
  if (root.name !== 'CONSOLIDATED_LIST') invalid('racine CONSOLIDATED_LIST attendue');
  const generatedAt = root.attributes['dateGenerated'] ?? '';
  if (Number.isNaN(Date.parse(generatedAt))) invalid('date de génération absente');
  const individuals = child(root, 'INDIVIDUALS')?.children.filter((node) => node.name === 'INDIVIDUAL') ?? [];
  const entities = child(root, 'ENTITIES')?.children.filter((node) => node.name === 'ENTITY') ?? [];
  const entries = [
    ...individuals.map((node) => entry(node, 'INDIVIDUAL', 'INDIVIDUAL_ALIAS')),
    ...entities.map((node) => entry(node, 'ENTITY', 'ENTITY_ALIAS')),
  ];
  if (entries.length === 0) invalid('aucune entrée');
  if (new Set(entries.map((item) => item.reference)).size !== entries.length) invalid('référence en double');
  return Object.freeze({ generatedAt: new Date(generatedAt).toISOString(), entries: Object.freeze(entries) });
}
