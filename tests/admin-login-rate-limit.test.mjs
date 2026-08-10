import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost as login } from "../functions/api/admin/login.js";

function loginRequest(body = { email: "admin@example.com", password: "password" }) {
  return new Request("https://example.com/api/admin/login", {
    method: "POST",
    headers: {
      "cf-connecting-ip": "203.0.113.8",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("admin login rejects a throttled client before querying D1", async () => {
  let limiterKey = "";
  let databaseTouched = false;
  const response = await login({
    request: loginRequest(),
    env: {
      ADMIN_LOGIN_RATE_LIMITER: {
        async limit({ key }) {
          limiterKey = key;
          return { success: false };
        },
      },
      DB: {
        prepare() {
          databaseTouched = true;
          throw new Error("D1 should not be queried for a throttled request.");
        },
      },
    },
  });

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(limiterKey, "admin-login:203.0.113.8");
  assert.equal(databaseTouched, false);
});

test("invalid login input does not consume the login rate limit", async () => {
  let limiterTouched = false;
  const response = await login({
    request: loginRequest({ email: "", password: "" }),
    env: {
      ADMIN_LOGIN_RATE_LIMITER: {
        async limit() {
          limiterTouched = true;
          return { success: true };
        },
      },
    },
  });

  assert.equal(response.status, 400);
  assert.equal(limiterTouched, false);
});

test("oversized or non-JSON login bodies are rejected before the limiter", async () => {
  let limiterTouched = false;
  const env = {
    ADMIN_LOGIN_RATE_LIMITER: {
      async limit() {
        limiterTouched = true;
        return { success: true };
      },
    },
  };
  const oversizedResponse = await login({
    request: loginRequest({
      email: "admin@example.com",
      password: "x".repeat(3 * 1024),
    }),
    env,
  });
  const wrongTypeResponse = await login({
    request: new Request("https://example.com/api/admin/login", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not json",
    }),
    env,
  });

  assert.equal(oversizedResponse.status, 413);
  assert.equal(wrongTypeResponse.status, 415);
  assert.equal(limiterTouched, false);
});
