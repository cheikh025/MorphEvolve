"""AHC001 contest-text parsing and scoring, matching the pinned ALE-Bench tools.

The shared runner owns candidate execution and the five-second deadline.
This module preserves parse_output and compute_score_details behavior,
including the order-dependent overlap checks for rectangles missing targets.
"""

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

def integer(token, low, high):
    # Python int accepts underscores and Unicode digits; Rust's parser does not.
    if not re.fullmatch(r"[+-]?[0-9]+", token):
        raise ValueError("invalid integer")
    value = int(token)
    if not low <= value <= high:
        raise ValueError("integer out of range")
    return value

def tokens(value):
    return re.findall(r"(?:\S|[\x1c-\x1f])+", value)

# --- end inlined primitives ---


def score(instance: str, output: str) -> int:
    data = list(map(int, instance.split()))
    n = data[0]
    ads = [data[i:i + 3] for i in range(1, 1 + n * 3, 3)]
    values = tokens(output)
    if len(values) != n * 4:
        raise ValueError(f"expected {n} rectangles (four integers each)")
    # Upstream validates every coordinate before computing any score.
    coordinates = [integer(value, 0, 10000) for value in values]
    rectangles = [coordinates[i:i + 4] for i in range(0, len(coordinates), 4)]
    total = 0.0
    for i, (a, b, c, d) in enumerate(rectangles):
        if a >= c or b >= d:
            raise ValueError(f"rectangle {i} does not have positive area")
        x, y, requested = ads[i]
        if not (a <= x < c and b <= y < d):
            continue
        for j in range(i):
            aj, bj, cj, dj = rectangles[j]
            if min(c, cj) > max(a, aj) and min(d, dj) > max(b, bj):
                raise ValueError(f"rectangles {j} and {i} overlap")
        area = (c - a) * (d - b)
        ratio = min(requested, area) / max(requested, area)
        total += 1.0 - (1.0 - ratio) * (1.0 - ratio)
    return rounded(1e9 * total / n)
