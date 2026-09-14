"""AHC005 closed patrol validation, visibility and score."""

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

DIR = {"U": (-1, 0), "D": (1, 0), "L": (0, -1), "R": (0, 1)}

def tokens(value):
    return re.findall(r"(?:\S|[\x1c-\x1f])+", value)

# --- end inlined primitives ---


def score(instance, output):
    data = instance.split()
    n, si, sj = map(int, data[:3])
    grid = data[3:]
    out = tokens(output)
    if len(out) > 1:
        raise ValueError("Too Many Output")
    path = out[0] if out else ""
    i, j, length = si, sj, 0
    positions = {(i, j)}
    for char in path:
        if char not in DIR:
            raise ValueError("Illegal output")
        di, dj = DIR[char]
        i, j = i + di, j + dj
        if not (0 <= i < n and 0 <= j < n) or grid[i][j] == "#":
            raise ValueError("Visiting an obstacle")
        length += int(grid[i][j])
        positions.add((i, j))
    if (i, j) != (si, sj):
        raise ValueError("You have to go back to the starting point")
    visible = set()
    for i, j in positions:
        for di, dj in DIR.values():
            x, y = i, j
            while 0 <= x < n and 0 <= y < n and grid[x][y] != "#":
                visible.add((x, y))
                x, y = x + di, y + dj
    roads = sum(c != "#" for row in grid for c in row)
    value = 1e4 * len(visible) / roads
    if len(visible) == roads:
        value += 1e7 * n / length if length else float("inf")
    return rounded(value)
