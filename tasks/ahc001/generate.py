"""Python port of the pinned AHC001 generator, returning contest input text.

Random-number consumption and arithmetic match rand 0.7.3 / rand_chacha 0.2.2.
See REFERENCE.md for the sources and independent conformance checks.
"""
from __future__ import annotations

# --- inlined from the shared tool-port primitives; do not edit ---

M32 = 0xFFFFFFFF

M64 = 0xFFFFFFFFFFFFFFFF

_CONST = (0x61707865, 0x3320646E, 0x79622D32, 0x6B206574)

def _rotl(v: int, n: int) -> int:
    return ((v << n) | (v >> (32 - n))) & M32

def _quarter(s: list[int], a: int, b: int, c: int, d: int) -> None:
    s[a] = (s[a] + s[b]) & M32; s[d] = _rotl(s[d] ^ s[a], 16)
    s[c] = (s[c] + s[d]) & M32; s[b] = _rotl(s[b] ^ s[c], 12)
    s[a] = (s[a] + s[b]) & M32; s[d] = _rotl(s[d] ^ s[a], 8)
    s[c] = (s[c] + s[d]) & M32; s[b] = _rotl(s[b] ^ s[c], 7)

class ChaCha20Rng:
    """rand_chacha 0.2.2: 64-bit block counter in words 12/13, stream 0."""

    def __init__(self, key: bytes) -> None:
        self.key = [int.from_bytes(key[i:i + 4], "little") for i in range(0, 32, 4)]
        self.counter = 0
        self.buf: list[int] = []
        self.index = 64                      # rand_core BlockRng buffers 4 blocks

    @classmethod
    def seed_from_u64(cls, state: int) -> "ChaCha20Rng":
        """rand_core 0.5 SeedableRng::seed_from_u64 -- a PCG32 seed expansion."""
        if type(state) is not int or not 0 <= state <= M64:
            raise ValueError("seed must be an unsigned 64-bit integer")
        mul, inc = 6364136223846793005, 11634580027462260723
        out = bytearray()
        for _ in range(8):
            state = (state * mul + inc) & M64
            xorshifted = (((state >> 18) ^ state) >> 27) & M32
            rot = (state >> 59) & 31
            out += (((xorshifted >> rot) | (xorshifted << ((32 - rot) & 31))) & M32).to_bytes(4, "little")
        return cls(bytes(out))

    def _block(self, counter: int) -> list[int]:
        s = list(_CONST) + self.key + [counter & M32, (counter >> 32) & M32, 0, 0]
        w = s[:]
        for _ in range(10):
            _quarter(w, 0, 4, 8, 12); _quarter(w, 1, 5, 9, 13)
            _quarter(w, 2, 6, 10, 14); _quarter(w, 3, 7, 11, 15)
            _quarter(w, 0, 5, 10, 15); _quarter(w, 1, 6, 11, 12)
            _quarter(w, 2, 7, 8, 13); _quarter(w, 3, 4, 9, 14)
        return [(w[i] + s[i]) & M32 for i in range(16)]

    def _refill(self) -> None:
        self.buf = []
        for _ in range(4):
            self.buf += self._block(self.counter)
            self.counter += 1
        self.index = 0

    def next_u32(self) -> int:
        if self.index >= len(self.buf):
            self._refill()
        v = self.buf[self.index]
        self.index += 1
        return v

    def next_u64(self) -> int:
        """BlockRng::next_u64 -- two consecutive words, low first."""
        if self.index >= len(self.buf):
            self._refill()
        if self.index < len(self.buf) - 1:
            lo, hi = self.buf[self.index], self.buf[self.index + 1]
            self.index += 2
            return lo | (hi << 32)
        lo = self.buf[-1]                     # straddles the buffer edge
        self._refill()
        self.index = 1
        return lo | (self.buf[0] << 32)

    def gen_f64(self) -> float:
        """rand 0.7.3 Standard<f64>: the top 53 bits of one u64, scaled to [0, 1)."""
        return (self.next_u64() >> 11) * (2.0 ** -53)

    def gen_range_u32(self, low: int, high: int) -> int:
        """UniformInt::sample_single -- widening-multiply rejection."""
        span = (high - low) & M32
        zone = ((span << (32 - span.bit_length())) - 1) & M32
        while True:
            prod = self.next_u32() * span
            if (prod & M32) <= zone:
                return (low + (prod >> 32)) & M32

