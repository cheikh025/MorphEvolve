"""AHC002 output validation and integer scoring."""

# --- inlined from the shared tool-port primitives; do not edit ---

DIR = {"U": (-1, 0), "D": (1, 0), "L": (0, -1), "R": (0, 1)}

WHITESPACE = "\t\n\v\f\r \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"

def trim(value):
    return value.strip(WHITESPACE)

# --- end inlined primitives ---


def score(instance, output):
    values = list(map(int, instance.split()))
    i, j = values[:2]
    tiles, points = values[2:2502], values[2502:]
    used = {tiles[i * 50 + j]}
    total = points[i * 50 + j]
    for char in trim(output):
        if char not in DIR:
            raise ValueError("Illegal output")
        di, dj = DIR[char]
        i, j = i + di, j + dj
        if not (0 <= i < 50 and 0 <= j < 50):
            raise ValueError("Out of range")
        tile = tiles[i * 50 + j]
        if tile in used:
            raise ValueError("Stepped on the same tile twice")
        used.add(tile)
        total += points[i * 50 + j]
    return total
