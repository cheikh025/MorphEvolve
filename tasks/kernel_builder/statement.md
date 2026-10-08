# Kernel Builder

Optimize the instruction program for a binary-tree traversal on a simulated
VLIW SIMD machine. Minimize simulated cycles while producing exactly the
reference output. This is a CPU-hosted Python simulator; no GPU or external
packages are needed.

## Submission interface

Edit `kernel_builder.py` between `#EVOLVE_START` and `#EVOLVE_END`. Keep the
submission self-contained: EvolveKit evaluates a temporary copy of this single
file, with a different filename. Other candidate files are not loaded with it.

Define `KernelBuilder` with:

- A no-argument constructor.
- `build_kernel(self, forest_height, n_nodes, batch_size, rounds)`, which builds
  the program in `self.instrs`. Its return value is ignored.
- `debug_info(self)`, returning an object with a `scratch_map` mapping scratch
  addresses to `(name, length)` pairs. The seed's `DebugInfo` class is sufficient.

`self.instrs` is a list of instruction dictionaries: engine names map to lists
of operation tuples. Build instructions using the supplied dimensions. Actual
tree and input values are available only through simulated memory at runtime.
The builder should be deterministic. Module execution uses `__name__ ==
"__main__"` and does not supply `__file__`, so do not rely on file-relative
resources or put a standalone test or CLI behind that guard.

## Simulated machine specification

The target machine is a single-core VLIW SIMD processor with 1,536 scratch words
(each word is 32-bit unsigned, initialized to 0). Memory addresses also index 32-bit words.

Each cycle executes an instruction bundle (a dictionary mapping engine names to
operation lists). All operations in a bundle read scratch and memory as they were
at the start of the bundle; writes commit at bundle completion.

Engine slot limits per cycle:
- `alu`: up to 12 scalar operations: `(op, dest, a, b)` where `op` is `+`, `-`, `*`, `//`, `cdiv`, `^`, `&`, `|`, `<<`, `>>`, `%`, `<`, `==`.
- `valu`: up to 6 vector operations (SIMD width 8):
  - `(op, dest, a, b)`: elementwise across 8 lanes.
  - `("vbroadcast", dest, src)`: broadcast scalar `src` to 8 vector lanes `dest..dest+7`.
  - `("multiply_add", dest, a, b, c)`: `(a * b) + c` across 8 lanes.
- `load`: up to 2 load operations:
  - `("const", dest, immediate)`: load immediate value into scratch `dest`.
  - `("load", dest, addr)`: scalar read from memory address in `S[addr]`.
  - `("load_offset", dest, addr, offset)`: single-lane load `S[dest+offset] = M[S[addr+offset]]`.
  - `("vload", dest, addr)`: load 8 contiguous memory words starting at `M[S[addr]]` into `S[dest..dest+7]`.
- `store`: up to 2 store operations:
  - `("store", addr, src)`: scalar write `M[S[addr]] = S[src]`.
  - `("vstore", addr, src)`: write 8 contiguous words `S[src..src+7]` to `M[S[addr]..S[addr]+7]`.
- `flow`: up to 1 control flow operation:
  - `("select", dest, cond, a, b)`: scalar conditional select.
  - `("vselect", dest, cond, a, b)`: vector conditional select across 8 lanes.
  - `("add_imm", dest, a, immediate)`: add immediate.
  - `("cond_jump", cond, target)`, `("jump", target)`, `("halt",)`, `("pause",)`.

### Memory layout

Total memory length is exactly 2,566 words:
- Header words (0 to 6):
  - `0`: `rounds` (16)
  - `1`: `n_nodes` (2,047)
  - `2`: `batch_size` (256)
  - `3`: `forest_height` (10)
  - `4`: `tree_values` base pointer (7)
  - `5`: `input_indices` base pointer (2,054)
  - `6`: `input_values` base pointer (2,310)
- Tree values: addresses 7 through 2,053 (2,047 nodes)
- Input indices: addresses 2,054 through 2,309 (256 words)
- Input values: addresses 2,310 through 2,565 (256 words)

There is no extra writable memory beyond address 2,565.

## Workload and required output

The official workload is fixed:

| Parameter | Value |
| --- | ---: |
| Tree height | 10 |
| Tree nodes | 2,047 |
| Batch size | 256 |
| Traversal rounds | 16 |
| SIMD width | 8 |
| Cores | 1 |
| Scratch words | 1,536 |
| Randomized correctness checks per evaluation | 8 |

Every input starts at tree index zero. Tree values and initial input values are
fresh random integers in `[0, 2**30 - 1]` for each check. No fixed random seed is
used. For each input and each round:

```text
value = hash32(value XOR tree[index])
index = 2 * index + (1 if value is even else 2)
if index >= n_nodes:
    index = 0
```

Write the final values to the input-values memory array. Correctness compares
all 256 final values exactly; final indices and intermediate states are not checked.
Traversal indices still need to be correct when used to determine later values.
The task is specialized to the dimensions above; general correctness for other
batch sizes is not part of this evaluation.

## Performance and fitness

Each cycle can execute up to 12 scalar ALU operations, 6 vector operations,
2 load operations, 2 store operations, and 1 flow operation. Loads and stores
include vector operations; one vector load or store transfers eight contiguous
words using one slot. Instruction effects become visible only after the entire
bundle finishes. A dependent operation in the same bundle reads the old value.

The evaluator runs all eight checks and reports the cycle count of the last
check. It does not average cycles across checks. The performance measure is
simulated cycles, not Python builder time or wall time. However, loading the
submission, building eight programs, simulating them, and checking correctness
must all finish within **120 seconds total**.

EvolveKit maximizes this fitness:

```text
combined_score = 147734 / cycles   if all eight checks pass
combined_score = 0                on incorrect output, error, or timeout
```

`cycles` is also retained as a metric. The constant 147,734 is the baseline
scalar reference. The supplied seed already uses SIMD and VLIW packing and takes
**11,910 cycles**, giving fitness approximately **12.4042**. A cycle count of
864 cycles is the best-known reference (~171x speedup); it is not a score cap.
Improving below that reference continues to improve fitness.

Potential improvements include instruction scheduling across independent inputs,
better use of engine slots, vectorization, reduced memory traffic, and loop
unrolling. Observe the 1,536-word scratch limit and the exact instruction rules.

## Evaluation rules

- Implement the traversal through emitted machine instructions. Do not inspect
  evaluator state, monkeypatch the simulator or random generator, access generated
  test data from Python, or forge evaluation output.
- Only the solution code inside the markers may change. Task files and the
  official evaluator are fixed.
- The search loop performs official evaluations after candidate generation.
- `pause` and debug checks are disabled during evaluation. A flow `pause` still
  occupies an instruction bundle and contributes a cycle.
- Memory contains exactly 2,566 words for this workload as detailed in the Memory
  Layout section above.
