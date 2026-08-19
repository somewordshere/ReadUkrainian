import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSpeechAssetPath,
  canonicalizeSpeechWord,
  onRequestPost,
} from "../functions/api/speech.js";

const GOOD_WORD_HASH = "145c459c9454d7d05dc642b57941b409f7ab34c5aa816d6cc331f40abbba492a";
const JOB_UUID = "123e4567-e89b-12d3-a456-426614174000";
const COMPACT_JOB_UUID = "77b71db532874ce98e84a69a2d740d4c";

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
    queries = [],
    voiceId = "lada",
    speechEnabled = true,
    voiceSettingThrows = false,
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
        async first() {
          if (sql.includes("FROM speech_settings")) {
            return readSpeechSetting();
          }
          return typeof row === "function" ? row({ sql, bindings: [] }) : row;
        },
        bind(...bindings) {
          return {
            async first() {
              if (sql.includes("speech_usage_daily")) {
                if (quotaThrows) throw new Error("D1 quota unavailable");
                return quotaAllowed && bindings[1] <= bindings[2]
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

function audioResponse(bytes = [7, 8, 9], headers = {}) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "audio/mpeg",
      ...headers,
    },
  });
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
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
  rateLimitSuccess = true,
  includeRateLimiter = true,
  quotaAllowed = true,
  quotaThrows = false,
  voiceId = "lada",
  speechEnabled = true,
  voiceSettingThrows = false,
  request,
  now,
} = {}) {
  const assetCalls = [];
  const providerCalls = [];
  const rateLimitCalls = [];
  const dbQueries = [];
  const sleeps = [];
  const waitUntilPromises = [];
  const env = {
    DB: fakeDb(row, {
      quotaAllowed,
      quotaThrows,
      queries: dbQueries,
      voiceId,
      speechEnabled,
      voiceSettingThrows,
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
    providerCalls,
    rateLimitCalls,
    sleeps,
    waitUntilPromises,
    context: {
      request: request || speechRequest(payload),
      env,
      cache,
      now,
      async fetch(...args) {
        providerCalls.push(args);
        return providerFetch
          ? providerFetch(...args)
          : audioResponse([7, 8, 9]);
      },
      async sleep(milliseconds) {
        sleeps.push(milliseconds);
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
    `/speech/lada/${GOOD_WORD_HASH}.mp3`
  );
  assert.equal(
    await buildSpeechAssetPath("добрий", "mai"),
    `/speech/mai/${GOOD_WORD_HASH}.mp3`
  );
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
  assert.equal(response.headers.get("x-speech-voice"), "lada");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("cache-control"), /immutable/);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  assert.equal(harness.assetCalls.length, 1);
  assert.equal(
    new URL(harness.assetCalls[0].url).pathname,
    `/speech/lada/${GOOD_WORD_HASH}.mp3`
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
      return audioResponse([4, 5, 6]);
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
  assert.equal(response.headers.get("x-speech-source"), "tts-ai");
  assert.equal(response.headers.get("x-speech-cache"), "HIT");
  assert.equal(response.headers.get("x-speech-voice"), "lada");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [4, 5, 6]);
  assert.equal(cacheCalls.length, 1);
  assert.equal(cacheCalls[0][1].method, "GET");
  assert.equal(harness.providerCalls.length, 0);
  assert.equal(harness.rateLimitCalls.length, 0);
});

test("generates a direct Piper response on a static and cache miss", async () => {
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
  assert.equal(response.headers.get("x-speech-source"), "tts-ai");
  assert.equal(response.headers.get("x-speech-cache"), "MISS");
  assert.equal(response.headers.get("x-speech-voice"), "lada");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [7, 8, 9]);
  assert.equal(harness.providerCalls.length, 1);
  assert.equal(harness.providerCalls[0][0], "https://api.tts.ai/v1/tts/");
  assert.equal(harness.providerCalls[0][1].method, "POST");
  assert.deepEqual(JSON.parse(harness.providerCalls[0][1].body), {
    model: "piper",
    voice: "uk_UA-lada-x_low",
    language: "uk",
    text: "добрий",
    format: "mp3",
    speed: 0.9,
  });
  assert.deepEqual(harness.rateLimitCalls, [{ key: "speech:tts-ai" }]);
  assert.equal(
    harness.dbQueries.filter((query) => query.includes("speech_usage_daily")).length,
    1
  );
  assert.equal(harness.waitUntilPromises.length, 1);
  assert.equal(cacheWrites.length, 1);
  assert.equal(cacheWrites[0].request.method, "GET");
  assert.deepEqual(cacheWrites[0].bytes, [7, 8, 9]);
});

test("uses the selected MAI voice and model for assets, cache identity, and provider payload", async () => {
  const cacheRequests = [];
  const cache = {
    async match(request) {
      cacheRequests.push(request);
      return undefined;
    },
    async put() {},
  };
  const harness = createContext({
    voiceId: "mai",
    staticResponse: new Response("missing", { status: 404 }),
    cache,
  });

  const response = await onRequestPost(harness.context);
  await Promise.all(harness.waitUntilPromises);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-speech-voice"), "mai");
  assert.equal(
    new URL(harness.assetCalls[0].url).pathname,
    `/speech/mai/${GOOD_WORD_HASH}.mp3`
  );
  assert.deepEqual(JSON.parse(harness.providerCalls[0][1].body), {
    model: "vits",
    voice: "mai_uk",
    language: "uk",
    text: "добрий",
    format: "wav",
    speed: 0.9,
  });
  assert.equal(cacheRequests.length, 1);

  const defaultHarness = createContext({
    voiceId: "lada",
    staticResponse: new Response("missing", { status: 404 }),
    cache: {
      async match(request) {
        cacheRequests.push(request);
        return audioResponse([3]);
      },
      async put() {},
    },
  });
  assert.equal((await onRequestPost(defaultHarness.context)).status, 200);
  assert.notEqual(cacheRequests[0].url, cacheRequests[1].url);
});

test("preserves MAI WAV audio even when the provider labels it as MPEG", async () => {
  const waveBytes = [
    0x52, 0x49, 0x46, 0x46,
    0x04, 0x00, 0x00, 0x00,
    0x57, 0x41, 0x56, 0x45,
    0x01, 0x02, 0x03, 0x04,
  ];
  const harness = createContext({
    voiceId: "mai",
    staticResponse: new Response("missing", { status: 404 }),
    providerFetch: async () => audioResponse(waveBytes, {
      "content-type": "audio/mpeg",
    }),
  });

  const response = await onRequestPost(harness.context);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/wav");
  assert.equal(response.headers.get("x-speech-voice"), "mai");
  assert.deepEqual(
    [...new Uint8Array(await response.arrayBuffer())],
    waveBytes
  );
});

test("fails closed when the selected voice cannot be read", async () => {
  const harness = createContext({ voiceSettingThrows: true });
  const response = await onRequestPost(harness.context);

  assert.equal(response.status, 503);
  assert.equal(harness.assetCalls.length, 0);
  assert.equal(harness.providerCalls.length, 0);
});

test("returns a no-store 404 before story, assets, cache, limits, or provider when speech is disabled", async () => {
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
  assert.equal(harness.dbQueries.length, 1);
  assert.match(harness.dbQueries[0], /FROM speech_settings/);
  assert.equal(
    harness.dbQueries.some((query) => query.includes("speech_usage_daily")),
    false
  );
});

test("polls a valid job and downloads audio from the provider CDN", async () => {
  const responses = [
    jsonResponse({ uuid: COMPACT_JOB_UUID }),
    jsonResponse({ status: "processing" }),
    jsonResponse({
      status: "completed",
      result_url: `https://cdn.tts.ai/${COMPACT_JOB_UUID}/tts_output.mp3`,
    }),
    audioResponse([9, 8, 7]),
  ];
  const harness = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    providerFetch: async () => responses.shift(),
  });
  const response = await onRequestPost(harness.context);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-speech-source"), "tts-ai");
  assert.equal(response.headers.get("x-speech-cache"), "MISS");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [9, 8, 7]);
  assert.equal(harness.providerCalls.length, 4);
  assert.equal(harness.providerCalls[0][1].redirect, "manual");
  assert.equal(
    String(harness.providerCalls[1][0]),
    `https://api.tts.ai/v1/speech/results/?uuid=${COMPACT_JOB_UUID}`
  );
  assert.equal(harness.providerCalls[1][1].method, "GET");
  assert.equal(harness.providerCalls[1][1].redirect, "manual");
  assert.equal(
    String(harness.providerCalls[3][0]),
    `https://cdn.tts.ai/${COMPACT_JOB_UUID}/tts_output.mp3`
  );
  assert.equal(harness.providerCalls[3][1].redirect, "manual");
  assert.deepEqual(harness.sleeps, [750]);
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

