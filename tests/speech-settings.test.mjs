import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken } from "../functions/_shared/auth.js";
import {
  getSpeechSetting,
  getSpeechVoice,
  saveSpeechSetting,
} from "../functions/_shared/speech-settings.js";
import {
  DEFAULT_SPEECH_VOICE_ID,
  listPublicSpeechVoices,
  resolveSpeechVoice,
} from "../functions/_shared/speech-voices.js";
import {
  onRequestGet,
  onRequestPut,
} from "../functions/api/admin/settings/speech.js";

const SESSION_SECRET = "a sufficiently long test session secret";

class FakeSpeechSettingsDb {
  constructor(row = null) {
    this.row = row;
    this.writes = [];
  }

  prepare(sql) {
    const db = this;
    let parameters = [];

    return {
      bind(...values) {
        parameters = values;
        return this;
      },
      async first() {
        assert.match(sql, /FROM speech_settings/);
        return db.row ? { ...db.row } : null;
      },
      async run() {
        assert.match(sql, /INSERT INTO speech_settings/);
        assert.match(sql, /is_enabled/);
        const [voiceId, enabled, updatedByUserId, updatedByEmail] = parameters;

        db.writes.push({ sql, parameters: [...parameters] });

        db.row = {
          voiceId,
          enabled,
          version: db.row ? db.row.version + 1 : 1,
          updatedAt: "2026-08-05 12:00:00",
          updatedByUserId,
          updatedByEmail,
        };

        return { success: true };
      },
    };
  }
}

