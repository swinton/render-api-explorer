import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const url = 'https://api-docs.render.com/v1.0/openapi/render-public-api-1.json';
const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`Spec download failed: ${response.status}`);
const text = await response.text();
const spec = JSON.parse(text);
if (!spec.openapi || !spec.paths?.['/build-sources'] || spec.servers?.[0]?.url !== 'https://api.render.com/v1') {
  throw new Error('Unexpected Render specification; leaving the snapshot unchanged.');
}
writeFileSync(new URL('../upstream/render-openapi.json', import.meta.url), text);
writeFileSync(new URL('../upstream/source.json', import.meta.url), JSON.stringify({
  url, retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update(text).digest('hex'),
}, null, 2) + '\n');
console.log('Updated snapshot. Run npm run generate and npm test, then review the diff.');
