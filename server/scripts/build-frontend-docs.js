import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = resolve(root, 'docs/frontend');
const check = process.argv.includes('--check');
assert.ok(process.argv.slice(2).every(value => value === '--check'), 'Supported option: --check');
const text = file => readFileSync(resolve(root, file), 'utf8');
const portable = value => value.split(sep).join('/');
const mapping = new Map();
function include(source, target) { mapping.set(resolve(root, source), resolve(destination, target)); }
for (const name of ['README.md', 'api-conventions.md', 'b2c-flow.md', 'b2b-flow.md', 'integration-readiness.md', 'documentation-audit.md', 'handoff-audit.md', 'backend-response.md', 'size-chart-backend-response.md', 'account-creation-password-change.md', 'wholesale-stable-urls.md', 'order-number-and-history-frontend-response.md']) include(`docs/frontend/${name}`, name);
const moduleRoot = resolve(root, 'server/src/modules');
const modules = readdirSync(moduleRoot, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name).sort();
for (const module of modules) {
  const name = `${module.toUpperCase()}_FRONTEND.md`, source = `server/src/modules/${module}/${name}`;
  assert.ok(existsSync(resolve(root, source)), `Missing canonical module contract: ${source}`);
  include(source, `modules/${name}`);
}
assert.ok(modules.length > 0, 'No implemented module contracts found');
include('server/src/shared/infrastructure/email/EMAIL_DELIVERY_FRONTEND.md', 'modules/EMAIL_DELIVERY_FRONTEND.md');
include('docs/architecture.md', 'references/architecture.md');
include('docs/security.md', 'references/security.md');
include('docs/apidog/README.md', 'api/README.md');
for (const file of ['narmer.openapi.json', 'narmer.postman.json', 'routes.json', 'example-manifest.json', 'verification.json', 'examples-verification.json', 'local-example-checks.json', 'native-case-import.json', 'import-log.jsonl']) {
  assert.ok(existsSync(resolve(root, 'docs/apidog', file)), `Missing API handoff artifact: ${file}`);
  include(`docs/apidog/${file}`, `api/${file}`);
}
const targets = new Set(mapping.values());
const sourceRoutes = JSON.parse(text('docs/apidog/routes.json'));
const api = JSON.parse(text('docs/apidog/narmer.openapi.json'));
const shared = text('docs/frontend/api-conventions.md');
const coverage = { scope: 'Static request/response field-name coverage plus the source/DTO/flow review in handoff-audit.md. Field-name coverage alone is not semantic proof. Dynamic map keys come from definitions, not sample questions/options.', modules: {} };
function fields(schema, prefix, result = new Set()) {
  if (!schema) return result;
  if (schema.$ref) fields(schema.$ref.slice(2).split('/').reduce((value, key) => value[key], api), prefix, result);
  for (const [name, child] of Object.entries(schema.properties ?? {})) { result.add(`${prefix}.${name}`); fields(child, `${prefix}.${name}`, result); }
  if (schema.items) fields(schema.items, `${prefix}[]`, result);
  for (const child of [...(schema.anyOf ?? []), ...(schema.allOf ?? [])]) fields(child, prefix, result);
  if (schema.then) fields(schema.then, prefix, result);
  if (schema.else) fields(schema.else, prefix, result);
  return result;
}
for (const route of sourceRoutes.filter(route => route.module !== 'health')) {
  const path = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'), operation = api.paths[path][route.method.toLowerCase()];
  const contract = text(`server/src/modules/${route.module}/${route.module.toUpperCase()}_FRONTEND.md`);
  const entry = coverage.modules[route.module] ??= { operations: [], requestFields: new Set(), responseFields: new Set() };
  entry.operations.push(`${route.method} ${route.path}`);
  const request = fields(operation.requestBody?.content?.['application/json']?.schema, 'body'), response = new Set();
  for (const value of Object.values(operation.responses)) for (const [mime, media] of Object.entries(value.content ?? {})) if (mime === 'application/json') fields(media.schema, 'response', response);
  for (const parameter of operation.parameters ?? []) if (['path', 'query', 'header'].includes(parameter.in)) request.add(`${parameter.in}.${parameter.name}`);
  for (const [kind, values] of [['requestFields', request], ['responseFields', response]]) for (const field of values) {
    entry[kind].add(field);
    const leaf = field.split('.').at(-1).replace(/\[\]/g, ''), escaped = leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`);
    assert.ok(pattern.test(contract) || pattern.test(shared), `Undocumented ${route.module} field: ${field}`);
  }
}
for (const entry of Object.values(coverage.modules)) for (const key of ['requestFields', 'responseFields']) entry[key] = [...entry[key]].sort();
function insideBundle(path) { return path === destination || path.startsWith(destination + sep); }
function rewrite(content, source, target) {
  return content.replace(/(!?\[[^\]]*\])\(([^)]+)\)/g, (original, label, raw) => {
    const url = raw.replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|#)/.test(url)) return original;
    const [file, ...fragment] = url.split('#');
    const absolute = resolve(dirname(source), decodeURIComponent(file));
    const mapped = mapping.get(absolute) ?? (targets.has(absolute) ? absolute : null);
    if (!mapped) {
      assert.ok(existsSync(absolute), `Broken source link in ${portable(relative(root, source))}: ${raw}`);
      assert.ok(!absolute.endsWith('.md') || absolute === resolve(root, 'AGENTS.md'), `Unpackaged Markdown dependency: ${absolute}`);
      return `${label.replace(/^!?\[|\]$/g, '')} (repository reference: \`${portable(relative(root, absolute))}\`; backend source is not required to read this handoff)`;
    }
    assert.ok(insideBundle(mapped));
    const link = portable(relative(dirname(target), mapped)) || portable(relative(destination, mapped));
    return `${label}(${link}${fragment.length ? '#' + fragment.join('#') : ''})`;
  });
}
const planned = new Map();
for (const [source, target] of mapping) {
  let content = readFileSync(source, 'utf8');
  if (source.endsWith('.md')) {
    content = rewrite(content, source, target);
    if (source !== target) content = `> Packaged copy of \`${portable(relative(root, source))}\`. Maintained from the backend original; do not edit this copy independently.\n\n${content}`;
  }
  planned.set(target, content);
}
const coverageTarget = resolve(destination, 'contract-coverage.json');
planned.set(coverageTarget, JSON.stringify(coverage, null, 2) + '\n');
const inventory = [...planned].map(([target, content]) => ({ file: portable(relative(destination, target)),
  source: target === coverageTarget ? 'Derived from API schemas and module/shared contracts' : portable(relative(root, [...mapping].find(([, output]) => output === target)[0])), sha256: createHash('sha256').update(content).digest('hex') }));