async function createContext({
  db = new FakeSpeechSettingsDb(),
  method = "GET",
  role = "admin",
  origin = "https://readukrainianapp.com",
  payload,
  contentType = "application/json",
} = {}) {
  const token = await createSessionToken(SESSION_SECRET, {
    userId: 7,
    email: "admin@example.com",
    role,
  });
  const headers = new Headers({ cookie: `admin_session=${token}` });

  if (origin !== null) {
    headers.set("origin", origin);
  }

  if (contentType !== null) {
    headers.set("content-type", contentType);
  }

  return {
    request: new Request("https://readukrainianapp.com/api/admin/settings/speech", {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
    env: { DB: db, SESSION_SECRET },
  };
}

test("exposes only Google voices without leaking provider configuration", () => {
  assert.equal(DEFAULT_SPEECH_VOICE_ID, "achernar");
  assert.deepEqual(
    listPublicSpeechVoices().map((voice) => voice.id),
    ["achernar"]
  );
  assert.equal(resolveSpeechVoice("achernar").providerVoice, "uk-UA-Chirp3-HD-Achernar");
  for (const retired of ["lada", "mai", "mykyta", "tetiana", "unknown"]) {
    assert.equal(resolveSpeechVoice(retired), null);
  }
  assert.equal("providerVoice" in listPublicSpeechVoices()[0], false);
});

test("falls back to Achernar and disables speech for a missing or invalid enabled setting", async () => {
  const missingDb = new FakeSpeechSettingsDb();
  const missingSetting = await getSpeechSetting(missingDb);
  assert.equal(missingSetting.voiceId, "achernar");
  assert.equal(missingSetting.enabled, false);
  assert.equal((await getSpeechVoice(missingDb)).id, "achernar");

  const invalidDb = new FakeSpeechSettingsDb({
    voiceId: "not-allowed",
    enabled: 1,
    version: 3,
    updatedAt: "2026-08-05 11:00:00",
    updatedByUserId: null,
    updatedByEmail: null,
  });
  assert.equal((await getSpeechSetting(invalidDb)).enabled, true);
  assert.equal((await getSpeechVoice(invalidDb)).id, "achernar");

  const invalidEnabledDb = new FakeSpeechSettingsDb({
    voiceId: "achernar",
    enabled: 2,
    version: 3,
    updatedAt: "2026-08-05 11:00:00",
    updatedByUserId: null,
    updatedByEmail: null,
  });
  const invalidEnabledSetting = await getSpeechSetting(invalidEnabledDb);
  assert.equal(invalidEnabledSetting.voiceId, "achernar");
  assert.equal(invalidEnabledSetting.enabled, false);
});

test("atomically persists voice and enabled state with actor audit data", async () => {
  const db = new FakeSpeechSettingsDb({
    voiceId: "lada",
    enabled: 0,
    version: 4,
    updatedAt: "2026-08-05 11:00:00",
    updatedByUserId: null,
    updatedByEmail: null,
  });
  const enabledSetting = await saveSpeechSetting(db, {
    voiceId: "achernar",
    enabled: true,
  }, {
    userId: 7,
    email: "admin@example.com",
  });

  assert.deepEqual(enabledSetting, {
    voiceId: "achernar",
    enabled: true,
    version: 5,
    updatedAt: "2026-08-05 12:00:00",
    updatedByUserId: 7,
    updatedByEmail: "admin@example.com",
  });
  assert.deepEqual(db.writes[0].parameters, [
    "achernar",
    1,
    7,
    "admin@example.com",
  ]);

  const disabledSetting = await saveSpeechSetting(db, {
    voiceId: "achernar",
    enabled: false,
  }, {
    userId: 7,
    email: "admin@example.com",
  });

  assert.deepEqual(disabledSetting, {
    voiceId: "achernar",
    enabled: false,
    version: 6,
    updatedAt: "2026-08-05 12:00:00",
    updatedByUserId: 7,
    updatedByEmail: "admin@example.com",
  });
  assert.deepEqual(db.writes[1].parameters, [
    "achernar",
    0,
    7,
    "admin@example.com",
  ]);

  await assert.rejects(
    () => saveSpeechSetting(db, { voiceId: "unknown", enabled: true }, {}),
    RangeError
  );
  await assert.rejects(
    () => saveSpeechSetting(db, { voiceId: "achernar", enabled: 1 }, {}),
    TypeError
  );
  assert.equal(db.writes.length, 2);
});

test("GET requires the admin-only settings permission", async () => {
  const editorResponse = await onRequestGet(await createContext({ role: "editor" }));
  assert.equal(editorResponse.status, 403);

  const adminResponse = await onRequestGet(await createContext());
  assert.equal(adminResponse.status, 200);
  assert.equal(adminResponse.headers.get("cache-control"), "no-store");
  const payload = await adminResponse.json();
  assert.equal(payload.setting.voiceId, "achernar");
  assert.equal(payload.setting.enabled, false);
  assert.equal(payload.voices.length, 1);
});

test("PUT enforces same-origin JSON and exactly voiceId plus boolean enabled", async () => {
  const crossOriginResponse = await onRequestPut(
    await createContext({
      method: "PUT",
      origin: "https://example.com",
      payload: { voiceId: "achernar", enabled: true },
    })
  );
  assert.equal(crossOriginResponse.status, 403);

  const wrongTypeResponse = await onRequestPut(
    await createContext({
      method: "PUT",
      contentType: "text/plain",
      payload: { voiceId: "achernar", enabled: true },
    })
  );
  assert.equal(wrongTypeResponse.status, 415);

  const missingEnabledResponse = await onRequestPut(
    await createContext({ method: "PUT", payload: { voiceId: "achernar" } })
  );
  assert.equal(missingEnabledResponse.status, 400);

  const invalidEnabledResponse = await onRequestPut(
    await createContext({
      method: "PUT",
      payload: { voiceId: "achernar", enabled: 1 },
    })
  );
  assert.equal(invalidEnabledResponse.status, 400);

  const extraKeyResponse = await onRequestPut(
    await createContext({
      method: "PUT",
      payload: { voiceId: "achernar", enabled: true, extra: true },
    })
  );
  assert.equal(extraKeyResponse.status, 400);

  const unsupportedResponse = await onRequestPut(
    await createContext({
      method: "PUT",
      payload: { voiceId: "oleksa", enabled: true },
    })
  );
  assert.equal(unsupportedResponse.status, 400);

  const db = new FakeSpeechSettingsDb();
  const successResponse = await onRequestPut(
    await createContext({
      db,
      method: "PUT",
      payload: { voiceId: "achernar", enabled: true },
    })
  );
  assert.equal(successResponse.status, 200);
  assert.equal(successResponse.headers.get("cache-control"), "no-store");
  const successPayload = await successResponse.json();
  assert.equal(successPayload.setting.voiceId, "achernar");
  assert.equal(successPayload.setting.enabled, true);
  assert.equal(successPayload.setting.updatedByEmail, "admin@example.com");

  const disableResponse = await onRequestPut(
    await createContext({
      db,
      method: "PUT",
      payload: { voiceId: "achernar", enabled: false },
    })
  );
  assert.equal(disableResponse.status, 200);
  const disablePayload = await disableResponse.json();
  assert.equal(disablePayload.setting.voiceId, "achernar");
  assert.equal(disablePayload.setting.enabled, false);
  assert.equal(disablePayload.setting.version, 2);
});
