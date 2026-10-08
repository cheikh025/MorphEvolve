"""Kernel Builder evaluator for simulated VLIW SIMD execution.

The simulator and evaluation subprocess determine correctness and cycles.
Correct kernels receive the baseline scalar reference's cycle count divided
by measured cycles, and failures receive zero.
"""

import math
import subprocess
import sys
from pathlib import Path

from runner import (
    BASELINE_CYCLES,
    BEST_KNOWN_CYCLES,
    REAL_PARAMS,
    _run_evaluation,
)

EVALUATION_TIMEOUT = 120
FROZEN_PROBLEM = Path(__file__).resolve().with_name("frozen_problem.py")


def evaluate(program_path: str) -> dict:
    """Evaluate all eight official full-size cases within one 120-second limit."""
    try:
        result = _run_evaluation(
            str(Path(program_path).resolve()),
            FROZEN_PROBLEM,
            EVALUATION_TIMEOUT,
            [sys.executable, "-B"],
            REAL_PARAMS,
        )
        if not isinstance(result, dict):
            raise ValueError("Evaluation subprocess returned a non-object result")
        if "error" in result:
            raise ValueError(str(result["error"]))
        if result.get("is_correct") is not True:
            return {
                "combined_score": 0.0,
                "is_correct": False,
                "cycles": result.get("cycles"),
                "error": result.get("error_msg") or "Incorrect output values",
            }
        cycles = result.get("cycles")
        if type(cycles) is not int or cycles <= 0:
            raise ValueError(f"Invalid cycle count: {cycles!r}")
        speedup = BASELINE_CYCLES / cycles
        if not math.isfinite(speedup):
            raise ValueError("Non-finite speedup")
        return {
            "combined_score": speedup,
            "cycles": cycles,
            "is_correct": True,
            "speedup": speedup,
            "baseline_cycles": BASELINE_CYCLES,
            "best_known_cycles": BEST_KNOWN_CYCLES,
            "correctness_checks": REAL_PARAMS["iterations"],
        }
    except subprocess.TimeoutExpired:
        return {
            "combined_score": 0.0,
            "is_correct": False,
            "timeout": True,
            "error": f"Evaluation timed out after {EVALUATION_TIMEOUT}s",
        }
    except Exception as error:
        return {"combined_score": 0.0, "is_correct": False, "error": str(error)}


if __name__ == "__main__":
    import json

    if len(sys.argv) != 2:
        raise SystemExit("Usage: python evaluator.py /path/to/kernel_builder.py")
    print(json.dumps(evaluate(sys.argv[1])))
