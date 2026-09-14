"""Pack supplied strings into horizontal rows of the genome."""

#EVOLVE_START
import sys


def solve():
    read = sys.stdin.readline
    n, m = map(int, read().split())
    strings = [read().strip() for _ in range(m)]
    rows = [""] * n
    for word in sorted(set(strings), key=lambda word: (-len(word), word)):
        for i in range(n):
            if len(rows[i]) + len(word) <= n:
                rows[i] += word
                break
    print("\n".join(row.ljust(n, "A") for row in rows))
#EVOLVE_END


if __name__ == "__main__":
    solve()
