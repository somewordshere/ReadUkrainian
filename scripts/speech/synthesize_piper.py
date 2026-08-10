#!/usr/bin/env python3
"""Build-only Piper batch synthesizer used by generate-speech-assets.mjs."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import tempfile
import time
import wave
from pathlib import Path

import imageio_ffmpeg
from piper import PiperVoice
from piper.config import SynthesisConfig


FILENAME_PATTERN = re.compile(r"^[0-9a-f]{64}\.mp3$")
MAX_SAMPLE_AUDIO_SECONDS = 6.0
MAX_SAMPLE_BYTES = 64 * 1024
MAX_SAMPLE_BUILD_SECONDS = 60.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--jobs", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--speaker-id", required=True, type=int)
    return parser.parse_args()


def load_jobs(path: Path) -> list[dict[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    jobs = payload.get("jobs")
    if not isinstance(jobs, list) or not jobs:
        raise ValueError("Job file has no jobs")

    for job in jobs:
        if not isinstance(job, dict) or not isinstance(job.get("word"), str):
            raise ValueError("Invalid synthesis job")
        if not FILENAME_PATTERN.fullmatch(str(job.get("filename", ""))):
            raise ValueError(f"Invalid asset filename: {job.get('filename')!r}")
    return jobs


def encode_mp3(ffmpeg: str, wav_path: Path, mp3_path: Path) -> None:
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(wav_path),
            "-map_metadata",
            "-1",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "22050",
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "32k",
            "-write_xing",
            "0",
            "-id3v2_version",
            "0",
            str(mp3_path),
        ],
        check=True,
    )


def main() -> None:
    args = parse_args()
    if args.speaker_id < 0:
        raise ValueError("Speaker ID must be non-negative")
    if not args.model.is_file() or not Path(f"{args.model}.json").is_file():
        raise FileNotFoundError("Piper model and adjacent JSON config are required")

    jobs = load_jobs(args.jobs)
    args.output.mkdir(parents=True, exist_ok=True)
    voice = PiperVoice.load(str(args.model))
    synthesis_config = SynthesisConfig(
        speaker_id=args.speaker_id,
        normalize_audio=True,
    )
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

    with tempfile.TemporaryDirectory(prefix="readukrainian-piper-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        for index, job in enumerate(jobs, start=1):
            started_at = time.perf_counter()
            wav_path = temp_dir / f"{index}.wav"
            mp3_path = args.output / job["filename"]
            with wave.open(str(wav_path), "wb") as wav_file:
                voice.synthesize_wav(
                    job["word"],
                    wav_file,
                    syn_config=synthesis_config,
                )
            encode_mp3(ffmpeg, wav_path, mp3_path)
            if index == 1:
                with wave.open(str(wav_path), "rb") as sample_wav:
                    duration_seconds = sample_wav.getnframes() / sample_wav.getframerate()
                build_seconds = time.perf_counter() - started_at
                sample_bytes = mp3_path.stat().st_size
                print(
                    "sample proof: "
                    + json.dumps(
                        {
                            "word": job["word"],
                            "durationSeconds": round(duration_seconds, 3),
                            "mp3Bytes": sample_bytes,
                            "buildSeconds": round(build_seconds, 3),
                        },
                        ensure_ascii=False,
                    ),
                    flush=True,
                )
                if duration_seconds > MAX_SAMPLE_AUDIO_SECONDS:
                    raise RuntimeError("Sample audio is unexpectedly long; full batch stopped")
                if sample_bytes > MAX_SAMPLE_BYTES:
                    raise RuntimeError("Sample MP3 is unexpectedly large; full batch stopped")
                if build_seconds > MAX_SAMPLE_BUILD_SECONDS:
                    raise RuntimeError("Sample synthesis is unexpectedly slow; full batch stopped")

            if index == 1 or index % 100 == 0 or index == len(jobs):
                print(f"synthesized {index}/{len(jobs)}", flush=True)


if __name__ == "__main__":
    main()
