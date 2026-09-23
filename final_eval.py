"""Final score of a finished ALE-Bench run: the private evaluation of its best candidate.

    <benchmark python> final_eval.py <task folder>

As with EvoX, the private evaluation (private_eval.py, next to this script, on the
hidden test cases) runs once the search is over, on the best candidate in
run/population.jsonl, chosen as the evolve loop chooses it. The search never sees these
scores. Our #EVOLVE_START/#EVOLVE_END lines are removed from the program first.
The output of private_eval.py is saved to run/final.txt.

Only ALE-Bench tasks have a separate final evaluation; for the others the
recorded fitness is the final score.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

MARKERS = {b"#EVOLVE_START", b"#EVOLVE_END"}


def merit(fitness: float) -> float:
    """As the evolve loop ranks candidates (merit() in population.js): a failed evaluation (0)
    counts as 0, and a minimize task's scores, which its evaluator makes negative, as 1/|fitness|."""
    return fitness if fitness > 0 else -1 / fitness if fitness < 0 else 0.0


def main() -> None:
    task = Path(sys.argv[1]).resolve()
    private_eval = Path(__file__).resolve().parent / "private_eval.py"
    settings = json.loads((task / "task.json").read_text(encoding="utf-8"))
    lines = (task / "run" / "population.jsonl").read_text(encoding="utf-8").splitlines()
    best = max((json.loads(line) for line in lines if line.strip()), key=lambda row: merit(row["fitness"]))
    program = task / "run" / "candidates" / best["id"] / settings["program"]
    code = b"\n".join(line for line in program.read_bytes().split(b"\n") if line.strip() not in MARKERS)

    with tempfile.TemporaryDirectory() as scratch:
        plain = Path(scratch) / program.name
        plain.write_bytes(code)
        completed = subprocess.run(
            [sys.executable, str(private_eval), "--program-path", str(plain), "--problem-id", task.name],
            cwd=private_eval.parent, stdout=subprocess.PIPE, text=True)

    report = f"best candidate: {best['id']} (fitness {best['fitness']})\n{completed.stdout}"
    (task / "run" / "final.txt").write_text(report, encoding="utf-8")
    print(report)
    sys.exit(completed.returncode)


if __name__ == "__main__":
    main()
