import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const root = new URL('../', import.meta.url);
export const spec = JSON.parse(readFileSync(new URL('upstream/render-openapi.json', root)));
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
export const variable = (name) => '${[ ' + name + ' ]}';
const id = (kind, name) => `GENERATE_ID::render_${kind}_${name}`;
const workspaceId = id('workspace', 'build_reuse');

export function resolve(value) {
  if (!value?.$ref) return value;
  if (!value.$ref.startsWith('#/')) throw new Error(`Unsupported external ref: ${value.$ref}`);
  const resolved = value.$ref.slice(2).split('/').reduce((v, k) => v?.[k.replaceAll('~1', '/').replaceAll('~0', '~')], spec);
  if (!resolved) throw new Error(`Unresolved ref: ${value.$ref}`);
  return resolve({ ...resolved, ...Object.fromEntries(Object.entries(value).filter(([k]) => k !== '$ref')) });
}

export function operations() {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item).filter(([method]) => methods.has(method)).map(([method, operation]) => ({ path, method, operation })));
}

export function selectedOperations() {
  return operations().filter(({ path, method }) => path.startsWith('/build-sources') ||
    (path === '/services' && method === 'get') ||
    (path === '/services/{serviceId}' && ['get', 'patch'].includes(method)) ||
    (path === '/services/{serviceId}/deploys' && ['get', 'post'].includes(method)));
}

const createBody = {
  ownerId: variable('ownerId'), name: variable('buildSourceName'),
  git: { repoUrl: variable('repoUrl'), branch: variable('branch'), runtime: variable('runtime'),
    region: variable('region'), buildCommand: variable('buildCommand') },
};

function example(schema, depth = 0) {
  schema = resolve(schema);
  if (!schema || depth > 12) throw new Error('Cannot generate request example');
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum) return schema.enum[0];
  if (schema.oneOf || schema.anyOf) return example((schema.oneOf ?? schema.anyOf)[0], depth + 1);
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map(s => example(s, depth + 1)));
  if (schema.type === 'array') return [example(schema.items, depth + 1)];
  if (schema.type === 'object' || schema.properties) {
    return Object.fromEntries(Object.entries(schema.properties ?? {})
      .filter(([key]) => !schema.required?.length || schema.required.includes(key))
      .filter(([, s]) => !resolve(s).readOnly)
      .map(([key, s]) => [key, example(s, depth + 1)]));
  }
  if (schema.type === 'boolean') return false;
  if (schema.type === 'integer' || schema.type === 'number') return schema.minimum ?? 0;
  return 'REPLACE_ME';
}

function bodyFor(path, method, operation) {
  if (!operation.requestBody) return undefined;
  if (path === '/build-sources' && method === 'post') return createBody;
  if (path === '/build-sources/{buildSourceId}' && method === 'patch') return { name: variable('buildSourceName') };
  if (path === '/services/{serviceId}' && method === 'patch') return { buildSourceId: variable('buildSourceId') };
  if (path === '/services/{serviceId}/deploys' && method === 'post') return { buildId: variable('buildId') };
  const body = resolve(operation.requestBody);
  const schema = body.content?.['application/json']?.schema;
  if (!schema) throw new Error(`No JSON schema for ${method} ${path}`);
  return example(schema);
}

function warning(path, method) {
  if (method === 'delete') return '\n\nDestructive: review the target before sending. A build source must have no linked services before deletion.';
  if (method === 'put' && ['/env-vars', '/secret-files'].some(s => path.endsWith(s))) return '\n\nReplaces the entire collection. Retrieve existing values first and include all entries you want to keep. Trigger a build afterward.';
  if (method === 'patch' && path === '/services/{serviceId}') return '\n\nLinks an existing service and replaces its build configuration. Confirm matching workspace and region, compatible runtime, and an existing start command for native runtimes. Do not include other build settings.';
  return '';
}

function request(key, folderId, path, method, name, description = '', overrides = {}) {
  const operation = spec.paths[path]?.[method];
  if (!operation) throw new Error(`Missing operation ${method} ${path}`);
  const parameters = [...(spec.paths[path].parameters ?? []), ...(operation.parameters ?? [])].map(resolve);
  const query = parameters.filter(p => p.in === 'query').map(p => ({
    name: p.name, value: ['ownerId', 'cursor', 'limit'].includes(p.name) ? variable(p.name) : String(resolve(p.schema)?.default ?? 'REPLACE_ME'),
    enabled: Boolean(p.required || p.name === 'ownerId' || p.name === 'limit'),
  }));
  const body = overrides.body ?? bodyFor(path, method, operation);
  return {
    model: 'http_request', id: id('request', key), workspaceId, folderId,
    name, method: method.toUpperCase(),
    url: variable('baseUrl') + path.replace(/\{([^}]+)\}/g, (_, name) => variable(overrides.pathVariables?.[name] ?? name)),
    urlParameters: query, sortPriority: overrides.sortPriority ?? 0,
    authenticationType: null, authentication: {},
    bodyType: body === undefined ? null : 'application/json',
    body: body === undefined ? {} : { text: JSON.stringify(body, null, 2) },
    headers: body === undefined ? [] : [{ name: 'Content-Type', value: 'application/json', enabled: true }],
    description: [description, operation.description, `Reference: https://api-docs.render.com/reference/${operation.operationId}`].filter(Boolean).join('\n\n') + warning(path, method),
  };
}

