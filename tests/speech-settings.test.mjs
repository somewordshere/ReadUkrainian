import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken } from "../functions/_shared/auth.js";
import {
  getSpeechSetting,
  getSpeechVoice,
  saveSpeechVoice,
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
        const [voiceId, updatedByUserId, updatedByEmail] = parameters;

        db.row = {
          voiceId,
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

test("exposes only catalog-backed Ukrainian voices without leaking provider configuration", () => {
  assert.equal(DEFAULT_SPEECH_VOICE_ID, "lada");
  assert.deepEqual(
    listPublicSpeechVoices().map((voice) => voice.id),
    ["lada", "mai"]
  );
  assert.equal(resolveSpeechVoice("lada").providerModel, "piper");
  assert.equal(resolveSpeechVoice("lada").providerVoice, "uk_UA-lada-x_low");
  assert.equal(resolveSpeechVoice("lada").providerFormat, "mp3");
  assert.equal(resolveSpeechVoice("mai").providerModel, "vits");
  assert.equal(resolveSpeechVoice("mai").providerVoice, "mai_uk");
  assert.equal(resolveSpeechVoice("mai").providerFormat, "wav");
  assert.equal(resolveSpeechVoice("mykyta"), null);
  assert.equal(resolveSpeechVoice("tetiana"), null);
  assert.equal(resolveSpeechVoice("unknown"), null);
  const providerTuples = listPublicSpeechVoices().map(({ id }) => {
    const voice = resolveSpeechVoice(id);
    assert.equal("speaker" in voice, false);
    assert.equal("speakerId" in voice, false);
    return JSON.stringify([
      voice.providerModel,
      voice.providerVoice,
      voice.providerFormat,
    ]);
  });
  assert.equal(new Set(providerTuples).size, providerTuples.length);
  assert.equal("providerModel" in listPublicSpeechVoices()[0], false);
  assert.equal("providerVoice" in listPublicSpeechVoices()[0], false);
  assert.equal("providerFormat" in listPublicSpeechVoices()[0], false);
});

test("falls back to Lada for a missing or invalid persisted setting", async () => {
  const missingDb = new FakeSpeechSettingsDb();
  assert.equal((await getSpeechSetting(missingDb)).voiceId, "lada");
  assert.equal((await getSpeechVoice(missingDb)).id, "lada");

  const invalidDb = new FakeSpeechSettingsDb({
    voiceId: "not-allowed",
    version: 3,
    updatedAt: "2026-08-05 11:00:00",
    updatedByUserId: null,
    updatedByEmail: null,
  });
  assert.equal((await getSpeechVoice(invalidDb)).id, "lada");
});

test("persists an allowlisted voice with actor audit data and increments its version", async () => {
  const db = new FakeSpeechSettingsDb({
    voiceId: "lada",
    version: 4,
    updatedAt: "2026-08-05 11:00:00",
    updatedByUserId: null,
    updatedByEmail: null,
  });
  const setting = await saveSpeechVoice(db, "mai", {
    userId: 7,
    email: "admin@example.com",
  });

  assert.deepEqual(setting, {
    voiceId: "mai",
    version: 5,
    updatedAt: "2026-08-05 12:00:00",
    updatedByUserId: 7,
    updatedByEmail: "admin@example.com",
  });
  await assert.rejects(() => saveSpeechVoice(db, "unknown", {}), RangeError);
});

test("GET requires the admin-only settings permission", async () => {
  const editorResponse = await onRequestGet(await createContext({ role: "editor" }));
  assert.equal(editorResponse.status, 403);

  const adminResponse = await onRequestGet(await createContext());
  assert.equal(adminResponse.status, 200);
  assert.equal(adminResponse.headers.get("cache-control"), "no-store");
  const payload = await adminResponse.json();
  assert.equal(payload.setting.voiceId, "lada");
  assert.equal(payload.voices.length, 2);
});

test("PUT enforces same-origin JSON and an exact allowlisted voiceId payload", async () => {
  const crossOriginResponse = await onRequestPut(
    await createContext({ method: "PUT", origin: "https://example.com", payload: { voiceId: "mai" } })
  );
  assert.equal(crossOriginResponse.status, 403);

  const wrongTypeResponse = await onRequestPut(
    await createContext({ method: "PUT", contentType: "text/plain", payload: { voiceId: "mai" } })
  );
  assert.equal(wrongTypeResponse.status, 415);

  const extraKeyResponse = await onRequestPut(
    await createContext({ method: "PUT", payload: { voiceId: "mai", extra: true } })
  );
  assert.equal(extraKeyResponse.status, 400);

  const unsupportedResponse = await onRequestPut(
    await createContext({ method: "PUT", payload: { voiceId: "oleksa" } })
  );
  assert.equal(unsupportedResponse.status, 400);

  const db = new FakeSpeechSettingsDb();
  const successResponse = await onRequestPut(
    await createContext({ db, method: "PUT", payload: { voiceId: "mai" } })
  );
  assert.equal(successResponse.status, 200);
  assert.equal(successResponse.headers.get("cache-control"), "no-store");
  const successPayload = await successResponse.json();
  assert.equal(successPayload.setting.voiceId, "mai");
  assert.equal(successPayload.setting.updatedByEmail, "admin@example.com");
});
