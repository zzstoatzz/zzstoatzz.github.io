// Integer-key spatial hash for efficient neighbor queries.
// Replaces string "x,y" keys with integer hash: cx * 73856093 ^ cy * 19349663

export class SpatialHash {
	constructor() {
		this.cells = new Map(); // Map<number, number[]>
		this.cellSize = 50;
	}

	_hash(cx, cy) {
		return (cx * 73856093) ^ (cy * 19349663);
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
				cell = [];
				this.cells.set(key, cell);
			}
			cell.push(i);

			// Store cell coords on particle for neighbor lookup
			p._cx = cx;
			p._cy = cy;
		}
	}

	// Iterate all unique (i, j) pairs in same or adjacent cells.
	forEachPair(particles, callback) {
		for (const [, indices] of this.cells) {
			if (indices.length === 0) continue;

			const rep = particles[indices[0]];
			const cx = rep._cx;
			const cy = rep._cy;

			for (let nx = cx - 1; nx <= cx + 1; nx++) {
				for (let ny = cy - 1; ny <= cy + 1; ny++) {
					const neighborKey = this._hash(nx, ny);
					const neighborIndices = this.cells.get(neighborKey);
					if (!neighborIndices) continue;

					for (const i of indices) {
						for (const j of neighborIndices) {
							if (i >= j) continue;
							callback(i, j);
						}
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

				for (const i of cell) {
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