test("accepts both compact and hyphenated provider UUIDs", async () => {
  for (const uuid of [COMPACT_JOB_UUID, JOB_UUID]) {
    const responses = [
      jsonResponse({ uuid }),
      jsonResponse({
        status: "completed",
        result_url: "https://api.tts.ai/audio/result.mp3",
      }),
      audioResponse([1, 2]),
    ];
    const harness = createContext({
      staticResponse: new Response("missing", { status: 404 }),
      providerFetch: async () => responses.shift(),
    });
    const response = await onRequestPost(harness.context);
    assert.equal(response.status, 200);
    assert.match(String(harness.providerCalls[1][0]), new RegExp(uuid));
  }
});

test("rejects malformed UUIDs and non-allowlisted result URLs", async () => {
  const badUuid = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    providerFetch: async () => jsonResponse({ uuid: "../../escape" }),
  });
  assert.equal((await onRequestPost(badUuid.context)).status, 502);
  assert.equal(badUuid.providerCalls.length, 1);

  const badResultResponses = [
    jsonResponse({ uuid: JOB_UUID }),
    jsonResponse({
      status: "completed",
      result_url: "https://evil.example/audio.mp3",
    }),
  ];
  const badResult = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    providerFetch: async () => badResultResponses.shift(),
  });
  assert.equal((await onRequestPost(badResult.context)).status, 502);
  assert.equal(badResult.providerCalls.length, 2);

  const deceptiveHostResponses = [
    jsonResponse({ uuid: JOB_UUID }),
    jsonResponse({
      status: "completed",
      result_url: "https://cdn.tts.ai.evil.example/audio.mp3",
    }),
  ];
  const deceptiveHost = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    providerFetch: async () => deceptiveHostResponses.shift(),
  });
  assert.equal((await onRequestPost(deceptiveHost.context)).status, 502);
  assert.equal(deceptiveHost.providerCalls.length, 2);
});

test("rejects invalid or oversized provider responses", async () => {
  const wrongType = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    providerFetch: async () => new Response("not audio", {
      headers: { "content-type": "text/plain" },
    }),
  });
  assert.equal((await onRequestPost(wrongType.context)).status, 502);

  const oversized = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    providerFetch: async () => audioResponse([1], {
      "content-length": String(2 * 1024 * 1024 + 1),
    }),
  });
  assert.equal((await onRequestPost(oversized.context)).status, 502);
});

test("bounds polling attempts and injected sleeps", async () => {
  let first = true;
  const harness = createContext({
    staticResponse: new Response("missing", { status: 404 }),
    providerFetch: async () => {
      if (first) {
        first = false;
        return jsonResponse({ uuid: JOB_UUID });
      }
      return jsonResponse({ status: "processing" });
    },
  });
  const response = await onRequestPost(harness.context);

  assert.equal(response.status, 502);
  assert.equal(harness.providerCalls.length, 9);
  assert.equal(harness.sleeps.length, 7);
  assert.ok(harness.sleeps.every((delay) => delay === 750));
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
