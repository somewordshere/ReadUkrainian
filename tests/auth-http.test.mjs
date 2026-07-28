import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import test from "node:test";

import {
  createSessionToken,
  getPermissionsForRole,
  readSessionToken,
  verifyPassword,
} from "../functions/_shared/auth.js";
import { getCookie } from "../functions/_shared/http.js";

function toBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

test("verifies valid password hashes and rejects incorrect or malformed hashes", async () => {
  const password = "correct horse battery staple";
  const salt = Buffer.from("0123456789abcdef");
  const iterations = 100000;
  const derived = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const storedHash = [
    "pbkdf2_sha256",
    iterations,
    toBase64Url(salt),
    toBase64Url(derived),
  ].join("$");

  assert.equal(await verifyPassword(password, storedHash), true);
  assert.equal(await verifyPassword("wrong password", storedHash), false);
  assert.equal(await verifyPassword(password, `${storedHash}broken`), false);
  assert.equal(await verifyPassword(password, "not-a-password-hash"), false);
});

test("round-trips session tokens and safely rejects tampering", async () => {
  const secret = "a sufficiently long test secret";
  const token = await createSessionToken(secret, {
    userId: 42,
    email: "admin@example.com",
    role: "admin",
  });

  const session = await readSessionToken(secret, token);
  assert.equal(session.userId, 42);
  assert.equal(session.email, "admin@example.com");
  assert.equal(await readSessionToken(secret, `${token}broken`), null);
  assert.equal(await readSessionToken(secret, "%%%invalid.%%%invalid"), null);
});

test("returns null for malformed encoded cookies instead of throwing", () => {
  const request = new Request("https://example.com", {
    headers: { cookie: "admin_session=%E0%A4%A; theme=dark" },
  });

  assert.equal(getCookie(request, "admin_session"), null);
  assert.equal(getCookie(request, "theme"), "dark");
});

test("maps editor roles to least-privilege server permissions", () => {
  assert.deepEqual(getPermissionsForRole("editor"), ["read", "edit"]);
  assert.deepEqual(getPermissionsForRole("publisher"), ["read", "edit", "publish", "restore"]);
  assert.deepEqual(getPermissionsForRole("admin"), ["read", "edit", "publish", "restore"]);
  assert.deepEqual(getPermissionsForRole("unknown"), []);
});