export function generate() {
  const variables = {
    baseUrl: spec.servers[0].url, renderApiKey: '', ownerId: 'REPLACE_ME',
    repoUrl: 'https://github.com/REPLACE_ME/REPLACE_ME', branch: 'main',
    runtime: 'node', region: 'oregon', buildCommand: 'REPLACE_ME',
    buildSourceName: 'shared-git-build', buildSourceId: 'REPLACE_ME', buildId: 'REPLACE_ME',
    serviceAId: 'REPLACE_ME', serviceBId: 'REPLACE_ME', serviceId: 'REPLACE_ME',
    envVarKey: 'REPLACE_ME', envGroupId: 'REPLACE_ME', cursor: '', limit: '20',
  };
  const folders = [];
  const folder = (key, name, description) => {
    const folderId = id('folder', key);
    folders.push({ model: 'folder', id: folderId, workspaceId, folderId: null, name, description,
      sortPriority: folders.length, authenticationType: null, authentication: {} });
    return folderId;
  };
  const quickstart = folder('quickstart', '01 · Share one Git build', 'Run requests individually in order. Read README.md first. Set private credentials and edit placeholders. Linking services changes their build configuration.');
  const requests = [];
  const step = (key, path, method, name, description, overrides = {}) => requests.push(request(
    'quickstart_' + key, quickstart, path, method, name, description, { sortPriority: requests.length, ...overrides }));
  step('services', '/services', 'get', '01 · Find your services', 'Choose two supported services in the same workspace and region. Set serviceAId and serviceBId. Preserve their existing build configuration for recovery.');
  for (const [label, v] of [['A', 'serviceAId'], ['B', 'serviceBId']]) {
    step('inspect_' + label, '/services/{serviceId}', 'get', `02${label} · Inspect service ${label}`, 'Confirm region, runtime, start command, runtime environment, and auto-deploy settings before linking.', { pathVariables: { serviceId: v } });
  }
  step('create', '/build-sources', 'post', '03 · Create a Git build source', 'Edit runtime, region, repoUrl, branch, and buildCommand first. Copy response.id to buildSourceId. This example does not link services during creation.');
  step('env', '/build-sources/{buildSourceId}/env-vars', 'get', '04 · Check build-time environment', 'Optional: configure required build variables, secret files, or environment groups using the reference folders before linking. Service runtime variables are separate.');
  for (const [label, v] of [['A', 'serviceAId'], ['B', 'serviceBId']]) {
    step('link_' + label, '/services/{serviceId}', 'patch', `05${label} · Link service ${label}`, 'Run only after inspecting this service. This minimal body retains an existing native start command. If missing, add serviceDetails.startCommand for this service; Docker sources reject a start command.', { pathVariables: { serviceId: v } });
  }
  step('trigger', '/build-sources/{buildSourceId}/builds', 'post', '06 · Trigger the shared build', 'Starts a new build even if one already exists. Copy response.id (not buildRun.id) to buildId. Linked services with auto-deploy enabled deploy the result.');
  step('inspect_build', '/build-sources/{buildSourceId}/builds/{buildId}', 'get', '07 · Check build status', 'Repeat manually until buildRun.status is succeeded. If failed or canceled, inspect the build logs in Render before continuing.');
  for (const [label, v] of [['A', 'serviceAId'], ['B', 'serviceBId']]) {
    step('deploy_' + label, '/services/{serviceId}/deploys', 'post', `08${label} · Deploy shared build to ${label} (optional)`, 'Only needed for manual deployment. Wait for the selected build to succeed. Both requests use the same buildId. Skip if auto-deploy already deployed it.', { pathVariables: { serviceId: v } });
    step('verify_' + label, '/services/{serviceId}/deploys', 'get', `09${label} · Inspect deploys for ${label}`, 'Inspect the latest deploy status and check the service in Render.', { pathVariables: { serviceId: v } });
  }
  const groupIds = {};
  for (const { path, method, operation } of selectedOperations()) {
    const group = !path.startsWith('/build-sources') ? 'Services and deploys' :
      path.includes('env-vars') ? 'Build environment variables' : path.includes('secret-files') ? 'Build secret files' :
      path.includes('env-groups') ? 'Build environment groups' : path.includes('/builds') ? 'Builds' : 'Build sources';
    groupIds[group] ??= folder(group.toLowerCase().replaceAll(' ', '_'), 'Reference · ' + group, 'API reference. Edit example bodies and variables before sending.');
    requests.push(request(operation.operationId, groupIds[group], path, method,
      `${method.toUpperCase()} · ${operation.summary}`, '', { sortPriority: requests.length }));
  }
  return {
    yaakSchema: 5,
    resources: {
      workspaces: [{ model: 'workspace', id: workspaceId, name: 'Render · Build Reuse',
        description: 'Share one Git build across multiple services. Early access API. See README.md for setup.',
        authenticationType: 'bearer', authentication: { token: variable('renderApiKey') }, headers: [] }],
      environments: [{ model: 'environment', id: id('environment', 'base'), workspaceId, name: 'Global Variables',
        parentModel: 'workspace', parentId: null, public: true,
        variables: Object.entries(variables).map(([name, value]) => ({ name, value, enabled: true })) }],
      folders, httpRequests: requests,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = JSON.stringify(generate(), null, 2) + '\n';
  const target = new URL('collections/build-reuse.yaak.json', root);
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== output) throw new Error('Collection is stale. Run npm run generate.');
    console.log('Generated collection is current.');
  } else {
    writeFileSync(target, output);
    console.log(`Generated ${generate().resources.httpRequests.length} requests.`);
  }
}
