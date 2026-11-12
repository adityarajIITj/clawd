"""
CLAWD: The Spark Odyssey — one-command build.

    python build.py            # build everything into dist/
    python build.py --serve    # build, then launch the local server + browser
    python build.py --audio    # force re-synthesis of the soundtrack

Pipeline:
    native/cpp/fx.cpp      --clang++ (wasm32, freestanding)-->  dist/wasm/fx.wasm
    native/rust            --cargo (wasm32-unknown-unknown)-->  dist/wasm/clawd_core.wasm
    levels/*.toml          --tools/levelc.py (compile+lint)-->  dist/levels/*.json
    tools/audiogen.py      --procedural SFX synthesis------>  dist/audio/sfx_*.wav
    assets/music/*.mp3     --copy (author's own soundtrack)-->  dist/audio/
    web/                   --copy-------------------------->  dist/
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"


def find_tool(name: str, extra: list[Path]) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    for d in extra:
        for cand in (d / name, d / f"{name}.exe"):
            if cand.exists():
                return str(cand)
    return None


def step(title: str):
    print(f"\n\033[38;5;173m✷\033[0m {title}")


def run(cmd: list[str], cwd: Path | None = None, env=None) -> None:
    r = subprocess.run(cmd, cwd=cwd, env=env)
    if r.returncode != 0:
        sys.exit(f"  ✗ command failed: {' '.join(cmd)}")


def build_cpp() -> None:
    step("C++ VFX core  ->  wasm")
    clang = find_tool("clang++", [Path("C:/msys64/clang64/bin"), Path("C:/Program Files/LLVM/bin"), Path("/usr/bin")])
    if not clang:
        sys.exit("  ✗ clang++ not found (install LLVM or MSYS2 clang64)")
    out = DIST / "wasm" / "fx.wasm"
    out.parent.mkdir(parents=True, exist_ok=True)
    run([clang, "--target=wasm32", "-O3", "-std=c++17", "-nostdlib", "-fno-exceptions", "-fno-rtti", "-mbulk-memory",
         "-Wall", "-Wl,--no-entry", "-Wl,--export-dynamic", "-Wl,--strip-all", "-o", str(out), str(ROOT / "native/cpp/fx.cpp")])
    print(f"  ✓ {out.relative_to(ROOT)}  ({out.stat().st_size / 1024:.1f} KB)")


def build_rust() -> None:
    step("Rust gameplay core  ->  wasm")
    cargo = find_tool("cargo", [Path.home() / ".cargo" / "bin"])
    if not cargo:
        sys.exit("  ✗ cargo not found (install Rust via rustup)")
    env = dict(os.environ)
    env["PATH"] = str(Path(cargo).parent) + os.pathsep + env.get("PATH", "")
    run([cargo, "build", "--release", "--target", "wasm32-unknown-unknown", "--quiet"], cwd=ROOT / "native/rust", env=env)
    src = ROOT / "native/rust/target/wasm32-unknown-unknown/release/clawd_core.wasm"
    dst = DIST / "wasm" / "clawd_core.wasm"
    shutil.copy2(src, dst)
    print(f"  ✓ {dst.relative_to(ROOT)}  ({dst.stat().st_size / 1024:.1f} KB)")


def build_levels() -> None:
    step("Levels  ->  compile + reachability lint")
    run([sys.executable, str(ROOT / "tools/levelc.py"), str(ROOT / "levels"), str(DIST / "levels")])


def build_audio(force: bool) -> None:
    step("Sound effects  ->  procedural synthesis")
    out = DIST / "audio"
    marker = out / "sfx_quest.wav"
    src = ROOT / "tools/audiogen.py"
    if not force and marker.exists() and marker.stat().st_mtime > src.stat().st_mtime:
        print("  ✓ up to date (use --audio to force)")
        return
    run([sys.executable, str(src), str(out)])


def copy_music() -> None:
    step("Soundtrack  ->  dist/audio (author's own MP3s)")
    out = DIST / "audio"
    out.mkdir(parents=True, exist_ok=True)
    for stale in out.glob("music_*.wav"):  # the old generated soundtrack
        stale.unlink()
    n = 0
    for f in sorted((ROOT / "assets" / "music").glob("*.mp3")):
        shutil.copy2(f, out / f.name)
        n += 1
    print(f"  ✓ {n} tracks")


def copy_web() -> None:
    step("Web runtime  ->  dist/")
    for item in (ROOT / "web").iterdir():
        dst = DIST / item.name
        if item.is_dir():
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(item, dst)
        else:
            shutil.copy2(item, dst)
    print("  ✓ copied")


def main() -> None:
    t0 = time.time()
    args = set(sys.argv[1:])
    DIST.mkdir(exist_ok=True)
    build_cpp()
    build_rust()
    build_levels()
    build_audio("--audio" in args)
    copy_music()
    copy_web()
    print(f"\n\033[38;5;173m✷ Build complete in {time.time() - t0:.1f}s\033[0m  ->  {DIST}")
    if "--serve" in args:
        subprocess.run([sys.executable, str(ROOT / "tools/serve.py")])


if __name__ == "__main__":
    main()
