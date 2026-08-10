# Static Ukrainian speech assets

This build-only pipeline turns every unique Ukrainian word in the published story
paragraphs into a compact MP3. Runtime requests cost no text-to-speech API money:
the Worker validates the selected word and serves the immutable static file whose
name is the SHA-256 of the canonical UTF-8 word.

## Safe workflow

1. Prove content collection and normalization without installing anything:

   ```powershell
   node scripts/speech/generate-speech-assets.mjs --plan
   ```

2. On a network-enabled build machine, synthesize one of the supported medium
   voices using an isolated ignored cache:

   ```powershell
   node scripts/speech/generate-speech-assets.mjs --bootstrap --voice-id tetiana --python C:\path\to\python.exe
   ```

   The static generator supports `lada-medium` (speaker 0), `mykyta` (speaker 1),
   and `tetiana` (speaker 2). The default runtime voice `lada` uses the separate
   `uk_UA-lada-x_low` model through the server-side provider and is not generated
   by this medium-model pipeline.

   These three build-time speakers are not exposed in the admin selector until a
   complete production manifest for each voice has been generated and deployed.
   TTS.ai does not expose Piper's multi-speaker control, so a missing static file
   must never silently fall back and claim to be Mykyta or Tetiana. The current
   provider-backed admin choices are Lada (Piper) and MAI (VITS).

The normal command fails if the production API cannot be read. To deliberately
build from the repository seed instead, add `--allow-seed-fallback`. The resulting
manifest records that degraded source and warns that admin-published stories may
be missing.

For an offline, explicit seed-only validation (without attempting the network), use
`--source seed --plan`. Keep the default production source for release builds.

`--bootstrap` installs pinned Piper and FFmpeg bridge packages only under
`.speech-build/`, then downloads `uk_UA-ukrainian_tts-medium` there. Neither the
Piper runtime nor the ONNX model is copied to `public/`. The generator stages and
validates every MP3, copies the audio files into
`public/speech/<voice-id>/`, and writes that voice's `manifest.json` last as the
commit marker.

The live-story word `наша` is synthesized first. Its duration, compressed bytes,
and build time are printed as a sample proof; unexpected sample size, duration, or
latency stops the batch before thousands of files are generated.

Canonicalization is NFC, trimmed, Ukrainian-locale lowercase, maps common apostrophe
and dash variants to ASCII, and accepts exactly one Ukrainian token. Assets are
32 kbps, 22.05 kHz, mono MP3 files named
`public/speech/<voice-id>/<sha256>.mp3`. Keeping the voice ID in the path prevents
an asset generated for one voice from being served after an administrator selects
another voice.

## Content lifecycle limitation

Publishing or editing a story through the admin UI does not synthesize new static
audio. Run this generator and redeploy after published paragraph changes if static
coverage is required. Only provider-backed voice IDs may use the server-side
fallback; a future static-only voice must fail closed when an asset is missing.
The browser never falls back to a device voice.

See `public/speech/NOTICE.txt` for model/runtime attribution.
