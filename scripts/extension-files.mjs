import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const EXTENSION_FILES = ['manifest.json', 'panel.html', 'options.html', 'src', 'icons'];

export async function readClientId() {
  return /LINEAR_CLIENT_ID = '([^']*)'/.exec(await readFile('src/config.js', 'utf8'))[1];
}

// Copies only the files the extension needs to run.
export async function copyExtension(destination, { clientId, stripKey = false } = {}) {
  await rm(destination, { recursive: true, force: true });
  for (const file of EXTENSION_FILES) {
    await cp(file, path.join(destination, file), { recursive: true, filter: source => !source.endsWith('.svg') });
  }
  const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
  if (stripKey) delete manifest.key;
  await writeFile(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (clientId !== undefined) {
    const config = path.join(destination, 'src/config.js');
    await writeFile(config, (await readFile(config, 'utf8')).replace(/LINEAR_CLIENT_ID = '[^']*'/, `LINEAR_CLIENT_ID = '${clientId}'`));
  }
  return manifest;
}
