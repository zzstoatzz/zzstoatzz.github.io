export const SHAPE_TYPES = ["circle", "square", "triangle"];

const TYPE_CODES = { circle: "c", square: "s", triangle: "t" };
const CODE_TYPES = { c: "circle", s: "square", t: "triangle" };

export const MIN_SHAPE_RADIUS = 14;

// Regular polygon inscribed in the shape's circumradius. Squares are rotated a
// quarter-turn so they sit axis-aligned; triangles point up.
function polyVerts(shape) {
	const sides = shape.type === "square" ? 4 : 3;
	const start = (shape.type === "square" ? Math.PI / 4 : -Math.PI / 2) + (shape.rot || 0);
	const verts = [];
	for (let i = 0; i < sides; i++) {
		const a = start + (i * Math.PI * 2) / sides;
		verts.push(shape.x + Math.cos(a) * shape.r, shape.y + Math.sin(a) * shape.r);
	}
	return verts;
}

function addPath(ctx, shape) {
	if (shape.type === "circle") {
		ctx.moveTo(shape.x + shape.r, shape.y);
		ctx.arc(shape.x, shape.y, shape.r, 0, Math.PI * 2);
		return;
	}
	const verts = shape.verts || polyVerts(shape);
	ctx.moveTo(verts[0], verts[1]);
	for (let i = 1; i < verts.length / 2; i++) ctx.lineTo(verts[i * 2], verts[i * 2 + 1]);
	ctx.closePath();
}

// Shapes are stored in normalized canvas coordinates so they survive resizes
// and can round-trip through the share URL. Pixel geometry is derived.
export class ShapeField {
	constructor() {
		this.shapes = [];
		this.width = 1;
		this.height = 1;
	}

	get count() {
		return this.shapes.length;
	}

	resize(width, height) {
		this.width = width || 1;
		this.height = height || 1;
		for (const shape of this.shapes) this._project(shape);
	}

	add(type, x, y, r) {
		const shape = {
			type: SHAPE_TYPES.includes(type) ? type : "circle",
			fx: x / this.width,
			fy: y / this.height,
			fr: r / this._refSize(),
			rot: 0,
		};
		this._project(shape);
		this.shapes.push(shape);
		return shape;
	}

	removeAt(x, y) {
		for (let i = this.shapes.length - 1; i >= 0; i--) {
			if (this.contains(this.shapes[i], x, y, 0)) {
				this.shapes.splice(i, 1);
				return true;
			}
		}
		return false;
	}

	clear() {
		this.shapes.length = 0;
	}

	_refSize() {
		return Math.min(this.width, this.height) || 1;
	}

	_project(shape) {
		shape.x = shape.fx * this.width;
		shape.y = shape.fy * this.height;
		shape.r = Math.max(1, shape.fr * this._refSize());

		if (shape.type === "circle") {
			shape.verts = null;
			shape.normals = null;
			shape.offsets = null;
			return;
		}

		const sides = shape.type === "square" ? 4 : 3;
		const verts = polyVerts(shape);

		// Outward edge normals + plane offsets, for the half-plane collision test.
		const normals = [];
		const offsets = [];
		for (let i = 0; i < sides; i++) {
			const ax = verts[i * 2];
			const ay = verts[i * 2 + 1];
			const bx = verts[((i + 1) % sides) * 2];
			const by = verts[((i + 1) % sides) * 2 + 1];
			let nx = by - ay;
			let ny = -(bx - ax);
			const len = Math.hypot(nx, ny) || 1;
			nx /= len;
			ny /= len;
			if (nx * (shape.x - ax) + ny * (shape.y - ay) > 0) {
				nx = -nx;
				ny = -ny;
			}
			normals.push(nx, ny);
			offsets.push(nx * ax + ny * ay);
		}

		shape.verts = verts;
		shape.normals = normals;
		shape.offsets = offsets;
	}

