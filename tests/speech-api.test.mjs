import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSpeechAssetPath,
  canonicalizeSpeechWord,
  onRequestPost,
} from "../functions/api/speech.js";

const GOOD_WORD_HASH = "145c459c9454d7d05dc642b57941b409f7ab34c5aa816d6cc331f40abbba492a";
const GOOGLE_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";

function storyRow(overrides = {}) {
  return {
    id: 42,
    level: "A1",
    display_order: 1,
    question_index: 1,
    title: "Вітання",
    paragraphs_json: JSON.stringify([
      "Добрий день, друзі!",
      "П’ять веб‑сайтів. Щодень читаємо українською.",
    ]),
    show_word_count: 1,
    is_enabled: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fakeDb(
  row = storyRow(),
  {
    quotaAllowed = true,
    quotaThrows = false,
    clientQuotaAllowed = true,
    monthUsed = 0,
    queries = [],
    runs = [],
    voiceId = "uk-UA-Chirp3-HD-Achernar",
    speechEnabled = true,
    voiceSettingThrows = false,
    enabledVoices = ["uk-UA-Chirp3-HD-Achernar"],
  } = {}
) {
  return {
    prepare(sql) {
      queries.push(sql);
      const readSpeechSetting = async () => {
        if (voiceSettingThrows) throw new Error("D1 speech setting unavailable");
        return voiceId === null
          ? null
          : {
              voiceId,
              enabled: speechEnabled ? 1 : 0,
              version: 1,
              updatedAt: "2026-08-06 00:00:00",
              updatedByUserId: 1,
              updatedByEmail: "admin@example.com",
            };
      };
      return {
        async all() {
          assert.match(sql, /FROM speech_voice_options/);
          return { results: enabledVoices.map((id) => ({ voiceId: id })) };
        },
        async first() {
          if (sql.includes("FROM speech_settings")) {
            return readSpeechSetting();
          }
          return typeof row === "function" ? row({ sql, bindings: [] }) : row;
        },
        bind(...bindings) {
          return {
            async run() {
              runs.push({ sql, bindings });
              return { success: true, meta: { changes: 1 } };
            },
            async first() {
              // The usage read that explains a refusal.
              if (sql.includes("AS month")) {
                return { today: 0, month: monthUsed };
              }
              if (sql.includes("speech_usage_client_daily")) {
                if (quotaThrows) throw new Error("D1 quota unavailable");
                return clientQuotaAllowed && bindings[2] <= bindings[3]
                  ? { characters_used: bindings[2] }
                  : null;
              }
              if (sql.includes("speech_usage_daily")) {
                if (quotaThrows) throw new Error("D1 quota unavailable");
                // Bindings: day, characters, daily limit, monthly limit, month range.
                return quotaAllowed && bindings[1] <= bindings[2] && monthUsed + bindings[1] <= bindings[3]
                  ? { characters_used: bindings[1] }
                  : null;
              }
              return typeof row === "function" ? row({ sql, bindings }) : row;
            },
          };
        },
      };
    },
  };
}

function speechRequest(payload, init = {}) {
  return new Request("https://readukrainianapp.com/api/speech", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://readukrainianapp.com",
      "cf-connecting-ip": "203.0.113.10",
      ...init.headers,
    },
    body: JSON.stringify(payload),
  });
}

const MP3 = [0xff, 0xfb];

function googleResponse(bytes = [...MP3, 7, 8, 9], init = {}) {
  return new Response(
    JSON.stringify({ audioContent: Buffer.from(bytes).toString("base64") }),
    { ...init, headers: { "content-type": "application/json", ...init.headers } }
  );
}

function audioResponse(bytes = [...MP3, 7, 8, 9], headers = {}) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "audio/mpeg",
      ...headers,
    },
  });
}

