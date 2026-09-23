import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createSessionToken } from "../functions/_shared/auth.js";
import { onRequestPost as logout } from "../functions/api/admin/logout.js";
import { onRequestGet as session } from "../functions/api/admin/session.js";

const SESSION_SECRET = "a sufficiently long admin session secret";
const ORIGIN = "https://readukrainianapp.com";

function createUsersDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["0001_schema.sql", "0034_security_hardening.sql"]) {
    sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
  sqlite.exec(`
    INSERT INTO users (id, email, password_hash, role) VALUES
      (1, 'admin@example.com', 'unused', 'admin'),
      (2, 'editor@example.com', 'unused', 'editor');
  `);

  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let parameters = [];
      const prepared = {
        bind(...values) {
          parameters = values;
          return prepared;
        },
        async first() {
          return statement.get(...parameters) ?? null;
        },
        async run() {
          const result = statement.run(...parameters);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
      };
      return prepared;
    },
  };
  return { sqlite, db };
}

function context(db, token, method = "GET") {
  return {
    request: new Request(`${ORIGIN}/api/admin/session`, {
      method,
      headers: { cookie: `admin_session=${token}`, origin: ORIGIN },
    }),
    env: { DB: db, SESSION_SECRET },
  };
}

test("the role comes from the database, not from the signed cookie", async () => {
  const { db } = createUsersDatabase();
  const token = await createSessionToken(SESSION_SECRET, {
    userId: 2,
    email: "editor@example.com",
    role: "admin",
    sv: 1,
  });

  const response = await session(context(db, token));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.role, "editor");
  assert.ok(!body.user.permissions.includes("publish"));
});

test("deactivating a user ends their existing sessions", async () => {
  const { sqlite, db } = createUsersDatabase();
  const token = await createSessionToken(SESSION_SECRET, { userId: 1, email: "admin@example.com", role: "admin", sv: 1 });

  assert.equal((await session(context(db, token))).status, 200);
  sqlite.exec("UPDATE users SET is_active = 0 WHERE id = 1");
  assert.equal((await session(context(db, token))).status, 401);
});

test("logout revokes every cookie the user holds, including copies", async () => {
  const { sqlite, db } = createUsersDatabase();
  const laptop = await createSessionToken(SESSION_SECRET, { userId: 1, email: "admin@example.com", role: "admin", sv: 1 });
  const phone = await createSessionToken(SESSION_SECRET, { userId: 1, email: "admin@example.com", role: "admin", sv: 1 });

  const response = await logout(context(db, laptop, "POST"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(sqlite.prepare("SELECT session_version FROM users WHERE id = 1").get().session_version, 2);

  assert.equal((await session(context(db, laptop))).status, 401);
  assert.equal((await session(context(db, phone))).status, 401);

  const fresh = await createSessionToken(SESSION_SECRET, { userId: 1, email: "admin@example.com", role: "admin", sv: 2 });
  assert.equal((await session(context(db, fresh))).status, 200);
});

test("cookies issued before session versions existed stay valid until a logout", async () => {
  const { db } = createUsersDatabase();
  const legacy = await createSessionToken(SESSION_SECRET, { userId: 1, email: "admin@example.com", role: "admin" });

  assert.equal((await session(context(db, legacy))).status, 200);
  await logout(context(db, legacy, "POST"));
  assert.equal((await session(context(db, legacy))).status, 401);
});

test("logout without a valid session still clears the cookie", async () => {
  const { sqlite, db } = createUsersDatabase();
  const response = await logout(context(db, "not-a-token", "POST"));

  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(sqlite.prepare("SELECT MAX(session_version) AS version FROM users").get().version, 1);
});
