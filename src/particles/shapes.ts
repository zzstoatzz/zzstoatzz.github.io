export const SHAPE_TYPES = ["circle", "square", "triangle"] as const;
export type ShapeType = (typeof SHAPE_TYPES)[number];

const TYPE_CODES: Record<ShapeType, string> = { circle: "c", square: "s", triangle: "t" };
const CODE_TYPES: Record<string, ShapeType | undefined> = { c: "circle", s: "square", t: "triangle" };

// Position and size are stored as fractions (fx, fy, fr) of the canvas, see
// ShapeField; x, y, r and the polygon geometry are projected from them.
export interface Shape {
	type: ShapeType;
	color: string | null;
	rot: number;
	fx: number;
	fy: number;
	fr: number;
	x: number;
	y: number;
	r: number;
	verts: number[] | null;
	// outward edge normals (x, y pairs) and plane offsets, for polygons
	normals: number[] | null;
	offsets: number[] | null;
}

// What polyVerts and shapePath need; also the shape-in-progress preview.
export interface ShapeOutline {
	type: ShapeType;
	x: number;
	y: number;
	r: number;
	rot?: number;
	verts?: number[] | null;
	color?: string | null;
}

// A shape's colour is a hex string, or null for an unfilled void.
export const DEFAULT_SHAPE_COLOR = "#64ffda";

// Colours used to be a palette index. Links minted then still resolve.
const LEGACY_PALETTE: (string | null)[] = [null, "#64ffda", "#00bfff", "#bd93f9", "#ff79c6", "#ffb86c", "#ff6b6b", "#42b883"];

export const MIN_SHAPE_RADIUS = 14;

// Regular polygon inscribed in the shape's circumradius. Squares are rotated a
// quarter-turn so they sit axis-aligned; triangles point up.
function polyVerts(shape: ShapeOutline): number[] {
	const sides = shape.type === "square" ? 4 : 3;
	const start = (shape.type === "square" ? Math.PI / 4 : -Math.PI / 2) + (shape.rot || 0);
	const verts: number[] = [];
	for (let i = 0; i < sides; i++) {
		const a = start + (i * Math.PI * 2) / sides;
		verts.push(shape.x + Math.cos(a) * shape.r, shape.y + Math.sin(a) * shape.r);
	}
	return verts;
}

function parseColor(field: string): string | null {
	if (/^[0-9a-f]{6}$/i.test(field)) return `#${field.toLowerCase()}`;
	if (/^[0-7]$/.test(field)) return LEGACY_PALETTE[Number(field)];
	return null;
}

