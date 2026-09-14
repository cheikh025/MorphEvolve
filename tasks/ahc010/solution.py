"""Keep every tile's initial orientation as a valid starting solution."""

#EVOLVE_START
import sys


def solve():
    tiles = [sys.stdin.readline().strip() for _ in range(30)]
    print("0" * 900)
#EVOLVE_END


if __name__ == "__main__":
    solve()
