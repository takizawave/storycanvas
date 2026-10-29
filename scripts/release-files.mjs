import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// An allowlist keeps local reports, test harnesses and stale build files out of releases.
export const extensionFiles = Object.freeze([
  'manifest.json', 'background.js', 'content.js', 'popup.js', 'popup.html', 'popup.css',
  'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png',
]);

export async function stageExtension(project, destination) {
  const json = async file => JSON.parse(await readFile(path.join(project, file), 'utf8'));
  const source = await json('extension/manifest.json');
  const built = await json('dist/manifest.json');
  const pkg = await json('package.json');
  assert.deepEqual(built, source, 'Built manifest differs from source; run npm run build first.');
  assert.equal(built.manifest_version, 3, 'Release must use Manifest V3.');
  assert.equal(built.version, pkg.version, 'Package and manifest versions must match.');
  assert.deepEqual([...built.permissions].sort(), ['activeTab', 'clipboardWrite', 'scripting', 'storage'], 'Review release permissions before packaging.');
  for (const key of ['host_permissions', 'optional_host_permissions', 'optional_permissions', 'content_scripts', 'externally_connectable', 'web_accessible_resources', 'key', 'update_url']) {
    assert.equal(built[key], undefined, `Unexpected release manifest field: ${key}`);
  }
  assert.equal(built.background?.service_worker, 'background.js');
  assert.equal(built.action?.default_popup, 'popup.html');
  assert.deepEqual(built.icons, { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' });
  assert.equal(built.content_security_policy?.extension_pages, "script-src 'self'; object-src 'self'");
  assert.ok(built.description?.length > 0 && built.description.length <= 132, 'Description must contain 1–132 characters.');

  // Read everything before writing, and reject links to files outside the build.
  for (const directory of ['dist', 'dist/icons']) {
    assert.ok((await lstat(path.join(project, directory))).isDirectory(), `${directory} must be a real directory.`);
  }
  const files = await Promise.all(extensionFiles.map(async file => {
    const sourcePath = path.join(project, 'dist', file);
    assert.ok((await lstat(sourcePath)).isFile(), `${file} must be a regular file.`);
    return [file, await readFile(sourcePath)];
  }));
  for (const [file, content] of files) {
    const target = path.join(destination, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}