export function shapePath(ctx: CanvasRenderingContext2D, shape: ShapeOutline) {
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

function hexToRgba(hex: string, alpha: number) {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Shapes are stored as offsets from the canvas centre, in units of the smaller
// canvas dimension. One uniform scale for both axes keeps an arrangement's
// proportions intact when it is reopened on a differently shaped screen.
export class ShapeField {
	shapes: Shape[] = [];
	width = 1;
	height = 1;

	get count() {
		return this.shapes.length;
	}

	resize(width: number, height: number) {
		this.width = width || 1;
		this.height = height || 1;
		for (const shape of this.shapes) this.project(shape);
	}

	add(type: ShapeType, x: number, y: number, r: number, color: string | null = null): Shape {
		const shape = this.unprojected(type, color, this.normalize(x, y, r));
		this.project(shape);
		this.shapes.push(shape);
		return shape;
	}

	remove(shape: Shape) {
		const i = this.shapes.indexOf(shape);
		if (i === -1) return false;
		this.shapes.splice(i, 1);
		return true;
	}

	clear() {
		this.shapes.length = 0;
	}

	setCenter(shape: Shape, x: number, y: number) {
		const n = this.normalize(x, y, shape.r);
		shape.fx = n.fx;
		shape.fy = n.fy;
		this.project(shape);
	}

	setRadius(shape: Shape, r: number) {
		shape.fr = Math.max(MIN_SHAPE_RADIUS, r) / this.ref();
		this.project(shape);
	}

	setColor(shape: Shape, color: string | null) {
		shape.color = color;
	}

	setType(shape: Shape, type: ShapeType) {
		shape.type = type;
		this.project(shape);
	}

	private ref() {
		return Math.min(this.width, this.height) || 1;
	}

	private unprojected(type: ShapeType, color: string | null, f: { fx: number; fy: number; fr: number }): Shape {
		return { type, color, rot: 0, ...f, x: 0, y: 0, r: 0, verts: null, normals: null, offsets: null };
	}

	private normalize(x: number, y: number, r: number) {
		const ref = this.ref();
		return {
			fx: (x - this.width / 2) / ref,
			fy: (y - this.height / 2) / ref,
			fr: r / ref,
		};
	}

	private project(shape: Shape) {
		const ref = this.ref();
		shape.x = this.width / 2 + shape.fx * ref;
		shape.y = this.height / 2 + shape.fy * ref;
		shape.r = Math.max(1, shape.fr * ref);

		if (shape.type === "circle") {
			shape.verts = null;
			shape.normals = null;
			shape.offsets = null;
			return;
		}

		const sides = shape.type === "square" ? 4 : 3;
		const verts = polyVerts(shape);

		// Outward edge normals + plane offsets, for the half-plane collision test.
		const normals: number[] = [];
		const offsets: number[] = [];
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
	contains(shape: Shape, x: number, y: number, pad = 0) {
		const dx = x - shape.x;
		const dy = y - shape.y;
		if (dx * dx + dy * dy > (shape.r + pad) * (shape.r + pad)) return false;
		if (shape.type === "circle") return true;

		const n = shape.normals ?? [];
		const offsets = shape.offsets ?? [];
		for (let i = 0; i < offsets.length; i++) {
			if (n[i * 2] * x + n[i * 2 + 1] * y - offsets[i] >= pad) return false;
		}
		return true;
	}

	hitTest(x: number, y: number, pad = 0): Shape | null {
		for (let i = this.shapes.length - 1; i >= 0; i--) {
			if (this.contains(this.shapes[i], x, y, pad)) return this.shapes[i];
		}
		return null;
	}

	draw(ctx: CanvasRenderingContext2D, preview: ShapeOutline | null = null, selected: Shape | null = null) {
		for (const shape of this.shapes) {
			const hex = shape.color;
			ctx.beginPath();
			shapePath(ctx, shape);
			ctx.fillStyle = hex ? hexToRgba(hex, 0.82) : "rgba(0, 0, 0, 0.72)";
			ctx.fill();
			ctx.strokeStyle = hex ? hexToRgba(hex, 0.9) : "rgba(100, 255, 218, 0.22)";
			ctx.lineWidth = hex ? 1.5 : 1;
			ctx.stroke();
		}

		if (selected && this.shapes.includes(selected)) this.drawSelection(ctx, selected);

		if (preview && preview.r >= 1) {
			ctx.save();
			ctx.setLineDash([6, 6]);
			ctx.beginPath();
			shapePath(ctx, preview);
			const hex = preview.color;
			ctx.fillStyle = hex ? hexToRgba(hex, 0.3) : "rgba(0, 0, 0, 0.45)";
			ctx.fill();
			ctx.strokeStyle =
				preview.r >= MIN_SHAPE_RADIUS ? "rgba(100, 255, 218, 0.8)" : "rgba(255, 107, 107, 0.7)";
			ctx.lineWidth = 1.5;
			ctx.stroke();
			ctx.restore();
		}
	}

	private drawSelection(ctx: CanvasRenderingContext2D, shape: Shape) {
		ctx.save();
		ctx.beginPath();
		shapePath(ctx, shape);
		ctx.strokeStyle = "rgba(100, 255, 218, 0.95)";
		ctx.lineWidth = 2;
		ctx.stroke();

		const h = this.handlePos(shape);
		ctx.beginPath();
		ctx.arc(h.x, h.y, 8, 0, Math.PI * 2);
		ctx.fillStyle = "#64ffda";
		ctx.fill();
		ctx.strokeStyle = "rgba(10, 15, 20, 0.9)";
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.restore();
	}

	// Resize grip, pinned to the shape's lower-right on the bounding circle.
	handlePos(shape: Shape) {
		const a = Math.PI / 4;
		return { x: shape.x + Math.cos(a) * shape.r, y: shape.y + Math.sin(a) * shape.r };
	}

	serialize(): string {
		const ms = (v: number) => Math.round(v * 1000);
		return this.shapes
			.map((s) => {
				const color = s.color ? s.color.slice(1).toLowerCase() : "n";
				return `${TYPE_CODES[s.type]}${color}_${ms(s.fx)}_${ms(s.fy)}_${ms(s.fr)}`;
			})
			.join("*");
	}

	deserialize(str: string) {
		this.shapes.length = 0;
		if (!str) return;
		for (const part of str.split("*")) {
			const type = CODE_TYPES[part[0]];
			if (!type) continue;
			const fields = part.slice(1).split("_");
			if (fields.length !== 4) continue;
			const nums = fields.slice(1).map(Number);
			if (!nums.every(Number.isFinite)) continue;
			const shape = this.unprojected(type, parseColor(fields[0]), {
				fx: nums[0] / 1000,
				fy: nums[1] / 1000,
				fr: nums[2] / 1000,
			});
			if (shape.fr <= 0) continue;
			this.project(shape);
			this.shapes.push(shape);
		}
	}
}