	// Inside test, optionally inflated by `pad` (a particle radius).
	contains(shape, x, y, pad = 0) {
		const dx = x - shape.x;
		const dy = y - shape.y;
		if (dx * dx + dy * dy > (shape.r + pad) * (shape.r + pad)) return false;
		if (shape.type === "circle") return true;

		const n = shape.normals;
		for (let i = 0; i < shape.offsets.length; i++) {
			if (n[i * 2] * x + n[i * 2 + 1] * y - shape.offsets[i] >= pad) return false;
		}
		return true;
	}

	hitTest(x, y) {
		for (let i = this.shapes.length - 1; i >= 0; i--) {
			if (this.contains(this.shapes[i], x, y, 0)) return this.shapes[i];
		}
		return null;
	}

	// Push a particle out of any shape it has entered and reflect its velocity.
	collide(particle, elasticity) {
		if (this.shapes.length === 0) return;

		for (const shape of this.shapes) {
			if (!this.contains(shape, particle.x, particle.y, particle.radius)) continue;

			let nx;
			let ny;
			let depth;

			if (shape.type === "circle") {
				const dx = particle.x - shape.x;
				const dy = particle.y - shape.y;
				const dist = Math.hypot(dx, dy);
				const target = shape.r + particle.radius;
				if (dist < 1e-6) {
					nx = 1;
					ny = 0;
					depth = target;
				} else {
					nx = dx / dist;
					ny = dy / dist;
					depth = target - dist;
				}
			} else {
				// Exit across the least-penetrated edge plane.
				let best = -Infinity;
				let bi = 0;
				for (let i = 0; i < shape.offsets.length; i++) {
					const d = shape.normals[i * 2] * particle.x + shape.normals[i * 2 + 1] * particle.y - shape.offsets[i];
					if (d > best) {
						best = d;
						bi = i;
					}
				}
				nx = shape.normals[bi * 2];
				ny = shape.normals[bi * 2 + 1];
				depth = particle.radius - best;
			}

			if (depth <= 0) continue;

			particle.x += nx * (depth + 0.1);
			particle.y += ny * (depth + 0.1);

			const vn = particle.vx * nx + particle.vy * ny;
			if (vn < 0) {
				const j = -(1 + elasticity) * vn;
				particle.vx += nx * j;
				particle.vy += ny * j;
			}
		}
	}

	draw(ctx, preview = null) {
		if (this.shapes.length > 0) {
			ctx.beginPath();
			for (const shape of this.shapes) addPath(ctx, shape);
			ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
			ctx.fill();
			ctx.strokeStyle = "rgba(100, 255, 218, 0.22)";
			ctx.lineWidth = 1;
			ctx.stroke();
		}

		if (preview && preview.r >= 1) {
			ctx.save();
			ctx.setLineDash([6, 6]);
			ctx.beginPath();
			addPath(ctx, preview);
			ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
			ctx.fill();
			ctx.strokeStyle =
				preview.r >= MIN_SHAPE_RADIUS ? "rgba(100, 255, 218, 0.8)" : "rgba(255, 107, 107, 0.7)";
			ctx.lineWidth = 1.5;
			ctx.stroke();
			ctx.restore();
		}
	}

	serialize() {
		return this.shapes
			.map((s) => `${TYPE_CODES[s.type]}${s.fx.toFixed(4)},${s.fy.toFixed(4)},${s.fr.toFixed(4)}`)
			.join(";");
	}

	deserialize(str) {
		this.shapes.length = 0;
		if (!str) return;
		for (const part of str.split(";")) {
			const type = CODE_TYPES[part[0]];
			if (!type) continue;
			const [fx, fy, fr] = part.slice(1).split(",").map(Number.parseFloat);
			if (![fx, fy, fr].every(Number.isFinite)) continue;
			const shape = { type, fx, fy, fr, rot: 0 };
			this._project(shape);
			this.shapes.push(shape);
		}
	}
}