function createContext({
  payload = { storyId: 42, text: "«ДОБРИЙ!»" },
  row = storyRow(),
  staticResponse,
  staticFetch,
  providerFetch,
  cache = null,
  dailyLimit = "4500",
  monthlyLimit = "900000",
  monthUsed = 0,
  rateLimitSuccess = true,
  includeRateLimiter = true,
  googleKey = "test-key",
  quotaAllowed = true,
  quotaThrows = false,
  clientQuotaAllowed = true,
  voiceId = "uk-UA-Chirp3-HD-Achernar",
  speechEnabled = true,
  voiceSettingThrows = false,
  enabledVoices,
  request,
} = {}) {
  const assetCalls = [];
  const providerCalls = [];
  const rateLimitCalls = [];
  const dbQueries = [];
  const dbRuns = [];
  const waitUntilPromises = [];
  const env = {
    DB: fakeDb(row, {
      quotaAllowed,
      quotaThrows,
      clientQuotaAllowed,
      monthUsed,
      queries: dbQueries,
      runs: dbRuns,
      voiceId,
      speechEnabled,
      voiceSettingThrows,
      enabledVoices,
    }),
    ASSETS: {
      async fetch(assetRequest) {
        assetCalls.push(assetRequest);
        if (staticFetch) return staticFetch(assetRequest);
        return staticResponse || audioResponse([1, 2, 3], {
          "content-length": "3",
          etag: '"static-etag"',
        });
      },
    },
    SPEECH_DAILY_CHARACTER_LIMIT: dailyLimit,
    SPEECH_MONTHLY_CHARACTER_LIMIT: monthlyLimit,
    SPEECH_CLIENT_DAILY_CHARACTER_LIMIT: "600",
    SESSION_SECRET: "a sufficiently long speech test secret",
    GOOGLE_TTS_API_KEY: googleKey,
  };
  if (includeRateLimiter) {
    env.SPEECH_RATE_LIMITER = {
      async limit(input) {
        rateLimitCalls.push(input);
        return { success: rateLimitSuccess };
      },
    };
  }

  return {
    assetCalls,
    dbQueries,
    dbRuns,
    providerCalls,
    rateLimitCalls,
    waitUntilPromises,
    context: {
      request: request || speechRequest(payload),
      env,
      cache,
      async fetch(...args) {
        providerCalls.push(args);
        return providerFetch
          ? providerFetch(...args)
          : googleResponse();
      },
      waitUntil(promise) {
        waitUntilPromises.push(promise);
      },
    },
  };
}

test("canonicalizes Ukrainian words exactly like the static generator", () => {
  assert.equal(canonicalizeSpeechWord("  «П’ЯТЬ!»  "), "п'ять");
  assert.equal(canonicalizeSpeechWord("ВЕБ‑САЙТ"), "веб-сайт");
  assert.equal(canonicalizeSpeechWord("—СЛОВО—"), "слово");
  assert.equal(canonicalizeSpeechWord("І\u0308ЖА"), "їжа");
  assert.equal(canonicalizeSpeechWord("Добрий день"), null);
  assert.equal(canonicalizeSpeechWord("hello"), null);
});

test("derives deterministic SHA-256 MP3 paths from canonical words", async () => {
  assert.equal(
    await buildSpeechAssetPath("добрий"),
    `/speech/uk-UA-Chirp3-HD-Achernar/${GOOD_WORD_HASH}.mp3`
  );
  await assert.rejects(buildSpeechAssetPath("добрий", "lada"), /Unsupported speech voice/);
  await assert.rejects(
    buildSpeechAssetPath("добрий", "../../escape"),
    /Unsupported speech voice/
  );
});

test("serves static audio first without cache, limiter, quota, or provider calls", async () => {
  const harness = createContext();
  const response = await onRequestPost(harness.context);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("x-speech-source"), "static");
  assert.equal(response.headers.get("x-speech-cache"), "HIT");
  assert.equal(response.headers.get("x-speech-voice"), "uk-UA-Chirp3-HD-Achernar");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("cache-control"), /immutable/);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  assert.equal(harness.assetCalls.length, 1);
  assert.equal(
    new URL(harness.assetCalls[0].url).pathname,
    `/speech/uk-UA-Chirp3-HD-Achernar/${GOOD_WORD_HASH}.mp3`
  );
  assert.equal(harness.providerCalls.length, 0);
  assert.equal(harness.rateLimitCalls.length, 0);
  assert.equal(
    harness.dbQueries.filter((query) => query.includes("speech_usage_daily")).length,
    0
  );
});

