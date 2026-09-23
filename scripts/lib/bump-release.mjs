// Writes the files a release bumps together: package.json and its lock, the
// footer version and changelog deep link, the changelog line, and the release
// manifest data/releases/X.Y.json that check-release-files.mjs validates.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const write = (path, text) => writeFileSync(new URL(path, root), text);

export function currentVersion() {
  return JSON.parse(read("package.json")).version.split(".").slice(0, 2).join(".");
}

export function nextVersion(version = currentVersion()) {
  const [major, minor] = version.split(".").map(Number);
  return `${major}.${String(minor + 1).padStart(2, "0")}`;
}

export function bumpRelease({ version, changelogLine, manifest }) {
  if (!/^\d+\.\d{2}$/.test(version)) throw new Error(`Unexpected release version ${version}`);
  const previous = currentVersion();

  for (const file of ["package.json", "package-lock.json"]) {
    const pkg = JSON.parse(read(file));
    pkg.version = `${version}.0`;
    if (pkg.packages?.[""]) pkg.packages[""].version = `${version}.0`;
    write(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  const log = read("docs/change.log").replace(/\n?$/, "\n");
  const line = `${version} - ${changelogLine}`;
  write("docs/change.log", `${log}${line}\n`);
  const lineNumber = `${log}${line}`.split("\n").length;

  const versionFile = read("public/js/app/version.js");
  const bumped = versionFile
    .replace(`const SITE_VERSION = "${previous}";`, `const SITE_VERSION = "${version}";`)
    .replace(/const CHANGELOG_LINE = \d+;/, `const CHANGELOG_LINE = ${lineNumber};`);
  if (bumped === versionFile || !bumped.includes(`"${version}"`)) {
    throw new Error("public/js/app/version.js did not contain the current version");
  }
  write("public/js/app/version.js", bumped);

  write(`data/releases/${version}.json`, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
}
