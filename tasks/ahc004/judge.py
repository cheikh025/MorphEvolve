"""AHC004 toroidal substring scoring, preserving duplicate input strings."""

import math
import re

# --- inlined from the shared tool-port primitives; do not edit ---

def rounded(value):
    """Rust f64::round followed by a saturating i64 cast (nonnegative scores)."""
    if math.isnan(value):
        return 0
    if value >= 2**63:
        return 2**63 - 1
    whole = int(value)
    return whole + (value - whole >= 0.5)

def tokens(value):
    return re.findall(r"(?:\S|[\x1c-\x1f])+", value)

# --- end inlined primitives ---


def score(instance, output):
    data = instance.split()
    n, m = map(int, data[:2])
    grid = tokens(output)
    if len(grid) != n or any(len(row) != n for row in grid):
        raise ValueError("illegal output dimensions")
    if any(c not in "ABCDEFGH." for row in grid for c in row):
        raise ValueError("illegal output char")
    lines = grid + ["".join(grid[i][j] for i in range(n)) for j in range(n)]
    # Strings are at most 12 characters, so doubling covers all wraparounds.
    lines = [line + line for line in lines]
    count = sum(any(word in line for line in lines) for word in data[2:2 + m])
    empty = sum(row.count(".") for row in grid)
    return rounded(1e8 * count / m if count < m else 1e8 * (2 * n * n) / (2 * n * n - empty))
