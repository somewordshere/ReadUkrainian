# Static Ukrainian speech assets

This build pipeline turns every unique Ukrainian word in the published stories into
an MP3 made by Google Cloud Text-to-Speech in the site voice chosen in the admin
(Audio → Voices). Tapping «Прослухати» then serves a file that
is already on Cloudflare instead of waiting for synthesis. The Worker names each
file after the SHA-256 of the canonical UTF-8 word and serves
`public/speech/<voice-id>/<sha256>.mp3`.

## Credentials

Put a Google Cloud API key restricted to the Cloud Text-to-Speech API in
`.dev.vars` (gitignored, also read by `wrangler dev`):

```
GOOGLE_TTS_API_KEY=...
```

Production needs the same key as a Worker secret
(`npx wrangler secret put GOOGLE_TTS_API_KEY`). Without it static audio still
plays; only words added after the last generation fail.

## Workflow

1. Check what would be generated (no Google calls):

   ```powershell
   npm run speech:plan
   ```

2. Optionally listen first. This renders words with the site voice, with and
   without stress marks, into `.speech-build/samples/`:

   ```powershell
   node scripts/speech/generate-speech-assets.mjs --sample замок,мука,наша
   ```

3. Generate and publish into `public/speech/<voice-id>/`, passing the site voice
   chosen in the admin (the default is `uk-UA-Chirp3-HD-Achernar`):

   ```powershell
   npm run speech:build -- --voice-id uk-UA-Chirp3-HD-Achernar
   ```

   The full run (about 4,200 words, 28,000 characters) takes about 20 minutes and
   fits in Google's free monthly allowance. It is resumable: finished words stay in
   `.speech-build/google/`, and words whose published MP3 is still current are
   reused, so later runs only synthesize new words.

4. Commit `public/speech/<voice-id>/` (MP3s and `manifest.json`) and release as usual.

## Budget

The site itself cannot overspend: every Google call the Worker makes (learners'
pronunciation and admin voice previews) reserves its characters first against
`SPEECH_DAILY_CHARACTER_LIMIT` (4,500 a UTC day) and
`SPEECH_MONTHLY_CHARACTER_LIMIT` (900,000 a UTC month) in `wrangler.jsonc`, and
stops at either. Google's free allowance is 1,000,000 characters a month for
Chirp 3 HD and Neural2 voices. This generator runs outside the Worker, so it
refuses a run that would send more than 100,000 characters unless you pass a
higher `--max-characters`; the gap between the two numbers is its share.

`--stress` sends the stress marks from `public/js/data/stress-map.json`. Switching
it on or off, or changing the voice, regenerates everything, because the request
sent to Google changes.

The production API is the default source. `--allow-seed-fallback` or
`--source seed` builds from `data/content-seed.json` instead; the manifest records
that degraded source.

## Content lifecycle

Publishing or editing a story in the admin does not generate audio. New words are
synthesized on demand by `/api/speech` (rate limited, with a daily character
budget) until the next `npm run speech:build` puts them in static files. Words
that leave every story are deleted from `public/speech/<voice-id>/` on the next run.

Canonicalization is NFC, trimmed, Ukrainian-locale lowercase, maps common apostrophe
and dash variants to ASCII, and accepts exactly one Ukrainian token. It must match
`canonicalizeSpeechWord` in `functions/api/speech.js`.