test("serves a provider cache hit before limiter, quota, or provider calls", async () => {
  const cacheCalls = [];
  const cache = {
    async match(request) {
      cacheCalls.push(["match", request]);
      return audioResponse([...MP3, 4, 5, 6]);
    },
    async put() {
      throw new Error("A hit must not be written again.");
    },
  };
  const harness = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    cache,
  });
  const response = await onRequestPost(harness.context);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-speech-source"), "google");
  assert.equal(response.headers.get("x-speech-cache"), "HIT");
  assert.equal(response.headers.get("x-speech-voice"), "uk-UA-Chirp3-HD-Achernar");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...MP3, 4, 5, 6]);
  assert.equal(cacheCalls.length, 1);
  assert.equal(cacheCalls[0][1].method, "GET");
  assert.equal(harness.providerCalls.length, 0);
  assert.equal(harness.rateLimitCalls.length, 0);
});

test("generates Google audio on a static and cache miss", async () => {
  const cacheWrites = [];
  const cache = {
    async match() {
      return undefined;
    },
    async put(request, response) {
      cacheWrites.push({
        request,
        bytes: [...new Uint8Array(await response.arrayBuffer())],
      });
    },
  };
  const harness = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    cache,
  });
  const response = await onRequestPost(harness.context);
  await Promise.all(harness.waitUntilPromises);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-speech-source"), "google");
  assert.equal(response.headers.get("x-speech-cache"), "MISS");
  assert.equal(response.headers.get("x-speech-voice"), "uk-UA-Chirp3-HD-Achernar");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...MP3, 7, 8, 9]);
  assert.equal(harness.providerCalls.length, 1);
  const [providerUrl, providerInit] = harness.providerCalls[0];
  assert.equal(providerUrl, GOOGLE_ENDPOINT);
  assert.equal(providerInit.method, "POST");
  assert.equal(providerInit.redirect, "manual");
  assert.equal(providerInit.headers["x-goog-api-key"], "test-key");
  assert.deepEqual(JSON.parse(providerInit.body), {
    input: { text: "добрий" },
    voice: { languageCode: "uk-UA", name: "uk-UA-Chirp3-HD-Achernar" },
    audioConfig: { audioEncoding: "MP3", sampleRateHertz: 24000, speakingRate: 0.9 },
  });
  assert.deepEqual(harness.rateLimitCalls, [{ key: "speech:google" }]);
  assert.equal(
    harness.dbQueries.filter((query) => query.includes("speech_usage_daily")).length,
    1
  );
  // The provider-cache write and the clean-up of earlier days' client rows.
  assert.equal(harness.waitUntilPromises.length, 2);
  assert.equal(cacheWrites.length, 1);
  assert.equal(cacheWrites[0].request.method, "GET");
  assert.deepEqual(cacheWrites[0].bytes, [...MP3, 7, 8, 9]);
});

test("falls back to the default voice when the stored voice was retired", async () => {
  const harness = createContext({ voiceId: "lada" });
  const response = await onRequestPost(harness.context);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-speech-voice"), "uk-UA-Chirp3-HD-Achernar");
  assert.equal(new URL(harness.assetCalls[0].url).pathname, `/speech/uk-UA-Chirp3-HD-Achernar/${GOOD_WORD_HASH}.mp3`);
});

test("speaks in the learner's chosen voice while it is on the shortlist", async () => {
  const harness = createContext({
    payload: { storyId: 42, text: "добрий", voiceId: "uk-UA-Chirp3-HD-Charon" },
    enabledVoices: ["uk-UA-Chirp3-HD-Achernar", "uk-UA-Chirp3-HD-Charon"],
  });
  const response = await onRequestPost(harness.context);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-speech-voice"), "uk-UA-Chirp3-HD-Charon");
  assert.equal(
    new URL(harness.assetCalls[0].url).pathname,
    `/speech/uk-UA-Chirp3-HD-Charon/${GOOD_WORD_HASH}.mp3`
  );
});

