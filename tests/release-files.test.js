import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extensionFiles, stageExtension } from '../scripts/release-files.mjs';

async function fixture(t) {
  const project = await mkdtemp(path.join(os.tmpdir(), 'story-library-release-test-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  await mkdir(path.join(project, 'extension'));
  await mkdir(path.join(project, 'dist/icons'), { recursive: true });
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  await writeFile(path.join(project, 'package.json'), JSON.stringify({ version: manifest.version }));
  await writeFile(path.join(project, 'extension/manifest.json'), JSON.stringify(manifest));
  for (const file of extensionFiles) await writeFile(path.join(project, 'dist', file), file === 'manifest.json' ? JSON.stringify(manifest) : `fixture:${file}`);
  return { project, manifest, output: path.join(project, 'release') };
}

test('release staging excludes stale files, credentials and test harnesses', async t => {
  const { project, output } = await fixture(t);
  for (const file of ['.env', 'README.md', 'test-manifest.json', 'debug.js', 'icons/private.key']) await writeFile(path.join(project, 'dist', file), 'not for distribution');
  await stageExtension(project, output);
  const files = (await readdir(output, { recursive: true })).filter(file => file !== 'icons').map(file => file.split(path.sep).join('/')).sort();
  assert.deepEqual(files, [...extensionFiles].sort());
  assert.equal(await readFile(path.join(output, 'content.js'), 'utf8'), 'fixture:content.js');
});

test('release refuses a test manifest with extra host access', async t => {
  const { project, manifest, output } = await fixture(t);
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(path.join(project, 'dist/manifest.json'), JSON.stringify(manifest));
  await assert.rejects(stageExtension(project, output), /Built manifest differs/);
  await cp(path.join(project, 'dist/manifest.json'), path.join(project, 'extension/manifest.json'));
  await assert.rejects(stageExtension(project, output), /Unexpected release manifest field: host_permissions/);
});

test('release refuses version drift and missing runtime files', async t => {
  const { project, manifest, output } = await fixture(t);
  await writeFile(path.join(project, 'package.json'), JSON.stringify({ version: '99.0.0' }));
  await assert.rejects(stageExtension(project, output), /versions must match/);
  await writeFile(path.join(project, 'package.json'), JSON.stringify({ version: manifest.version }));
  await rm(path.join(project, 'dist/content.js'));
  await assert.rejects(stageExtension(project, output), /ENOENT/);
});

test('release refuses symlinked assets', async t => {
  const { project, output } = await fixture(t);
  await rm(path.join(project, 'dist/icons/icon16.png'));
  await symlink(path.join(project, 'package.json'), path.join(project, 'dist/icons/icon16.png'));
  await assert.rejects(stageExtension(project, output), /must be a regular file/);
});
