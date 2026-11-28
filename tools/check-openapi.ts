import { readFileSync } from 'node:fs';
import * as path from 'node:path';

type Parameter = {
  name?: string;
  in?: string;
  required?: boolean;
  $ref?: string;
};

type Operation = {
  responses?: Record<string, unknown>;
  parameters?: Parameter[];
};

type OpenApiDocument = {
  openapi?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, Operation>>;
  components?: { parameters?: Record<string, Parameter> };
};

const SPEC_PATH = path.join('packages', 'contracts', 'openapi.json');
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);
const HTTP_METHODS = new Set([...WRITE_METHODS, 'get', 'head', 'options']);

function fail(message: string): never {
  process.stderr.write(`OPENAPI_INVALID ${message}\n`);
  process.exit(1);
}

const raw = readFileSync(SPEC_PATH, 'utf8');
let document: OpenApiDocument;
try {
  document = JSON.parse(raw) as OpenApiDocument;
} catch (error: unknown) {
  fail(
    `JSON illisible: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (typeof document.openapi !== 'string' || !document.openapi.startsWith('3.1.')) {
  fail('la version doit être OpenAPI 3.1.x');
}
if (document.info?.title === undefined || document.info.version === undefined) {
  fail('info.title et info.version sont obligatoires');
}
if (document.paths === undefined) {
  fail('paths est obligatoire');
}

function resolveParameter(parameter: Parameter): Parameter {
  const reference = parameter.$ref;
  if (reference === undefined) {
    return parameter;
  }
  const prefix = '#/components/parameters/';
  if (!reference.startsWith(prefix)) {
    fail(`référence de paramètre non locale: ${reference}`);
  }
  const resolved = document.components?.parameters?.[reference.slice(prefix.length)];
  if (resolved === undefined) {
    fail(`paramètre référencé introuvable: ${reference}`);
  }
  return resolved;
}

for (const [route, item] of Object.entries(document.paths)) {
  if (!route.startsWith('/')) {
    fail(`chemin invalide: ${route}`);
  }
  for (const [method, operation] of Object.entries(item)) {
    if (!HTTP_METHODS.has(method)) {
      continue;
    }
    if (
      operation.responses === undefined ||
      Object.keys(operation.responses).length === 0
    ) {
      fail(`${method.toUpperCase()} ${route} sans responses`);
    }
    if (WRITE_METHODS.has(method)) {
      const idempotency = (operation.parameters ?? [])
        .map(resolveParameter)
        .some(
          (parameter) =>
            parameter.in === 'header' &&
            parameter.name === 'Idempotency-Key' &&
            parameter.required === true,
        );
      if (!idempotency) {
        fail(
          `${method.toUpperCase()} ${route} doit déclarer Idempotency-Key obligatoire`,
        );
      }
    }
  }
}

process.stdout.write('OpenAPI 3.1: OK\n');