test("falls back to the site voice for a voice that is not on the shortlist", async () => {
  for (const voiceId of ["uk-UA-Chirp3-HD-Charon", "../../escape", 7]) {
    const harness = createContext({
      payload: { storyId: 42, text: "добрий", voiceId },
      enabledVoices: ["uk-UA-Chirp3-HD-Achernar"],
    });
    const response = await onRequestPost(harness.context);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-speech-voice"), "uk-UA-Chirp3-HD-Achernar");
  }
});

test("rejects provider audio that is not MP3", async () => {
  const notMp3 = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    providerFetch: async () => googleResponse([0x52, 0x49, 0x46, 0x46, 1, 2]),
  });
  assert.equal((await onRequestPost(notMp3.context)).status, 502);

  const notBase64 = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    providerFetch: async () => new Response(JSON.stringify({ audioContent: "%%%" }), {
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal((await onRequestPost(notBase64.context)).status, 502);
});

test("fails closed without a Google key before limits or provider use", async () => {
  for (const googleKey of ["", "   "]) {
    const harness = createContext({
      staticResponse: new Response("missing", { status: 404 }),
      googleKey,
    });
    assert.equal((await onRequestPost(harness.context)).status, 503);
    assert.equal(harness.rateLimitCalls.length, 0);
    assert.equal(harness.providerCalls.length, 0);
  }

  const served = createContext({ googleKey: "" });
  assert.equal((await onRequestPost(served.context)).status, 200, "static audio needs no key");
});

test("fails closed when the selected voice cannot be read", async () => {
  const harness = createContext({ voiceSettingThrows: true });
  const response = await onRequestPost(harness.context);

  assert.equal(response.status, 503);
  assert.equal(harness.assetCalls.length, 0);
  assert.equal(harness.providerCalls.length, 0);
});

test("returns a no-store 404 before assets, cache, limits, or provider when speech is disabled", async () => {
  const harness = createContext({
    speechEnabled: false,
    row() {
      throw new Error("The story must not be read while speech is disabled.");
    },
    staticFetch() {
      throw new Error("Assets must not be read while speech is disabled.");
    },
    cache: {
      async match() {
        throw new Error("Cache must not be read while speech is disabled.");
      },
      async put() {
        throw new Error("Cache must not be written while speech is disabled.");
      },
    },
    providerFetch() {
      throw new Error("The provider must not be called while speech is disabled.");
    },
    rateLimitSuccess: false,
    quotaThrows: true,
  });

  const response = await onRequestPost(harness.context);

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-speech-disabled"), "true");
  assert.equal(harness.assetCalls.length, 0);
  assert.equal(harness.providerCalls.length, 0);
  assert.equal(harness.rateLimitCalls.length, 0);
  assert.equal(harness.waitUntilPromises.length, 0);
  // The story is read alongside the setting, so even a failing story read
  // still answers "disabled" rather than an error.
  assert.equal(harness.dbQueries.length, 2);
  assert.ok(harness.dbQueries.some((query) => /FROM speech_settings/.test(query)));
  assert.equal(
    harness.dbQueries.some((query) => query.includes("speech_usage_daily")),
    false
  );
});

test("rejects provider redirects without following them", async () => {
  const harness = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    providerFetch: async () => new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/audio.mp3" },
    }),
  });

  const response = await onRequestPost(harness.context);

  assert.equal(response.status, 502);
  assert.equal(harness.providerCalls.length, 1);
  assert.equal(harness.providerCalls[0][1].redirect, "manual");
});

