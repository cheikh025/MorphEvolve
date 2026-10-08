"""Evaluation subprocess runner for Kernel Builder on the simulated VLIW machine.

Runs the KernelBuilder in a subprocess with the simulator across random test trees
and reports cycle count and correctness.
"""

from __future__ import annotations

import json
import os
import textwrap

BASELINE_CYCLES = 147_734

BEST_KNOWN_CYCLES = 864

REAL_PARAMS = {"forest_height": 10, "rounds": 16, "batch_size": 256, "iterations": 8}

def _run_evaluation(
    program_path: str,
    utils_path: str,
    timeout: int,
    python_cmd: list[str],
    params: dict,
) -> dict:
    """Run the kernel in a subprocess with the frozen simulator.

    Matches the original submission_tests.py methodology:
    - Uses frozen_problem simulator directly
    - Runs N correctness checks with random trees
    - Reports cycle count from a single run (deterministic for given instruction sequence)
    - No fixed random seed (kernel builder should be internally deterministic)
    """
    forest_height = params["forest_height"]
    rounds = params["rounds"]
    batch_size = params["batch_size"]
    iterations = params["iterations"]
    script = textwrap.dedent(f"""\
        import json, sys, os

        # Make frozen_problem importable
        sys.path.insert(0, os.path.dirname({str(utils_path)!r}))
        from frozen_problem import Machine, build_mem_image, reference_kernel2, Tree, Input, N_CORES

        # Load KernelBuilder from the program file
        source = open({os.path.abspath(program_path)!r}).read()
        namespace = {{"__name__": "__main__"}}
        exec(source, namespace)

        if "KernelBuilder" not in namespace:
            print(json.dumps({{"error": "KernelBuilder class not found in program"}}))
            sys.exit(0)

        KernelBuilder = namespace["KernelBuilder"]

        def do_kernel_test(forest_height, rounds, batch_size):
            forest = Tree.generate(forest_height)
            inp = Input.generate(forest, batch_size, rounds)
            mem = build_mem_image(forest, inp)

            kb = KernelBuilder()
            kb.build_kernel(forest.height, len(forest.values), len(inp.indices), rounds)

            machine = Machine(mem, kb.instrs, kb.debug_info(), n_cores=N_CORES)
            machine.enable_pause = False
            machine.enable_debug = False
            machine.run()

            for ref_mem in reference_kernel2(mem):
                pass

            inp_values_p = ref_mem[6]
            actual = machine.mem[inp_values_p : inp_values_p + len(inp.values)]
            expected = ref_mem[inp_values_p : inp_values_p + len(inp.values)]
            if actual != expected:
                return machine.cycle, False, "Incorrect output values"
            return machine.cycle, True, ""

        for i in range({iterations}):
            cycles, is_correct, error_msg = do_kernel_test({forest_height}, {rounds}, {batch_size})
            if not is_correct:
                print(json.dumps({{
                    "cycles": cycles,
                    "is_correct": False,
                    "error_msg": f"Iteration {{i}}: {{error_msg}}",
                }}))
                sys.exit(0)

        # Report the cycle count from the last run
        print(json.dumps({{
            "cycles": cycles,
            "is_correct": True,
            "error_msg": "",
        }}))
    """)
    import subprocess
    result = subprocess.run(
        [*python_cmd, "-c", script],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip()[-2000:])
    stdout = result.stdout.strip()
    if not stdout:
        raise RuntimeError(
            f"Script produced no output.\nstderr: {result.stderr.strip()[-1000:]}"
        )
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        # Handle stdout pollution from print statements
        for line in reversed(stdout.splitlines()):
            line = line.strip()
            if line.startswith("{"):
                try:
                    return json.loads(line)
                except json.JSONDecodeError:
                    continue
        raise RuntimeError(
            f"No valid JSON in output.\nstdout: {stdout[-500:]}\nstderr: {result.stderr.strip()[-500:]}"
        )
