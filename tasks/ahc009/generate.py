"""Python port of the pinned AHC009 input generator."""

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

class Random(ChaCha20Rng):
    """rand 0.7.3 distributions over the already verified AHC001 ChaCha stream."""

    def integer(self, low, high, bits=32):
        span = high - low
        width = max(32, bits)
        mask = (1 << width) - 1
        zone = mask - ((mask - span + 1) % span) if bits < 32 else (span << (width - span.bit_length())) - 1
        while True:
            value = self.next_u64() if width == 64 else self.next_u32()
            product = value * span
            if product & mask <= zone:
                return low + (product >> width)

    def uniform(self, low, high):
        # Uniform<f64> uses 52 bits; Standard<f64> uses 53.
        while True:
            value = (self.next_u64() >> 12) * 2.0**-52 * (high - low) + low
            if value < high:
                return value

    def shuffle(self, values):
        for i in range(len(values) - 1, 0, -1):
            j = self.integer(0, i + 1)
            values[i], values[j] = values[j], values[i]

    def choose(self, values):
        return values[self.integer(0, len(values))]

class UnionFind:
    def __init__(self, n):
        self.parent = [-1] * n

    def find(self, x):
        while self.parent[x] >= 0:
            if self.parent[self.parent[x]] >= 0:
                self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def unite(self, x, y):
        x, y = self.find(x), self.find(y)
        if x == y:
            return False
        if self.parent[x] > self.parent[y]:
            x, y = y, x
        self.parent[x] += self.parent[y]
        self.parent[y] = x
        return True

def rows(values):
    return "".join(" ".join(map(str, row)) + "\n" for row in values)

# --- end inlined primitives ---


def generate(seed):
    Random.seed_from_u64(seed)
    rng = Random.seed_from_u64(seed ^ 16)
    start = [rng.integer(0, 5), rng.integer(0, 5)]
    goal = [rng.integer(15, 20), rng.integer(15, 20)]
    probability = rng.integer(10, 51) / 100.0
    edges = []
    for i in range(20):
        for j in range(20):
            if i < 19:
                edges.append((i * 20 + j, (i + 1) * 20 + j))
            if j < 19:
                edges.append((i * 20 + j, i * 20 + j + 1))
    h, v = [["1"] * 19 for _ in range(20)], [["1"] * 20 for _ in range(19)]
    for _ in range(2):
        rng.shuffle(edges)
        uf = UnionFind(400)
        for a, b in edges:
            if uf.unite(a, b):
                (h if a + 1 == b else v)[a // 20][a % 20] = "0"
    return rows([start + goal + [f"{probability:.2f}"]]) + "".join("".join(row) + "\n" for row in h + v)
