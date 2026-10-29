import { execFileSync } from 'node:child_process';
import { mkdir, cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stageExtension } from './release-files.mjs';
if (process.platform !== 'darwin') throw new Error('ZIP packaging currently requires macOS (ditto). Building and unit tests also work on other platforms.');
await mkdir('artifacts', {recursive:true});
const flags = ['-c','-k','--norsrc','--noextattr','--noqtn'];
const staging = await mkdtemp(path.join(os.tmpdir(), 'story-library-package-'));
try {
  const extensionFolder = path.join(staging, 'Story-Library');
  await stageExtension(process.cwd(), extensionFolder);
  // Chrome Web Store requires manifest.json at the ZIP root, without a parent folder.
  execFileSync('/usr/bin/ditto', [...flags, extensionFolder, path.join(staging, 'story-library-chrome-store.zip')]);
  await cp('docs/INSTALL.md', path.join(extensionFolder, 'README.md'));
  await cp('PRIVACY.md', path.join(extensionFolder, 'PRIVACY.md'));
  execFileSync('/usr/bin/ditto', [...flags, '--keepParent', extensionFolder, path.join(staging, 'Story-Library.zip')]);
  // Only the three importer files belong in the companion plugin package.
  const pluginFolder = path.join(staging, 'figma-plugin');
  await mkdir(pluginFolder);
  for (const file of ['manifest.json', 'code.js', 'ui.html']) await cp(path.join('figma-plugin', file), path.join(pluginFolder, file));
  execFileSync('/usr/bin/ditto', [...flags, '--keepParent', pluginFolder, path.join(staging, 'story-library-figma-plugin.zip')]);
  for (const file of ['story-library-chrome-store.zip', 'Story-Library.zip', 'story-library-figma-plugin.zip']) await cp(path.join(staging, file), path.resolve('artifacts', file));
  // Keep previously shared download links pointing to the same named package.
  await cp('artifacts/Story-Library.zip', 'artifacts/story-library-extension.zip');
} finally {
  await rm(staging, { recursive: true, force: true });
}
console.log('artifacts/Story-Library.zip\nartifacts/story-library-chrome-store.zip\nartifacts/story-library-figma-plugin.zip');
