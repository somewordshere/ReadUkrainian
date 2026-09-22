import {loadReleaseManifest} from "./lib/release-manifest.mjs";
const release=loadReleaseManifest();
// Bot Fight Mode challenges hosted CI, and since 2026-09-18 also the preview's
// own requests to the public domain. Keep it enabled; the authenticated,
// temporary remote preview reaches the production Worker through a service
// binding instead (scripts/release-probe/wrangler.jsonc).
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

if (process.argv.slice(2).join(" ") !== "--remote-preview") throw new Error("Use --remote-preview to start the authenticated Cloudflare verification session.");
const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://127.0.0.1:8791";
const env = { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" };
const preview = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--remote", "--config", "scripts/release-probe/wrangler.jsonc", "--ip", "127.0.0.1", "--port", "8791", "--inspector-port", "0", "--log-level", "info"], {
  cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32",
});
// Keep Wrangler's recent output so a preview that never starts explains why.
const previewOutput = [];
for (const stream of [preview.stdout, preview.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    previewOutput.push(chunk);
    if (previewOutput.length > 200) previewOutput.shift();
  });
}
const previewLog = () => previewOutput.join("").trim() || "(Wrangler printed nothing)";
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
  // A remote preview uploads the probe to Cloudflare first; allow two minutes.
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) throw new Error(`Authenticated verification preview stopped before it was ready.\n${previewLog()}`);
    let response;
    try {
      response = await fetch(`${origin}/api/content`, { signal: AbortSignal.timeout(2000) });
    } catch { /* Connection and preview initialization can take a few seconds. */ }
    if (response?.ok) { await response.body?.cancel(); ready = true; break; }
    if (response) {
      // The preview is up and production refused it; retrying will not help.
      const body = (await response.text()).replace(/\s+/g, " ").slice(0, 400);
      const headers = ["server", "cf-ray", "cf-mitigated", "content-type"].map((name) => `${name}=${response.headers.get(name)}`).join(" ");
      throw new Error(`Production answered the verification preview with HTTP ${response.status} (${headers}): ${body}\n${previewLog()}`);
    }
    await setTimeout(1000);
  }
  if (!ready) throw new Error(`Authenticated verification preview did not become ready within two minutes.\n${previewLog()}`);
  for (const args of [
    ["scripts/check-live-content.mjs", "--origin", origin, "--deep", "--expect-version", release.version, "--attempts", "4"],
    ["scripts/check-live-dictionary.mjs", "--origin", origin],
  ]) {
    const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit", timeout: 300000, windowsHide: true });
    if (result.status !== 0) throw new Error(`${args[0]} failed.`);
  }
  console.log("Deployed production Worker verified through an authenticated Cloudflare preview; bot protection remains enabled.");
} finally {
  await stop();
}
