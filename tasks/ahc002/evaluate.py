"""Evaluate one candidate on one instance of ahc002, under this task's time limit.

    python evaluate.py --candidate <dir with solution.py> --seed <n>

Prints one JSON object. A candidate that times out, crashes, or emits invalid
output scores zero. A failure of this harness itself raises instead, so it is
never mistaken for a candidate scoring zero.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import generate
import judge

# This task's per-instance budget, in seconds. Part of how an instance is
# scored: exceeding it is a zero, not a slow success.
TIME_LIMIT = 2.0


def _kill_tree(process: subprocess.Popen) -> None:
    """Kill the solution and anything it spawned, so it cannot outlive its deadline."""
    if os.name == "posix":
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
    else:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)],
                       capture_output=True, check=False)


def _run(command: list[str], *, cwd: Path, stdin: Path, stdout: Path,
         stderr: Path, timeout: float) -> int | None:
    """Run to completion or the deadline; None means it ran out of time."""
    spawn: dict = {"start_new_session": True} if os.name == "posix" \
        else {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    with stdin.open("rb") as inp, stdout.open("wb") as out, stderr.open("wb") as err:
        process = subprocess.Popen(command, cwd=cwd, stdin=inp, stdout=out,
                                   stderr=err, **spawn)
        try:
            return process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            return None
        finally:
            _kill_tree(process)
            process.wait()


@contextmanager
def _scratch_dir(prefix: str) -> Iterator[Path]:
    """Yield a new empty directory under the system temp root, removed on exit.

    Uses a plain mkdir, so the directory inherits its parent's ACL. On Windows,
    tempfile.mkdtemp (mode 0o700) replaces the inherited ACL with an owner-only
    one, which a write-restricted sandbox cannot write into.
    """
    root = Path(tempfile.gettempdir())
    while True:
        path = root / f"{prefix}{secrets.token_hex(6)}"
        try:
            path.mkdir()
            break
        except FileExistsError:
            continue
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def _tail(path: Path) -> str:
    with path.open("rb") as handle:
        handle.seek(max(0, path.stat().st_size - 4096))
        return handle.read().decode("utf-8", errors="replace").strip()


def evaluate(candidate: str | Path, seed: int) -> dict:
    """Score one candidate on the instance for one seed."""
    workspace = Path(candidate).resolve()
    solution = workspace / "solution.py"
    if not solution.is_file():
        return {"seed": seed, "status": "INVALID", "score": 0,
                "error": "missing solution.py"}
    instance = generate.generate(seed)
    with _scratch_dir("ahc002-") as work:
        inp, out, err = work / "input.txt", work / "output.txt", work / "stderr.txt"
        inp.write_bytes(instance.encode("utf-8"))
        try:
            status = _run([sys.executable, str(solution)], cwd=workspace, stdin=inp,
                          stdout=out, stderr=err, timeout=TIME_LIMIT)
            if status is None:
                raise TimeoutError(f"exceeded {TIME_LIMIT:g}s")
            if status != 0:
                raise ValueError(f"process exited {status}: {_tail(err)}")
            # Bytes, not text mode: universal-newline translation would accept
            # malformed output that the reference judge rejects.
            value = judge.score(instance, out.read_bytes().decode("utf-8"))
        except TimeoutError as error:
            return {"seed": seed, "status": "TIMEOUT", "score": 0, "error": str(error)}
        except ValueError as error:
            return {"seed": seed, "status": "INVALID", "score": 0, "error": str(error)}
    return {"seed": seed, "status": "VALID", "score": value}


def main() -> None:
    parser = argparse.ArgumentParser(description="Score one candidate on one instance.")
    parser.add_argument("--candidate", required=True,
                        help="directory containing solution.py")
    parser.add_argument("--seed", type=int, required=True)
    args = parser.parse_args()
    print(json.dumps(evaluate(args.candidate, args.seed)))


if __name__ == "__main__":
    main()