# --- end inlined primitives ---


BOARD = 10000


class _UniformU32:
    """UniformInt::new(0, length) -- precomputed rejection zone."""

    def __init__(self, low: int, high_exclusive: int) -> None:
        self.low = low
        self.range = (high_exclusive - low) & M32
        self.zone = M32 - ((M32 - self.range + 1) % self.range) if self.range else 0

    def sample(self, rng: ChaCha20Rng) -> int:
        while True:
            prod = rng.next_u32() * self.range
            if (prod & M32) <= self.zone:
                return (self.low + (prod >> 32)) & M32


def _sample_rejection(rng: ChaCha20Rng, length: int, amount: int) -> list[int]:
    """seq::index::sample_rejection, called with u32 arguments."""
    distr = _UniformU32(0, length)
    cache: set[int] = set()
    out: list[int] = []
    for _ in range(amount):
        pos = distr.sample(rng)
        while pos in cache:
            pos = distr.sample(rng)
        cache.add(pos)
        out.append(pos)
    return out


def _sample_floyd(rng: ChaCha20Rng, length: int, amount: int) -> list[int]:
    """seq::index::sample_floyd -- Floyd's algorithm, u32 arguments."""
    floyd_shuffle = amount < 50
    indices: list[int] = []
    for j in range(length - amount, length):
        t = rng.gen_range_u32(0, j + 1)
        if floyd_shuffle:
            if t in indices:
                indices.insert(indices.index(t), j)
                continue
        elif t in indices:
            indices.append(j)
            continue
        indices.append(t)
    if not floyd_shuffle:
        for i in range(amount - 1, 0, -1):
            k = rng.gen_range_u32(0, i + 1)
            indices[i], indices[k] = indices[k], indices[i]
    return indices


def _index_sample(rng: ChaCha20Rng, length: int, amount: int) -> list[int]:
    """seq::index::sample -- the algorithm is chosen from the two sizes."""
    j = 0 if length < 500_000 else 1
    if amount < 163:
        c0, c1 = (1.6, 8.0 / 45.0)[j], (10.0, 70.0 / 9.0)[j]
        if amount > 11 and float(length) < (c1 + c0 * amount) * amount:
            raise NotImplementedError("sample_inplace: unreachable at AHC001 sizes")
        return _sample_floyd(rng, length, amount)
    if float(length) < (270.0, 330.0 / 9.0)[j] * amount:
        raise NotImplementedError("sample_inplace: unreachable at AHC001 sizes")
    return _sample_rejection(rng, length, amount)


def generate(seed: int) -> str:
    """gen.rs::gen. `n` is drawn, not chosen -- it is a function of the seed."""
    rng = ChaCha20Rng.seed_from_u64(seed)
    size = 50.0 * 4.0 ** rng.gen_f64()
    # Rust f64::round resolves positive half ties upwards, unlike Python round.
    n = int(size)
    n += size - n >= 0.5

    used: set[tuple[int, int]] = set()
    points: list[tuple[int, int]] = []
    while len(points) < n:
        x = rng.gen_range_u32(0, BOARD)
        y = rng.gen_range_u32(0, BOARD)
        if (x, y) not in used:
            used.add((x, y))
            points.append((x, y))

    cuts = sorted(a + 1 for a in _index_sample(rng, BOARD * BOARD - 1, n - 1))
    bounds = [0] + cuts + [BOARD * BOARD]
    areas = [bounds[i + 1] - bounds[i] for i in range(n)]

    return f"{n}\n" + "".join(
        f"{x} {y} {area}\n" for (x, y), area in zip(points, areas)
    )
