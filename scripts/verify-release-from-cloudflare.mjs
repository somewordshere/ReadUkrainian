import {loadReleaseManifest} from "./lib/release-manifest.mjs";
const release=loadReleaseManifest();
// Bot Fight Mode challenges hosted CI. Keep it enabled and check the public
// domain through Wrangler's authenticated, temporary remote preview instead.
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

if (process.argv.slice(2).join(" ") !== "--remote-preview") throw new Error("Use --remote-preview to start the authenticated Cloudflare verification session.");
const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://127.0.0.1:8791";
const env = { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" };
const preview = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--remote", "--config", "scripts/release-probe/wrangler.jsonc", "--ip", "127.0.0.1", "--port", "8791", "--inspector-port", "0", "--log-level", "warn"], {
  cwd: root, env, stdio: ["ignore", "ignore", "inherit"], windowsHide: true, detached: process.platform !== "win32",
});
const closed = once(preview, "close");
let stopped = false;
async function stop() {
  if (stopped) return;
  stopped = true;
  if (preview.exitCode === null && preview.pid) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(preview.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else { try { process.kill(-preview.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
  }
  await Promise.race([closed, setTimeout(5000)]);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await stop(); process.exit(1); });
try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (preview.exitCode !== null) throw new Error("Authenticated verification preview stopped before it was ready.");
    try {
      const response = await fetch(`${origin}/api/content`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) { await response.body?.cancel(); ready = true; break; }
      await response.body?.cancel();
    } catch { /* Connection and preview initialization can take a few seconds. */ }
    await setTimeout(1000);
  }
  if (!ready) throw new Error("Authenticated verification preview did not become ready within the bounded startup attempts.");
  for (const args of [
    ["scripts/check-live-content.mjs", "--origin", origin, "--deep", "--expect-version", release.version, "--attempts", "4"],
    ["scripts/check-live-dictionary.mjs", "--origin", origin],
  ]) {
    const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit", timeout: 300000, windowsHide: true });
    if (result.status !== 0) throw new Error(`${args[0]} failed.`);
  }
  console.log("Published custom domain verified through an authenticated Cloudflare preview; bot protection remains enabled.");
} finally {
  await stop();
}
