import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { generate, operations, resolve, root, selectedOperations, spec, variable } from '../scripts/generate.mjs';

const output = generate();
const { workspaces, environments, folders, httpRequests } = output.resources;
const guide = httpRequests.filter(r => r.folderId.endsWith('_quickstart'));
const reference = httpRequests.filter(r => !guide.includes(r));

test('snapshot has matching provenance and all local references resolve', () => {
  const provenance = JSON.parse(readFileSync(new URL('upstream/source.json', root)));
  const bytes = readFileSync(new URL('upstream/render-openapi.json', root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.sha256);
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) assert.ok(resolve(value));
    Object.values(value).forEach(walk);
  }
  walk(spec);
});

test('every build-source operation has exactly one reference request', () => {
  const required = operations().filter(o => o.path.startsWith('/build-sources'));
  assert.ok(required.length >= 20);
  assert.equal(reference.length, selectedOperations().length);
  for (const { operation, method, path } of required) {
    const requests = reference.filter(r => r.id.endsWith('_' + operation.operationId));
    assert.equal(requests.length, 1, operation.operationId);
    assert.equal(requests[0].method, method.toUpperCase());
    assert.equal(requests[0].url, variable('baseUrl') + path.replace(/\{([^}]+)\}/g, (_, n) => variable(n)));
  }
});

test('import relationships and every template variable resolve', () => {
  assert.equal(output.yaakSchema, 5);
  const resources = Object.values(output.resources).flat();
  const ids = new Set(resources.map(r => r.id));
  assert.equal(ids.size, resources.length);
  const names = new Set(environments[0].variables.map(v => v.name));
  for (const resource of resources) {
    if (resource.workspaceId) assert.equal(resource.workspaceId, workspaces[0].id);
    if (resource.folderId) assert.ok(folders.some(f => f.id === resource.folderId));
    for (const [, name] of JSON.stringify(resource).matchAll(/\$\{\[\s*(\w+)\s*\]\}/g)) {
      assert.ok(names.has(name), `Undefined variable ${name}`);
    }
  }
  assert.equal(environments[0].parentModel, 'workspace');
  assert.equal(environments[0].variables.find(v => v.name === 'renderApiKey').value, '');
  assert.equal(workspaces[0].authenticationType, 'bearer');
  assert.equal(workspaces[0].authentication.token, variable('renderApiKey'));
  for (const request of httpRequests) assert.equal(request.authenticationType, null);
});

test('walkthrough links two distinct services and deploys the same build', () => {
  const links = guide.filter(r => r.method === 'PATCH');
  const deploys = guide.filter(r => r.method === 'POST' && r.url.endsWith('/deploys'));
  assert.equal(links.length, 2);
  assert.equal(deploys.length, 2);
  assert.notEqual(links[0].url, links[1].url);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(JSON.parse(links[i].body.text), { buildSourceId: variable('buildSourceId') });
    assert.deepEqual(JSON.parse(deploys[i].body.text), { buildId: variable('buildId') });
    assert.equal(links[i].url + '/deploys', deploys[i].url);
  }
  const trigger = guide.find(r => r.method === 'POST' && r.url.endsWith('/builds'));
  const check = guide.find(r => r.url.endsWith('/builds/' + variable('buildId')));
  assert.ok(links.every(r => r.sortPriority < trigger.sortPriority));
  assert.ok(check.sortPriority > trigger.sortPriority);
  assert.ok(deploys.every(r => r.sortPriority > check.sortPriority));
  assert.match(check.description, /succeeded/);
  assert.match(trigger.description, /not buildRun.id/);
});

test('create example uses the upstream Git schema and excludes conflicting image configuration', () => {
  const create = guide.find(r => r.method === 'POST' && r.url.endsWith('/build-sources'));
  const body = JSON.parse(create.body.text);
  const schema = spec.paths['/build-sources'].post.requestBody.content['application/json'].schema;
  for (const key of schema.required) assert.ok(key in body);
  for (const key of Object.keys(body)) assert.ok(key in schema.properties);
  for (const key of schema.properties.git.required) assert.ok(key in body.git);
  for (const key of Object.keys(body.git)) assert.ok(key in schema.properties.git.properties);
  assert.equal(body.git.repoUrl, variable('repoUrl'));
  assert.equal(body.image, undefined);
  assert.equal(body.serviceIds, undefined);
  for (const key of ['runtime', 'region']) {
    const value = environments[0].variables.find(v => v.name === key).value;
    assert.ok(schema.properties.git.properties[key].enum.includes(value));
  }
});

test('replacement and deletion operations explain effects; cursor starts disabled', () => {
  for (const request of reference) {
    if (request.method === 'DELETE') assert.match(request.description, /Destructive/);
    if (request.method === 'PUT' && /\/(env-vars|secret-files)$/.test(request.url)) {
      assert.match(request.description, /Replaces the entire collection/);
    }
    const cursor = request.urlParameters.find(p => p.name === 'cursor');
    if (cursor) assert.equal(cursor.enabled, false);
    if (request.bodyType) assert.doesNotThrow(() => JSON.parse(request.body.text));
  }
});