test("rejects invalid or oversized provider responses", async () => {
  const wrongType = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    providerFetch: async () => new Response("not json", {
      headers: { "content-type": "text/plain" },
    }),
  });
  assert.equal((await onRequestPost(wrongType.context)).status, 502);

  const oversized = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    providerFetch: async () => googleResponse([...MP3], {
      headers: { "content-length": String(3 * 1024 * 1024) },
    }),
  });
  assert.equal((await onRequestPost(oversized.context)).status, 502);

  const failed = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    providerFetch: async () => new Response("quota", { status: 429 }),
  });
  assert.equal((await onRequestPost(failed.context)).status, 502);
});

test("rejects phrases and tokens absent from the published story", async () => {
  const phrase = createContext({
    payload: { storyId: 42, text: "Добрий день" },
  });
  const phraseResponse = await onRequestPost(phrase.context);
  assert.equal(phraseResponse.status, 422);
  assert.equal(phrase.assetCalls.length, 0);
  assert.equal(phrase.dbQueries.length, 0);

  const substring = createContext({
    payload: { storyId: 42, text: "день" },
    row: storyRow({ paragraphs_json: JSON.stringify(["Щодень читаємо."]) }),
  });
  const substringResponse = await onRequestPost(substring.context);
  assert.equal(substringResponse.status, 404);
  assert.equal(substring.assetCalls.length, 0);
});

test("rate limits fallback generation before quota or provider use", async () => {
  const harness = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    rateLimitSuccess: false,
  });
  const response = await onRequestPost(harness.context);

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("x-speech-limit"), "rate");
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(harness.providerCalls.length, 0);
  assert.equal(
    harness.dbQueries.filter((query) => query.includes("speech_usage_daily")).length,
    0
  );
});

test("fails closed when fallback limits are missing or invalid", async () => {
  for (const dailyLimit of ["", "0", "-1", "1.5", "invalid"]) {
    const harness = createContext({
      staticResponse: new Response("missing", { status: 404 }),
      dailyLimit,
    });
    const response = await onRequestPost(harness.context);
    assert.equal(response.status, 503);
    assert.equal(harness.rateLimitCalls.length, 0);
    assert.equal(harness.providerCalls.length, 0);
  }

  const missingLimiter = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    includeRateLimiter: false,
  });
  assert.equal((await onRequestPost(missingLimiter.context)).status, 503);
  assert.equal(missingLimiter.providerCalls.length, 0);
});

test("enforces the atomic application-wide daily character budget", async () => {
  const exhausted = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    quotaAllowed: false,
  });
  const response = await onRequestPost(exhausted.context);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("x-speech-limit"), "daily");
  assert.ok(Number(response.headers.get("retry-after")) >= 60);
  assert.equal(exhausted.providerCalls.length, 0);

  const query = exhausted.dbQueries.find((sql) =>
    sql.includes("speech_usage_daily")
  );
  assert.match(query, /WHERE \?2 <= \?3/);

  const unavailable = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    quotaThrows: true,
  });
  assert.equal((await onRequestPost(unavailable.context)).status, 503);
  assert.equal(unavailable.providerCalls.length, 0);
});

test("requires same-origin JSON and a valid active story", async () => {
  const wrongOrigin = speechRequest(
    { storyId: 42, text: "добрий" },
    { headers: { origin: "https://example.com" } }
  );
  const crossOrigin = createContext({ request: wrongOrigin });
  assert.equal((await onRequestPost(crossOrigin.context)).status, 403);
  assert.equal(crossOrigin.dbQueries.length, 0);

  const missingOriginRequest = speechRequest({ storyId: 42, text: "добрий" });
  missingOriginRequest.headers.delete("origin");
  const missingOrigin = createContext({ request: missingOriginRequest });
  assert.equal((await onRequestPost(missingOrigin.context)).status, 403);

  const wrongTypeRequest = speechRequest(
    { storyId: 42, text: "добрий" },
    { headers: { "content-type": "text/plain" } }
  );
  const wrongType = createContext({ request: wrongTypeRequest });
  assert.equal((await onRequestPost(wrongType.context)).status, 415);

  const disabledStory = createContext({
    row: storyRow({ is_enabled: 0 }),
  });
  assert.equal((await onRequestPost(disabledStory.context)).status, 404);
  assert.equal(disabledStory.assetCalls.length, 0);

  const badStoryId = createContext({
    payload: { storyId: 0, text: "добрий" },
  });
  assert.equal((await onRequestPost(badStoryId.context)).status, 400);
  assert.equal(badStoryId.dbQueries.length, 0);
});

