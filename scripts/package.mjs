import { execFileSync } from 'node:child_process';
import { mkdir, cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stageExtension } from './release-files.mjs';
if (process.platform !== 'darwin') throw new Error('ZIP packaging currently requires macOS (ditto). Building and unit tests also work on other platforms.');
await mkdir('artifacts', {recursive:true});
const flags = ['-c','-k','--norsrc','--noextattr','--noqtn'];
const staging = await mkdtemp(path.join(os.tmpdir(), 'storycanvas-package-'));
try {
  const extensionFolder = path.join(staging, 'storycanvas');
  await stageExtension(process.cwd(), extensionFolder);
  await cp('LICENSE', path.join(extensionFolder, 'LICENSE'));
  // Chrome Web Store requires manifest.json at the ZIP root, without a parent folder.
  execFileSync('/usr/bin/ditto', [...flags, extensionFolder, path.join(staging, 'storycanvas-chrome-store.zip')]);
  await cp('docs/INSTALL.md', path.join(extensionFolder, 'README.md'));
  await cp('PRIVACY.md', path.join(extensionFolder, 'PRIVACY.md'));
  execFileSync('/usr/bin/ditto', [...flags, '--keepParent', extensionFolder, path.join(staging, 'storycanvas.zip')]);
  // Include the importer files and their license in the companion package.
  const pluginFolder = path.join(staging, 'figma-plugin');
  await mkdir(pluginFolder);
  for (const file of ['manifest.json', 'code.js', 'ui.html']) await cp(path.join('figma-plugin', file), path.join(pluginFolder, file));
  await cp('LICENSE', path.join(pluginFolder, 'LICENSE'));
  execFileSync('/usr/bin/ditto', [...flags, '--keepParent', pluginFolder, path.join(staging, 'storycanvas-figma-plugin.zip')]);
  for (const file of ['storycanvas-chrome-store.zip', 'storycanvas.zip', 'storycanvas-figma-plugin.zip']) await cp(path.join(staging, file), path.resolve('artifacts', file));
  // Previously shared filenames remain aliases for the renamed packages.
  for (const [current, previous] of [
    ['storycanvas.zip', 'Story-Library.zip'],
    ['storycanvas.zip', 'story-library-extension.zip'],
    ['storycanvas-chrome-store.zip', 'story-library-chrome-store.zip'],
    ['storycanvas-figma-plugin.zip', 'story-library-figma-plugin.zip'],
  ]) await cp(path.join('artifacts', current), path.join('artifacts', previous));
} finally {
  await rm(staging, { recursive: true, force: true });
}
console.log('artifacts/storycanvas.zip\nartifacts/storycanvas-chrome-store.zip\nartifacts/storycanvas-figma-plugin.zip');
