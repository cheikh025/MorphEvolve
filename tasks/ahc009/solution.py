"""Find a shortest unobstructed path as an initial commuting route."""

#EVOLVE_START
from collections import deque
import sys


def solve():
    read = sys.stdin.readline
    si, sj, ti, tj, probability = read().split()
    start, goal = (int(si), int(sj)), (int(ti), int(tj))
    horizontal = [read().strip() for _ in range(20)]
    vertical = [read().strip() for _ in range(19)]
    queue = deque([start])
    previous = {start: None}
    while queue:
        row, col = queue.popleft()
        if (row, col) == goal:
            break
        choices = []
        if row > 0 and vertical[row - 1][col] == "0":
            choices.append((row - 1, col, "U"))
        if row < 19 and vertical[row][col] == "0":
            choices.append((row + 1, col, "D"))
        if col > 0 and horizontal[row][col - 1] == "0":
            choices.append((row, col - 1, "L"))
        if col < 19 and horizontal[row][col] == "0":
            choices.append((row, col + 1, "R"))
        for nr, nc, direction in choices:
            if (nr, nc) not in previous:
                previous[nr, nc] = ((row, col), direction)
                queue.append((nr, nc))
    path = []
    current = goal
    while current != start:
        current, direction = previous[current]
        path.append(direction)
    print("".join(reversed(path))[:200])
#EVOLVE_END


if __name__ == "__main__":
    solve()
