"""AHC010 tile rotation, track traversal and two-longest-loop score."""

# --- inlined from the shared tool-port primitives; do not edit ---

WHITESPACE = "\t\n\v\f\r \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"

def trim(value):
    return value.strip(WHITESPACE)

# --- end inlined primitives ---


ROTATE = [1, 2, 3, 0, 5, 4, 7, 6]
TO = [(1, 0, -1, -1), (3, -1, -1, 0), (-1, -1, 3, 2),
      (-1, 2, 1, -1), (1, 0, 3, 2), (3, 2, 1, 0),
      (2, -1, 0, -1), (-1, 3, -1, 1)]
DIR = [(0, -1), (-1, 0), (0, 1), (1, 0)]


def score(instance, output):
    lines = output.split("\n")
    if lines[-1] == "":
        lines.pop()
    if not lines:
        raise ValueError("empty output")
    for line in lines:
        line = trim(line)
        if len(line) != 900 or any(c not in "0123" for c in line):
            raise ValueError("illegal output")
    tiles = [int(c) for c in "".join(instance.split())]
    for i, rotation in enumerate(trim(lines[-1])):
        for _ in range(int(rotation)):
            tiles[i] = ROTATE[tiles[i]]
    used = set()
    lengths = []
    for i in range(30):
        for j in range(30):
            for d in range(4):
                if TO[tiles[i * 30 + j]][d] == -1 or (i, j, d) in used:
                    continue
                x, y, direction, length = i, j, d, 0
                while (x, y, direction) not in used:
                    following = TO[tiles[x * 30 + y]][direction]
                    if following == -1:
                        break
                    length += 1
                    used.add((x, y, direction))
                    direction = following
                    used.add((x, y, direction))
                    dx, dy = DIR[direction]
                    x, y = x + dx, y + dy
                    if not (0 <= x < 30 and 0 <= y < 30):
                        break
                    direction = (direction + 2) % 4
                if (x, y, direction) == (i, j, d):
                    lengths.append(length)
    lengths.sort()
    return lengths[-1] * lengths[-2] if len(lengths) >= 2 else 0
