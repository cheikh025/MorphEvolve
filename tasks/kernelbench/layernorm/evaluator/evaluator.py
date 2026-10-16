"""KernelBench evaluator for Organon.

Scores with SkyDiscover's KernelBench evaluator (kernelbench_evaluator.py, unchanged)
and changes only how a failure is reported. That evaluator returns the speedup over
PyTorch eager when the kernel compiles and is correct, -100 when it does not, and -1
when the evaluation times out. The kit reads a negative fitness as a score to
minimize (merit() ranks it by 1/|fitness|), which would rank a timeout (-1) above
every candidate slower than eager. The kit's failure score is 0, so any score that
is not a positive speedup is reported as 0; the original score is kept in the
metrics as `kernelbench_score`.
"""

from kernelbench_evaluator import evaluate as kernelbench_evaluate


def evaluate(program_path: str) -> dict:
    result = kernelbench_evaluate(program_path)
    score = result.get("combined_score")
    if isinstance(score, (int, float)) and score > 0:
        return result
    return {**result, "kernelbench_score": score, "combined_score": 0.0}
