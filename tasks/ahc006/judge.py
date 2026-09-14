"""AHC006 last-output parsing, ordered pickups and delivery cost."""

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


def score(instance, output):
    orders = [tuple(map(int, line.split())) for line in instance.splitlines()]
    stream = iter(tokens(output))
    selected = route = None
    def read(low, high):
        try:
            return integer(next(stream), low, high)
        except StopIteration:
            raise ValueError("Unexpected EOF") from None
    for first in stream:
        m = integer(first, 0, 1000)
        selected = [read(1, 1000) - 1 for _ in range(m)]
        n = read(0, 1000000000)
        route = [(read(0, 800), read(0, 800)) for _ in range(n)]
    if selected is None:
        raise ValueError("empty output")
    if len(set(selected)) != len(selected):
        raise ValueError("duplicate order")
    if not route or route[0] != (400, 400) or route[-1] != (400, 400):
        raise ValueError("route must begin and end at the office")
    first, last = {}, {}
    for i, point in enumerate(route):
        first.setdefault(point, i)
        last[point] = i
    for index in selected:
        a, b, c, d = orders[index]
        if (a, b) not in first or (c, d) not in last or first[a, b] >= last[c, d]:
            raise ValueError(f"{index + 1}-th delivery has not been completed")
    if len(selected) != 50:
        raise ValueError("Illegal output (m != 50)")
    cost = sum(abs(a - c) + abs(b - d) for (a, b), (c, d) in zip(route, route[1:]))
    return rounded(1e8 / (1000 + cost))