test("does not invoke fallback when static asset storage itself fails", async () => {
  const serverError = createContext({
    staticResponse: new Response("failure", { status: 500 }),
  });
  assert.equal((await onRequestPost(serverError.context)).status, 503);
  assert.equal(serverError.providerCalls.length, 0);

  const fetchError = createContext({
    staticFetch() {
      throw new Error("assets unavailable");
    },
  });
  assert.equal((await onRequestPost(fetchError.context)).status, 503);
  assert.equal(fetchError.providerCalls.length, 0);
});

test("one client cannot spend more than its share of the daily budget", async () => {
  const harness = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    clientQuotaAllowed: false,
  });
  const response = await onRequestPost(harness.context);

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("x-speech-limit"), "client");
  assert.ok(Number(response.headers.get("retry-after")) >= 60);
  assert.equal(harness.providerCalls.length, 0);
  // The site-wide budget is never touched for a client that is over its share.
  assert.equal(harness.dbQueries.some((sql) => sql.includes("speech_usage_daily")), false);

  const clientQuery = harness.dbQueries.find((sql) => sql.includes("INSERT INTO speech_usage_client_daily"));
  assert.match(clientQuery, /WHERE \?3 <= \?4/);
});

test("clients are counted by a keyed hash, never by their address", async () => {
  const harness = createContext({ staticResponse: new Response("missing", { status: 404 }) });
  await onRequestPost(harness.context);
  await Promise.all(harness.waitUntilPromises);

  const clientInsert = harness.dbQueries.findIndex((sql) => sql.includes("INSERT INTO speech_usage_client_daily"));
  assert.ok(clientInsert >= 0);
  assert.ok(harness.dbRuns.some((run) => run.sql.includes("DELETE FROM speech_usage_client_daily")));
});

test("a failed Google call gives the reserved characters back", async () => {
  const harness = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    providerFetch: async () => new Response("unavailable", { status: 503 }),
  });
  const response = await onRequestPost(harness.context);
  await Promise.all(harness.waitUntilPromises);

  assert.equal(response.status, 502);
  const refunds = harness.dbRuns.filter((run) => /SET characters_used = MAX\(0, characters_used -/.test(run.sql));
  assert.equal(refunds.length, 2);
  assert.ok(refunds.some((run) => run.sql.includes("speech_usage_daily")));
  assert.ok(refunds.some((run) => run.sql.includes("speech_usage_client_daily")));
});

test("pronunciation accepts a word selected with stress marks", () => {
  assert.equal(canonicalizeSpeechWord("ДО\u0301БРИЙ"), "добрий");
});

test("the monthly limit stops live Google calls until next month", async () => {
  const harness = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    monthlyLimit: "1000",
    monthUsed: 998,
  });
  const response = await onRequestPost(harness.context);

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("x-speech-limit"), "monthly");
  assert.ok(Number(response.headers.get("retry-after")) >= 60);
  assert.equal(harness.providerCalls.length, 0);
  // The client's share was handed back, since nothing was spoken.
  await Promise.all(harness.waitUntilPromises);
  assert.ok(harness.dbRuns.some((run) => run.sql.includes("UPDATE speech_usage_client_daily")));
});

test("pronunciation fails closed without a monthly limit", async () => {
  for (const monthlyLimit of ["", "0", "lots"]) {
    const harness = createContext({ staticResponse: new Response("missing", { status: 404 }), monthlyLimit });
    assert.equal((await onRequestPost(harness.context)).status, 503);
    assert.equal(harness.providerCalls.length, 0);
  }
});