const manifest = { format: 1, modules: modules.length, internalEmailContracts: 1, businessOperations: sourceRoutes.filter(route => route.module !== 'health').length, healthOperations: sourceRoutes.filter(route => route.module === 'health').length,
  sourcePolicy: 'Backend module originals remain authoritative. Packaged copies preserve their complete content, with a provenance banner and internal link rewrites only.',
  files: inventory };
planned.set(resolve(destination, 'handoff-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const [target, content] of planned) {
  if (check) assert.ok(existsSync(target) && readFileSync(target, 'utf8') === content, `Stale/missing handoff: ${portable(relative(root, target))}. Run npm --prefix server run docs:frontend.`);
  else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); }
}
function filesIn(directory) { return readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory() ? filesIn(resolve(directory, item.name)) : [resolve(directory, item.name)]); }
let links = 0, examples = 0;
function anchors(file) {
  const ids = new Set(), duplicates = new Map(); let fenced = false;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = line.match(/^#{1,6}\s+(.+?)(?:\s+#+)?$/)?.[1]; if (!heading) continue;
    const base = heading.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const count = duplicates.get(base) ?? 0; duplicates.set(base, count + 1); ids.add(base + (count ? '-' + count : ''));
  }
  return ids;
}
for (const file of filesIn(destination)) {
  assert.ok(planned.has(file), `Unlisted handoff file: ${portable(relative(destination, file))}. Reconcile the package inventory; do not remove user-authored files merely to pass this check.`);
  if (file.endsWith('.json')) JSON.parse(readFileSync(file, 'utf8'));
  if (!file.endsWith('.md')) continue;
  const content = readFileSync(file, 'utf8');
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const url = match[1].replace(/^<|>$/g, ''); if (/^(?:https?:|mailto:)/.test(url)) continue;
    const [path, fragment] = url.split('#'), target = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
    assert.ok(insideBundle(target), `Link escapes the handoff: ${portable(relative(destination, file))}: ${url}`);
    assert.ok(existsSync(target), `Broken packaged link: ${portable(relative(destination, file))}: ${url}`); links++;
    if (fragment && target.endsWith('.md')) assert.ok(anchors(target).has(decodeURIComponent(fragment)), `Broken heading link: ${portable(relative(destination, file))}: ${url}`);
  }
  for (const match of content.matchAll(/```json\s*([\s\S]*?)```/g)) {
    try { JSON.parse(match[1]); } catch (error) { throw new Error(`Invalid JSON example in ${portable(relative(destination, file))}: ${error.message}`); } examples++;
  }
}
const readiness = text('docs/frontend/integration-readiness.md');
const documented = [...readiness.matchAll(/\| (GET|POST|PUT|PATCH|DELETE) \| `([^`]+)` \| (\w+) \|/g)].map(([, method, path, module]) => `${method} ${path} ${module}`).sort();
assert.deepEqual(documented, sourceRoutes.filter(route => route.module !== 'health').map(route => `${route.method} ${route.path} ${route.module}`).sort());
for (const route of sourceRoutes.filter(route => route.module !== 'health')) assert.ok(modules.includes(route.module), `Unpackaged route owner: ${route.module}`);
console.log(JSON.stringify({ mode: check ? 'check' : 'build', folder: 'docs/frontend', modules: modules.length, internalEmailContracts: 1,
  files: planned.size, localLinks: links, jsonExamples: examples, businessOperations: documented.length, healthOperations: 2, completeCanonicalCopies: true }));
