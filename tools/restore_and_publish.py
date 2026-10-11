#!/usr/bin/env python3
"""Restore bundled sounds from the original .wox; optionally push a v2.0.1 release tag.

Run from a local checkout:
python tools/restore_and_publish.py "Manasikara-v2.0.0(4).wox" --confirm-rights --publish

Requires Git/GitHub authentication. The GitHub workflow creates the public .wox
release only after all automated checks and packaging succeed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import wave
import zipfile

ROOT = Path(__file__).resolve().parents[1]
IDENTITY = "ad468a1d-fdb5-4fb0-88a9-d6778bb11d96"
REPOSITORY = "Archetype444/Wox.Plugin.Manasikara"
ORIGINAL_SHA = "32e3133bd1b106fe650c80e80f9ad80a007cddc6e7bf5c7d4074943b28d341c9"


def run(*args):
    print("+", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("archive", type=Path)
    p.add_argument("--publish", action="store_true", help="Test, push sounds to main, and push v2.0.1 tag")
    p.add_argument("--confirm-rights", action="store_true", help="Confirm permission to publicly redistribute all audio, including the Mudita recording")
    args = p.parse_args()
    if args.publish and not args.confirm_rights:
        p.error("--publish requires --confirm-rights; the supplied Mudita audio is not identified as CC0.")
    meta = json.loads((ROOT / "src/plugin.json").read_text(encoding="utf8"))
    if meta["Id"] != IDENTITY or meta["Version"] != "2.0.1":
        p.error("Expected the Manasikara v2.0.1 repository with the original ID.")
    missing = []
    with zipfile.ZipFile(args.archive) as z:
        bad = z.testzip()
        if bad:
            p.error("Corrupted archive: " + bad)
        original = json.loads(z.read("plugin.json"))
        if original["Id"] != IDENTITY:
            p.error("Plugin ID does not match.")
        audio = sorted(n for n in z.namelist() if n.startswith("sounds/") and n.endswith((".wav", ".mp3")))
        if len([n for n in audio if n.endswith(".wav")]) != 52 or "sounds/mudita/original.mp3" not in audio:
            p.error("Archive must contain all 52 WAV files and original Mudita MP3.")
        if hashlib.sha256(z.read("sounds/mudita/original.mp3")).hexdigest() != ORIGINAL_SHA:
            p.error("Mudita MP3 checksum mismatch.")
        for item in audio:
            rel = Path(item)
            if ".." in rel.parts or len(rel.parts) != 3:
                p.error("Unsafe audio path in archive.")
            data = z.read(item)
            target = ROOT / "src" / rel
            if target.exists():
                if target.read_bytes() != data:
                    p.error("Existing file differs; refusing overwrite: " + item)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                missing.append(item)
            if item.endswith(".wav"):
                with wave.open(str(target), "rb") as wav:
                    if wav.getsampwidth() != 2 or wav.getframerate() != 44100:
                        p.error("Invalid WAV format: " + item)
    print("Restored", len(missing), "missing audio files; all 52 WAVs verified.")
    if not args.publish:
        print("Local only. To publish, rerun with --confirm-rights --publish.")
        return
    origin = subprocess.check_output(["git", "remote", "get-url", "origin"], cwd=ROOT, text=True).strip()
    if REPOSITORY.lower() not in origin.lower():
        p.error("Wrong remote: " + origin)
    branch = subprocess.check_output(["git", "branch", "--show-current"], cwd=ROOT, text=True).strip()
    if branch != "main":
        p.error("Switch to main before publishing.")
    run("node", "--test", "tests/regression.test.js")
    run(sys.executable, "tools/package.py", "--chime", "brass", "--meditation", "mudita", "--finish", "bowl")
    run("git", "add", "--", "src/sounds/")
    staged = subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT, text=True).splitlines()
    if any(not name.startswith("src/sounds/") for name in staged):
        p.error("There are unrelated staged changes; unstage these first.")
    if staged:
        run("git", "commit", "-m", "Restore complete Manasikara audio for v2.0.1")
        run("git", "push", "origin", "main")
    if subprocess.check_output(["git", "tag", "-l", "v2.0.1"], cwd=ROOT, text=True).strip():
        p.error("The v2.0.1 tag already exists. Do not overwrite it.")
    run("git", "tag", "-a", "v2.0.1", "-m", "Manasikara 2.0.1")
    run("git", "push", "origin", "v2.0.1")
    print("Watch https://github.com/" + REPOSITORY + "/actions for the release workflow.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, KeyError, ValueError, zipfile.BadZipFile, subprocess.CalledProcessError) as e:
        sys.exit(str(e))
