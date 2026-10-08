"""Behavioral checks for the Kernel Builder evaluator and EvolveKit runner.

Run from the repository root with:
    python3 -m unittest discover -s tasks/kernel_builder/evaluator -p 'test_*.py' -v

These tests use the real simulator and subprocess boundary, without model calls.
"""

import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from unittest.mock import patch


EVALUATOR_DIR = Path(__file__).resolve().parent
TASK_DIR = EVALUATOR_DIR.parent
REPO_DIR = TASK_DIR.parents[1]
RUNNER = REPO_DIR / "plugins/dsh-evolve-loop/src/providers/run_evaluator.py"
SEED_CYCLES = 11_910
BASELINE_CYCLES = 147_734


def load_adapter():
    # Keep this evaluator separate from any other task's evaluator.py module.
    name = "_kernel_builder_adapter_under_test"
    spec = importlib.util.spec_from_file_location(name, EVALUATOR_DIR / "evaluator.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    old_path = sys.path[:]
    try:
        sys.path.insert(0, str(EVALUATOR_DIR))
        spec.loader.exec_module(module)
    finally:
        sys.path[:] = old_path
    return module


adapter = load_adapter()


def kernel_source(build_body):
    """A minimal submission with the same public interface as the real seed."""
    return (
        "from frozen_problem import DebugInfo\n\n"
        "class KernelBuilder:\n"
        "    def __init__(self):\n"
        "        self.instrs = []\n\n"
        "    def debug_info(self):\n"
        "        return DebugInfo({})\n\n"
        "    def build_kernel(self, forest_height, n_nodes, batch_size, rounds):\n"
        + textwrap.indent(build_body, "        ")
        + "\n"
    )


class KernelBuilderEvaluatorTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory(prefix="kernel-builder-test-")
        self.addCleanup(self.workspace.cleanup)
        self.directory = Path(self.workspace.name)

    def evaluate_source(self, source):
        program = self.directory / "arbitrary_candidate_filename.py"
        program.write_text(source, encoding="utf-8")
        return adapter.evaluate(str(program))

    def assert_failed(self, result):
        self.assertEqual(result["combined_score"], 0.0, result)
        self.assertIs(result["is_correct"], False, result)
        self.assertIsInstance(result["error"], str, result)
        self.assertTrue(result["error"], result)

    def test_official_seed_passes_full_workload_at_measured_cycles(self):
        result = adapter.evaluate(str(TASK_DIR / "kernel_builder.py"))
        self.assertIs(result["is_correct"], True, result)
        self.assertEqual(result["cycles"], SEED_CYCLES, result)
        self.assertEqual(result["correctness_checks"], 8, result)
        self.assertEqual(result["baseline_cycles"], BASELINE_CYCLES, result)
        self.assertAlmostEqual(result["combined_score"], BASELINE_CYCLES / SEED_CYCLES)
        self.assertAlmostEqual(result["speedup"], result["combined_score"])

    def test_no_op_kernel_is_incorrect_and_scores_zero(self):
        result = self.evaluate_source(kernel_source("pass"))
        self.assert_failed(result)
        self.assertIn("incorrect", result["error"].lower())

    def test_eighth_correctness_check_is_required(self):
        # A kernel that works on seven random inputs must still fail the task.
        source = (TASK_DIR / "kernel_builder.py").read_text(encoding="utf-8")
        source += textwrap.dedent("""

            _original_build_kernel = KernelBuilder.build_kernel
            _build_count = 0

            def _fail_eighth_build(self, *args):
                global _build_count
                _build_count += 1
                if _build_count == 8:
                    self.instrs = []
                else:
                    _original_build_kernel(self, *args)

            KernelBuilder.build_kernel = _fail_eighth_build
        """)
        result = self.evaluate_source(source)
        self.assert_failed(result)
        self.assertIn("Iteration 7", result["error"])

    def test_missing_kernel_builder_is_reported(self):
        result = self.evaluate_source("answer = 42\n")
        self.assert_failed(result)
        self.assertIn("KernelBuilder", result["error"])

    def test_invalid_python_is_reported(self):
        result = self.evaluate_source("def broken(:\n")
        self.assert_failed(result)
        self.assertIn("SyntaxError", result["error"])

    def test_invalid_instruction_and_slot_overflow_score_zero(self):
        cases = {
            "unknown opcode": "self.instrs = [{'alu': [('bad_opcode', 0, 0, 0)]}]",
            "load slot overflow": "self.instrs = [{'load': [('const', 0, 1)] * 3}]",
        }
        for name, body in cases.items():
            with self.subTest(name=name):
                self.assert_failed(self.evaluate_source(kernel_source(body)))

    def test_hanging_builder_is_terminated_by_internal_timeout(self):
        started = time.monotonic()
        with patch.object(adapter, "EVALUATION_TIMEOUT", 0.2):
            result = self.evaluate_source(kernel_source("while True:\n    pass"))
        elapsed = time.monotonic() - started
        self.assert_failed(result)
        self.assertRegex(result["error"].lower(), r"timed out|timeout")
        self.assertLess(elapsed, 10, "The evaluator did not terminate its child promptly")

    def test_real_runner_accepts_copied_task_markers_and_arbitrary_filename(self):
        copied_task = self.directory / "copied_task"
        copied_task.mkdir()
        shutil.copytree(EVALUATOR_DIR, copied_task / "evaluator", ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copy2(TASK_DIR / "task.json", copied_task / "task.json")
        program = self.directory / "worker_submission_with_different_name.py"
        source = (TASK_DIR / "kernel_builder.py").read_text(encoding="utf-8")
        self.assertIn("#EVOLVE_START", source)
        self.assertIn("#EVOLVE_END", source)
        # The upstream runner tolerates submission print statements, and the
        # outer EvolveKit runner must still emit exactly one result JSON line.
        program.write_text("print('candidate diagnostic')\n" + source, encoding="utf-8")
        outcome = subprocess.run(
            [sys.executable, "-B", str(RUNNER), str(copied_task), str(program)],
            cwd=copied_task / "evaluator",
            capture_output=True,
            text=True,
            timeout=150,
        )
        self.assertEqual(outcome.returncode, 0, outcome.stderr)
        lines = outcome.stdout.strip().splitlines()
        self.assertEqual(len(lines), 1, outcome.stdout)
        result = json.loads(lines[0])
        self.assertAlmostEqual(result["fitness"], BASELINE_CYCLES / SEED_CYCLES)
        self.assertIs(result["metrics"]["is_correct"], True, result)
        self.assertEqual(result["metrics"]["cycles"], SEED_CYCLES, result)
        self.assertEqual(result["metrics"]["correctness_checks"], 8, result)


if __name__ == "__main__":
    unittest.main()
