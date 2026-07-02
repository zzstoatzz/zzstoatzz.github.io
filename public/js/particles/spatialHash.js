// Integer-key spatial hash for efficient neighbor queries.
// The key packs the two cell coords into one int (16 bits each), which is
// bijective for coords in [-32768, 32767] — no hash collisions in that range,
// so a bucket only ever holds particles from a single real cell.

// Half of the 8-neighbor offsets: one representative per opposite-facing pair.
// Visiting only these (plus in-cell pairs) enumerates each unordered pair once,
// instead of the full 3x3 scan that saw every cross-cell pair twice.
const FORWARD_NEIGHBORS = [
	[1, -1],
	[1, 0],
	[1, 1],
	[0, 1],
];

export class SpatialHash {
	constructor() {
		this.cells = new Map(); // Map<number, { cx, cy, items: number[] }>
		this.cellSize = 50;
	}

	_hash(cx, cy) {
		return ((cx & 0xffff) << 16) | (cy & 0xffff);
	}

	update(particles, count, cellSize) {
		this.cellSize = cellSize > 0 ? cellSize : 50;
		this.cells.clear();

		const invCellSize = 1 / this.cellSize;

		for (let i = 0; i < count; i++) {
			const p = particles[i];
			const cx = (p.x * invCellSize) | 0;
			const cy = (p.y * invCellSize) | 0;
			const key = this._hash(cx, cy);

			let cell = this.cells.get(key);
			if (!cell) {
				cell = { cx, cy, items: [] };
				this.cells.set(key, cell);
			}
			cell.items.push(i);
		}
	}

	// Iterate every unique (i, j) pair in the same or an adjacent cell exactly
	// once, with i < j.
	forEachPair(particles, callback) {
		for (const cell of this.cells.values()) {
			const items = cell.items;
			const n = items.length;

			// In-cell pairs.
			for (let a = 0; a < n; a++) {
				const i = items[a];
				for (let b = a + 1; b < n; b++) {
					const j = items[b];
					if (i < j) callback(i, j);
					else callback(j, i);
				}
			}

			// Forward-neighbor pairs only — the reverse direction is covered
			// when that neighbor is the current cell.
			for (const [dx, dy] of FORWARD_NEIGHBORS) {
				const neighbor = this.cells.get(this._hash(cell.cx + dx, cell.cy + dy));
				if (!neighbor) continue;

				const nItems = neighbor.items;
				for (let a = 0; a < n; a++) {
					const i = items[a];
					for (let b = 0; b < nItems.length; b++) {
						const j = nItems[b];
						if (i < j) callback(i, j);
						else callback(j, i);
					}
				}
			}
		}
	}

	// Iterate particle indices within radius r of (x, y).
	*queryRadius(x, y, r, particles) {
		const invCellSize = 1 / this.cellSize;
		const centerCX = (x * invCellSize) | 0;
		const centerCY = (y * invCellSize) | 0;
		const cellRadius = Math.ceil(r / this.cellSize);
		const rSq = r * r;

		for (let nx = centerCX - cellRadius; nx <= centerCX + cellRadius; nx++) {
			for (let ny = centerCY - cellRadius; ny <= centerCY + cellRadius; ny++) {
				const key = this._hash(nx, ny);
				const cell = this.cells.get(key);
				if (!cell) continue;

				for (const i of cell.items) {
					const p = particles[i];
					const dx = p.x - x;
					const dy = p.y - y;
					if (dx * dx + dy * dy < rSq) {
						yield i;
					}
				}
			}
		}
	}
}
