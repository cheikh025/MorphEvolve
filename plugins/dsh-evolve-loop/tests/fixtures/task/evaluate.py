"""Fixture evaluator: runs solution.py and scores the integer it prints.

    python evaluate.py --candidate <dir> --seed <n>

Like a real task evaluator, it runs the solution as a child process with its
output in a scratch directory under the system temp root, and prints one JSON
object. A solution that fails or prints no integer scores zero; the seed is
echoed but does not change the score.
"""

import argparse
import json
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--seed", type=int, required=True)
    args = parser.parse_args()
    workspace = Path(args.candidate).resolve()
    scratch = Path(tempfile.gettempdir()) / f"fixture-{secrets.token_hex(6)}"
    scratch.mkdir()
    try:
        output = scratch / "output.txt"
        with output.open("wb") as handle:
            code = subprocess.run([sys.executable, str(workspace / "solution.py")],
                                  cwd=workspace, stdout=handle, timeout=60).returncode
        text = output.read_text(encoding="utf-8").strip()
        score = int(text) if code == 0 and text.lstrip("-").isdigit() else 0
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    print(json.dumps({"seed": args.seed, "status": "VALID", "score": score}))


if __name__ == "__main__":
    main()
