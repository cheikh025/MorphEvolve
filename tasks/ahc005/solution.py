"""A closed DFS walk visits every road cell and returns to its start."""

#EVOLVE_START
import sys


def solve():
    read = sys.stdin.readline
    n, si, sj = map(int, read().split())
    grid = [read().strip() for _ in range(n)]
    moves = [(-1, 0, "U", "D"), (1, 0, "D", "U"),
             (0, -1, "L", "R"), (0, 1, "R", "L")]
    seen = {(si, sj)}
    stack = [(si, sj, 0, "")]
    path = []
    while stack:
        row, col, step, back = stack[-1]
        if step == len(moves):
            stack.pop()
            path.append(back)
            continue
        stack[-1] = (row, col, step + 1, back)
        dr, dc, forward, reverse = moves[step]
        nr, nc = row + dr, col + dc
        if 0 <= nr < n and 0 <= nc < n and grid[nr][nc] != "#" and (nr, nc) not in seen:
            seen.add((nr, nc))
            path.append(forward)
            stack.append((nr, nc, 0, reverse))
    print("".join(path))
#EVOLVE_END


if __name__ == "__main__":
    solve()
