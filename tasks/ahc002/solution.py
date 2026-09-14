"""Greedily visit unvisited tiles, preferring larger immediate rewards."""

#EVOLVE_START
import sys


def solve():
    read = sys.stdin.readline
    row, col = map(int, read().split())
    tiles = [list(map(int, read().split())) for _ in range(50)]
    points = [list(map(int, read().split())) for _ in range(50)]
    seen = {tiles[row][col]}
    moves = [(-1, 0, "U"), (1, 0, "D"), (0, -1, "L"), (0, 1, "R")]
    path = []
    while True:
        choices = []
        for dr, dc, direction in moves:
            nr, nc = row + dr, col + dc
            if 0 <= nr < 50 and 0 <= nc < 50 and tiles[nr][nc] not in seen:
                choices.append((points[nr][nc], nr, nc, direction))
        if not choices:
            break
        _, row, col, direction = max(choices)
        seen.add(tiles[row][col])
        path.append(direction)
    print("".join(path))
#EVOLVE_END


if __name__ == "__main__":
    solve()
