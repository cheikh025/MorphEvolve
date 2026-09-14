"""Choose orders near the office and deliver each immediately after pickup."""

#EVOLVE_START
import sys


def solve():
    orders = [tuple(map(int, line.split())) for line in sys.stdin if line.strip()]

    def cost(index):
        a, b, c, d = orders[index]
        return abs(a - 400) + abs(b - 400) + abs(a - c) + abs(b - d) + abs(c - 400) + abs(d - 400)

    chosen = sorted(range(1000), key=cost)[:50]
    route = [(400, 400)]
    for index in chosen:
        a, b, c, d = orders[index]
        route.extend([(a, b), (c, d)])
    route.append((400, 400))
    print(50, *(index + 1 for index in chosen))
    print(len(route), *(coordinate for point in route for coordinate in point))
#EVOLVE_END


if __name__ == "__main__":
    solve()
