import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ROUTE, apply } from '../index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const client = readFileSync(join(root, 'client.js'), 'utf8');
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
const literal = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

assert.equal(ROUTE, '/api/dsh-token-burned.snapshot');
assert.equal(typeof apply, 'function');

// The runtime keys every client entry by its **package name**: the boot graph
// row id is the resolved package name, and `__ModuleLoader__.load({ id })` must
// match it or the bundle "loads without registering" and the dock never mounts.
assert.match(client, new RegExp(`id:\\s*'${literal(pkg.name)}'`),
  `client.js must register ModuleLoader id '${pkg.name}' (the package name)`);

// The host half is mounted from the profile's patch layer; its `name` must be
// the installed package name too, otherwise the row cannot be resolved.
assert.match(patch, new RegExp(`name:\\s*'?${literal(pkg.name)}'?`),
  `cordis.patch.yml must insert package '${pkg.name}'`);

// dsh.client requires an `apply` export on the object form; a `setup` method is
// rejected with "invalid plugin, expect function or object with an apply method".
assert.match(client, /return\s*\{\s*apply\s*,/, 'client.js must export an apply function');
assert.match(client, /inject:\s*\['slots'\]/, "client.js must declare inject ['slots']");

// Client bundle must be reachable through the exports map the scanner reads.
assert.equal(pkg.exports?.['./client'], './client.js');
assert.equal(pkg.dsh?.client?.platform, 'web');
assert.ok(pkg.dsh?.bundle?.patch, 'dsh.bundle.patch is required for installability');

console.log('token-burned smoke: PASS');
