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
  resolveSpeechVoice,
} from "../functions/_shared/speech-voices.js";
import {
  onPreviewPost,
  onRequestGet,
  onRequestPut,
  onVoiceOptionPut,
} from "../functions/api/admin/settings/speech.js";

const SESSION_SECRET = "a sufficiently long test session secret";
const ACHERNAR = "uk-UA-Chirp3-HD-Achernar";
const PUCK = "uk-UA-Chirp3-HD-Puck";
const WAVENET = "uk-UA-Wavenet-B";
const MP3 = [0xff, 0xfb, 1, 2, 3];

class FakeSpeechSettingsDb {
  constructor(row = null, enabledVoices = [ACHERNAR]) {
    this.row = row;
    this.options = new Map(enabledVoices.map((voiceId) => [voiceId, 1]));
    this.writes = [];
    this.optionWrites = [];
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
      async all() {
        assert.match(sql, /FROM speech_voice_options WHERE is_enabled = 1/);
        return {
          results: [...db.options]
            .filter(([, enabled]) => enabled === 1)
            .map(([voiceId]) => ({ voiceId })),
        };
      },
      async run() {
        if (sql.includes("INSERT INTO speech_voice_options")) {
          const [voiceId, enabled, updatedByEmail] = parameters;
          db.optionWrites.push([voiceId, enabled, updatedByEmail]);
          db.options.set(voiceId, enabled);
          return { success: true };
        }

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

function googleCatalogFetch(calls = []) {
  return async (url, init) => {
    calls.push([String(url), init]);
    if (String(url).includes("/voices")) {
      return Response.json({
        voices: [
          { name: PUCK, ssmlGender: "MALE" },
          { name: WAVENET, ssmlGender: "FEMALE" },
          { name: ACHERNAR, ssmlGender: "FEMALE" },
          { name: "en-US-Chirp3-HD-Puck", ssmlGender: "MALE" },
        ],
      });
    }
    return Response.json({ audioContent: Buffer.from(MP3).toString("base64") });
  };
}

async function createContext({
  db = new FakeSpeechSettingsDb(),
  method = "GET",
  role = "admin",
  origin = "https://readukrainianapp.com",
  payload,
  contentType = "application/json",
  fetch = googleCatalogFetch(),
  googleKey = "test-key",
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
    env: { DB: db, SESSION_SECRET, GOOGLE_TTS_API_KEY: googleKey },
    fetch,
  };
}

test("accepts only Ukrainian Google voice names", () => {
  assert.equal(DEFAULT_SPEECH_VOICE_ID, ACHERNAR);
  assert.deepEqual(resolveSpeechVoice(ACHERNAR), {
    id: ACHERNAR,
    providerVoice: ACHERNAR,
    label: "Achernar",
    family: "Chirp 3 HD",
  });
  assert.equal(resolveSpeechVoice(WAVENET).family, "WaveNet");
  for (const rejected of [
    "lada", "mai", "achernar", "en-US-Chirp3-HD-Puck",
    "uk-UA-Chirp3-HD-../escape", "uk-UA-Chirp3-HD-", "uk-UA-Studio-A", null,
  ]) {
    assert.equal(resolveSpeechVoice(rejected), null);
  }
});

test("falls back to the default voice and disables speech for a missing or invalid enabled setting", async () => {
  const missingDb = new FakeSpeechSettingsDb();
  const missingSetting = await getSpeechSetting(missingDb);
  assert.equal(missingSetting.voiceId, ACHERNAR);
  assert.equal(missingSetting.enabled, false);
  assert.equal((await getSpeechVoice(missingDb)).id, ACHERNAR);

  const retiredDb = new FakeSpeechSettingsDb({ voiceId: "lada", enabled: 1, version: 3 });
  assert.equal((await getSpeechSetting(retiredDb)).enabled, true);
  assert.equal((await getSpeechVoice(retiredDb)).id, ACHERNAR);

  const invalidEnabledDb = new FakeSpeechSettingsDb({ voiceId: PUCK, enabled: 2, version: 3 });
  const invalidEnabledSetting = await getSpeechSetting(invalidEnabledDb);
  assert.equal(invalidEnabledSetting.voiceId, PUCK);
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
  const enabledSetting = await saveSpeechSetting(db, { voiceId: ACHERNAR, enabled: true }, {
    userId: 7,
    email: "admin@example.com",
  });

  assert.deepEqual(enabledSetting, {
    voiceId: ACHERNAR,
    enabled: true,
    version: 5,
    updatedAt: "2026-08-05 12:00:00",
    updatedByUserId: 7,
    updatedByEmail: "admin@example.com",
  });
  assert.deepEqual(db.writes[0].parameters, [ACHERNAR, 1, 7, "admin@example.com"]);

  await assert.rejects(
    () => saveSpeechSetting(db, { voiceId: "unknown", enabled: true }, {}),
    RangeError
  );
  await assert.rejects(
    () => saveSpeechSetting(db, { voiceId: ACHERNAR, enabled: 1 }, {}),
    TypeError
  );
  assert.equal(db.writes.length, 1);
});

test("GET lists Google's Ukrainian voices with the shortlist and site voice", async () => {
  const editorResponse = await onRequestGet(await createContext({ role: "editor" }));
  assert.equal(editorResponse.status, 403);

  const calls = [];
  const adminResponse = await onRequestGet(await createContext({ fetch: googleCatalogFetch(calls) }));
  assert.equal(adminResponse.status, 200);
  assert.equal(adminResponse.headers.get("cache-control"), "no-store");
  const payload = await adminResponse.json();
  assert.equal(payload.setting.voiceId, ACHERNAR);
  assert.equal(payload.catalogError, null);
  assert.deepEqual(payload.voices, [
    { id: ACHERNAR, label: "Achernar", family: "Chirp 3 HD", gender: "female", enabled: true, site: true },
    { id: PUCK, label: "Puck", family: "Chirp 3 HD", gender: "male", enabled: false, site: false },
    { id: WAVENET, label: "B", family: "WaveNet", gender: "female", enabled: false, site: false },
  ]);
  assert.equal(calls[0][1].headers["x-goog-api-key"], "test-key");

  const offline = await onRequestGet(await createContext({
    fetch: async () => new Response("down", { status: 503 }),
  }));
  const offlinePayload = await offline.json();
  assert.match(offlinePayload.catalogError, /HTTP 503/);
  assert.deepEqual(offlinePayload.voices.map((voice) => voice.id), [ACHERNAR]);
});

test("PUT enforces same-origin JSON and exactly voiceId plus boolean enabled", async () => {
  const cases = [
    [{ origin: "https://example.com", payload: { voiceId: ACHERNAR, enabled: true } }, 403],
    [{ contentType: "text/plain", payload: { voiceId: ACHERNAR, enabled: true } }, 415],
    [{ payload: { voiceId: ACHERNAR } }, 400],
    [{ payload: { voiceId: ACHERNAR, enabled: 1 } }, 400],
    [{ payload: { voiceId: ACHERNAR, enabled: true, extra: true } }, 400],
    [{ payload: { voiceId: "oleksa", enabled: true } }, 400],
  ];
  for (const [options, status] of cases) {
    const response = await onRequestPut(await createContext({ method: "PUT", ...options }));
    assert.equal(response.status, status, JSON.stringify(options));
  }

  const db = new FakeSpeechSettingsDb();
  const successResponse = await onRequestPut(
    await createContext({ db, method: "PUT", payload: { voiceId: ACHERNAR, enabled: true } })
  );
  assert.equal(successResponse.status, 200);
  const successPayload = await successResponse.json();
  assert.equal(successPayload.setting.voiceId, ACHERNAR);
  assert.equal(successPayload.setting.enabled, true);
  assert.equal(successPayload.setting.updatedByEmail, "admin@example.com");
});

test("only an enabled voice can become the site voice", async () => {
  const db = new FakeSpeechSettingsDb({ voiceId: ACHERNAR, enabled: 1, version: 1 });
  const refused = await onRequestPut(
    await createContext({ db, method: "PUT", payload: { voiceId: PUCK, enabled: true } })
  );
  assert.equal(refused.status, 409);
  assert.equal(db.writes.length, 0);

  const enable = await onVoiceOptionPut(
    await createContext({ db, method: "PUT", payload: { voiceId: PUCK, enabled: true } })
  );
  assert.equal(enable.status, 200);
  assert.deepEqual(db.optionWrites, [[PUCK, 1, "admin@example.com"]]);
  const enabledVoice = (await enable.json()).voices.find((voice) => voice.id === PUCK);
  assert.equal(enabledVoice.enabled, true);

  const switched = await onRequestPut(
    await createContext({ db, method: "PUT", payload: { voiceId: PUCK, enabled: true } })
  );
  assert.equal(switched.status, 200);
  const switchedPayload = await switched.json();
  assert.equal(switchedPayload.setting.voiceId, PUCK);
  assert.equal(switchedPayload.voices.find((voice) => voice.site).id, PUCK);
});

test("the site voice cannot be disabled, other voices can", async () => {
  const db = new FakeSpeechSettingsDb({ voiceId: ACHERNAR, enabled: 1, version: 1 }, [ACHERNAR, PUCK]);

  const refused = await onVoiceOptionPut(
    await createContext({ db, method: "PUT", payload: { voiceId: ACHERNAR, enabled: false } })
  );
  assert.equal(refused.status, 409);

  const disabled = await onVoiceOptionPut(
    await createContext({ db, method: "PUT", payload: { voiceId: PUCK, enabled: false } })
  );
  assert.equal(disabled.status, 200);
  assert.deepEqual(db.optionWrites, [[PUCK, 0, "admin@example.com"]]);

  const editor = await onVoiceOptionPut(
    await createContext({ db, role: "editor", method: "PUT", payload: { voiceId: PUCK, enabled: true } })
  );
  assert.equal(editor.status, 403);
  const invalid = await onVoiceOptionPut(
    await createContext({ db, method: "PUT", payload: { voiceId: "en-US-Chirp3-HD-Puck", enabled: true } })
  );
  assert.equal(invalid.status, 400);
});

test("preview speaks admin text in any Ukrainian voice", async () => {
  const calls = [];
  const response = await onPreviewPost(await createContext({
    method: "POST",
    payload: { voiceId: PUCK, text: "  Привіт!  " },
    fetch: googleCatalogFetch(calls),
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], MP3);
  const body = JSON.parse(calls[0][1].body);
  assert.deepEqual(body.input, { text: "Привіт!" });
  assert.equal(body.voice.name, PUCK);

  const cases = [
    [{ role: "editor", payload: { voiceId: PUCK, text: "Привіт" } }, 403],
    [{ origin: "https://example.com", payload: { voiceId: PUCK, text: "Привіт" } }, 403],
    [{ payload: { voiceId: PUCK, text: "   " } }, 400],
    [{ payload: { voiceId: PUCK, text: "а".repeat(201) } }, 400],
    [{ payload: { voiceId: "en-US-Chirp3-HD-Puck", text: "Hi" } }, 400],
    [{ payload: { voiceId: PUCK } }, 400],
    [{ googleKey: "", payload: { voiceId: PUCK, text: "Привіт" } }, 503],
    [{ fetch: async () => new Response("no", { status: 500 }), payload: { voiceId: PUCK, text: "Привіт" } }, 502],
  ];
  for (const [options, status] of cases) {
    const failed = await onPreviewPost(await createContext({ method: "POST", ...options }));
    assert.equal(failed.status, status, JSON.stringify(options));
  }
});
