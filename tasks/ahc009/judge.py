"""AHC009 exact probability propagation in upstream floating-point order."""

import math

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

WHITESPACE = "\t\n\v\f\r \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"

def trim(value):
    return value.strip(WHITESPACE)

# --- end inlined primitives ---


def score(instance, output):
    data = instance.split()
    si, sj, ti, tj = map(int, data[:4])
    probability = float(data[4])
    h, v = data[5:25], data[25:44]
    path = trim(output)
    if len(path) > 200 or any(c not in DIR for c in path):
        raise ValueError("illegal output")
    moves = {}
    for char, (di, dj) in DIR.items():
        destinations = []
        for i in range(20):
            for j in range(20):
                x, y = i + di, j + dj
                free = 0 <= x < 20 and 0 <= y < 20
                if free:
                    free = (v[min(i, x)][j] if di else h[i][min(j, y)]) == "0"
                destinations.append(x * 20 + y if free else i * 20 + j)
        moves[char] = destinations
    current = [0.0] * 400
    current[si * 20 + sj] = 1.0
    goal, total = ti * 20 + tj, 0.0
    for t, char in enumerate(path):
        following = [0.0] * 400
        for i, mass in enumerate(current):
            if mass > 0.0:
                j = moves[char][i]
                if i != j:
                    following[j] += mass * (1.0 - probability)
                    following[i] += mass * probability
                else:
                    following[i] += mass
        current = following
        total += current[goal] * (400 - t)
        current[goal] = 0.0
    return rounded(1e8 * total / 400)
