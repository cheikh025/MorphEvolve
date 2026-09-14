"""Place a 1x1 advertisement on each company's requested point."""

#EVOLVE_START
import sys


def solve():
    read = sys.stdin.readline
    n = int(read())
    ads = [tuple(map(int, read().split())) for _ in range(n)]
    for x, y, requested_area in ads:
        print(x, y, x + 1, y + 1)
#EVOLVE_END


if __name__ == "__main__":
    solve()
