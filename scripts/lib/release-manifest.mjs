import { readFileSync } from 'node:fs';
export function loadReleaseManifest(version) {
  const pkg=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
  const selected=version ?? pkg.version.split('.').slice(0,2).join('.');
  if(!/^\d+\.\d+$/.test(selected))throw new Error('Release version must be MAJOR.MINOR');
  const manifest=JSON.parse(readFileSync(new URL(`../../data/releases/${selected}.json`,import.meta.url),'utf8'));
  if(manifest.version!==selected)throw new Error('Release manifest version mismatch');
  return manifest;
}
