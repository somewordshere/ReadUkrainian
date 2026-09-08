// Copies only the private curriculum. Git operations remain explicit in the runbook.
import { readdir, readFile, mkdir, copyFile, unlink, lstat, realpath } from "node:fs/promises";
import { resolve, dirname, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
if (args.length !== 2 || !["--sync", "--verify"].includes(args[0])) throw new Error("Use --sync or --verify followed by a private backup checkout directory.");
const source = resolve(root, "prompts");
const checkout = await realpath(resolve(args[1]));
const target = resolve(checkout, "prompts");
if (checkout === root || checkout.startsWith(source + sep)) throw new Error("Backup must be separate from the source curriculum.");
await lstat(resolve(checkout, ".git"));

async function files(base, dir = base) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Symlinks are not allowed in a curriculum backup.");
    if (entry.isDirectory()) result.push(...await files(base, path));
    else if (entry.isFile()) result.push(relative(base, path));
  }
  return result.sort();
}
const names = await files(source);
assert.ok(names.length, "Refusing an empty source curriculum");
if (args[0] === "--sync") {
  await mkdir(target, { recursive: true });
  assert.equal(await realpath(target), target, "Backup target must not redirect outside the checkout");
  for (const name of await files(target)) {
    if (!names.includes(name)) {
      const path = resolve(target, name);
      assert.ok(path.startsWith(target + sep));
      await unlink(path);
    }
  }
  for (const name of names) {
    await mkdir(dirname(resolve(target, name)), { recursive: true });
    await copyFile(resolve(source, name), resolve(target, name));
  }
}
assert.deepEqual(await files(target), names, "Backup file list differs");
const hash = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
for (const name of names) assert.equal(await hash(resolve(target, name)), await hash(resolve(source, name)), `Backup differs: ${name}`);
console.log(`Verified ${names.length} curriculum files byte for byte.`);
