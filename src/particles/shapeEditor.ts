// The shape placement mode: a dock of tools, and canvas gestures to place,
// select, move, resize and recolour shapes. Styles are in particles.css.
import type { Shape, ShapeField, ShapeOutline, ShapeType } from "./shapes";
import { DEFAULT_SHAPE_COLOR, MIN_SHAPE_RADIUS, SHAPE_TYPES } from "./shapes";

const DEFAULT_TAP_RADIUS = 45;
const TAP_SLOP = 10;
const HANDLE_HIT_RADIUS = 24;
const HINT_DURATION = 4000;

const ICONS = {
	circle: '<svg viewBox="0 0 24 24" width="17" height="17"><circle cx="12" cy="12" r="7.5" fill="currentColor"/></svg>',
	square: '<svg viewBox="0 0 24 24" width="17" height="17"><rect x="4.5" y="4.5" width="15" height="15" rx="2.5" fill="currentColor"/></svg>',
	triangle: '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M12 4.2 20.1 19H3.9Z" fill="currentColor"/></svg>',
	trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 7V5h4v2M6 7l1 12h10l1-12M10 11v5M14 11v5"/></svg>',
	done: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

interface Point {
	clientX: number;
	clientY: number;
}

interface Drag {
	mode: "create" | "move" | "resize";
	x: number;
	y: number;
	lastX: number;
	lastY: number;
	moved: number;
	shape?: Shape;
	originX?: number;
	originY?: number;
	hadSelection?: boolean;
}

// Modal shape editing. While active, canvas input places, selects, moves,
// resizes and recolours shapes instead of driving particle forces.
export class ShapeEditor {
	active = false;
	selected: Shape | null = null;
	preview: ShapeOutline | null = null;
	onDeactivate?: () => void;

	private tool: ShapeType = "circle";
	private color: string | null = null;
	private drag: Drag | null = null;
	private dock!: HTMLDivElement;
	private pop!: HTMLElement;
	private colorInput!: HTMLInputElement;
	private caption!: HTMLDivElement;
	private captionTimer: ReturnType<typeof setTimeout> | undefined;
	private prevTouchAction = "";

	constructor(
		private field: ShapeField,
		private canvas: HTMLCanvasElement,
		private onChange: () => void,
	) {
		this.buildDock();
		this.bind();
	}

	// The dock's element matching selector; the dock markup always has it.
	private part<T extends Element = HTMLElement>(selector: string): T {
		return this.dock.querySelector<T>(selector) as T;
	}

	private buildDock() {
		const dock = document.createElement("div");
		dock.className = "shape-dock";
		dock.innerHTML = `
			<div class="shape-seg">
				${SHAPE_TYPES.map(
					(t) => `<button type="button" data-tool="${t}" title="${t}" aria-label="${t}">${ICONS[t]}</button>`,
				).join("")}
			</div>
			<div class="color-slot">
				<button type="button" class="color-well" data-action="color" title="fill" aria-label="fill">
					<span class="disc none"></span>
				</button>
				<div class="color-pop">
					<button type="button" data-action="nofill" title="no fill" aria-label="no fill">
						<span class="disc none"></span>
					</button>
					<label class="wheel" title="pick a colour">
						<span class="disc"></span>
						<input type="color" value="${DEFAULT_SHAPE_COLOR}" aria-label="pick a colour">
					</label>
				</div>
			</div>
			<div class="shape-divider"></div>
			<button type="button" class="dock-edit-only" data-action="delete" title="delete shape" aria-label="delete shape">${ICONS.trash}</button>
			<button type="button" data-action="done" title="done" aria-label="done">${ICONS.done}</button>
		`;
		document.body.appendChild(dock);
		this.dock = dock;
		this.pop = this.part(".color-pop");
		this.colorInput = this.part<HTMLInputElement>('input[type="color"]');

		const caption = document.createElement("div");
		caption.className = "shape-caption";
		caption.textContent = "drag to size · tap a shape to edit";
		document.body.appendChild(caption);
		this.caption = caption;

		dock.addEventListener("pointerdown", (e) => e.stopPropagation());
		dock.addEventListener("click", (e) => {
			const button = (e.target as Element).closest("button");
			if (!button) return;

			const tool = SHAPE_TYPES.find((t) => t === button.dataset.tool);
			if (tool) {
				this.tool = tool;
				if (this.selected) {
					this.field.setType(this.selected, this.tool);
					this.onChange();
				}
			} else if (button.dataset.action === "color") {
				this.pop.classList.toggle("open");
			} else if (button.dataset.action === "nofill") {
				this.applyColor(null);
				this.pop.classList.remove("open");
			} else if (button.dataset.action === "delete") {
				if (this.selected && this.field.remove(this.selected)) {
					this.select(null);
					this.onChange();
				}
			} else {
				this.deactivate();
			}
			this.syncDock();
		});

		// `input` fires continuously while the wheel is open, so the shape
		// recolours live rather than only on commit.
		this.colorInput.addEventListener("input", () => {
			this.applyColor(this.colorInput.value);
			this.syncDock();
		});

		this.syncDock();
	}

	private applyColor(color: string | null) {
		this.color = color;
		if (!this.selected) return; // only the default for the next shape changed
		this.field.setColor(this.selected, color);
		this.onChange();
	}

	private syncDock() {
		const editing = !!this.selected;
		this.part(".dock-edit-only").classList.toggle("on", editing);

		const type = this.selected ? this.selected.type : this.tool;
		for (const button of this.dock.querySelectorAll<HTMLButtonElement>("button[data-tool]")) {
			button.classList.toggle("selected", button.dataset.tool === type);
		}

		const color = this.selected ? this.selected.color : this.color;
		const disc = this.part(".color-well .disc");
		disc.classList.toggle("none", !color);
		disc.style.background = color || "";
		this.part(".color-well").classList.toggle("on", this.pop.classList.contains("open"));
		this.part('[data-action="nofill"]').classList.toggle("selected", !color);
		this.part(".wheel").classList.toggle("selected", !!color);
	}

	select(shape: Shape | null) {
		this.selected = shape;
		if (!shape) this.pop.classList.remove("open");
		this.syncDock();
	}

	private showCaption() {
		clearTimeout(this.captionTimer);
		this.caption.classList.add("show");
		this.captionTimer = setTimeout(() => this.caption.classList.remove("show"), HINT_DURATION);
	}

	private bind() {
		// Document-level, like the rest of the particle input: page content sits
		// above the canvas, so the canvas itself rarely receives the event.
		document.addEventListener("pointerdown", (e) => this.onDown(e));
		window.addEventListener("pointermove", (e) => this.onMove(e));

		// Chromium cancels the pointer stream partway through a touch drag, so
		// touch sizing has to be driven by the touch events themselves.
		window.addEventListener(
			"touchmove",
			(e) => {
				if (!this.active || !this.drag || e.touches.length === 0) return;
				this.onMove(e.touches[0]);
				e.preventDefault();
			},
			{ passive: false },
		);

		for (const type of ["pointerup", "touchend", "touchcancel"]) {
			window.addEventListener(type, () => this.finish());
		}

		window.addEventListener("contextmenu", (e) => {
			if (this.active) e.preventDefault();
		});
		window.addEventListener("keydown", (e) => {
			if (!this.active) return;
			if (e.key === "Escape") {
				if (this.pop.classList.contains("open")) {
					this.pop.classList.remove("open");
					this.syncDock();
				} else if (this.selected) {
					this.select(null);
				} else {
					this.deactivate();
				}
			} else if ((e.key === "Backspace" || e.key === "Delete") && this.selected) {
				this.field.remove(this.selected);
				this.select(null);
				this.onChange();
			}
		});
	}

	private local(e: Point) {
		const rect = this.canvas.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	private onDown(e: PointerEvent) {
		if (!this.active) return;
		if ((e.target as Element | null)?.closest?.(".shape-dock, .particle-controls, #settings-icon, nav, a, button")) return;
		e.preventDefault();

		this.caption.classList.remove("show");
		if (this.pop.classList.contains("open")) {
			this.pop.classList.remove("open");
			this.syncDock();
		}

		const { x, y } = this.local(e);

		if (this.selected) {
			const h = this.field.handlePos(this.selected);
			if (Math.hypot(x - h.x, y - h.y) <= HANDLE_HIT_RADIUS) {
				this.drag = { mode: "resize", x, y, lastX: x, lastY: y, moved: 0, shape: this.selected };
				return;
			}
		}

		const hit = this.field.hitTest(x, y);
		if (hit) {
			this.select(hit);
			this.drag = {
				mode: "move",
				x, y, lastX: x, lastY: y, moved: 0,
				shape: hit,
				originX: hit.x,
				originY: hit.y,
			};
			return;
		}

		this.drag = { mode: "create", x, y, lastX: x, lastY: y, moved: 0, hadSelection: !!this.selected };
		this.preview = { type: this.tool, color: this.color, x, y, r: 0 };
	}

	private onMove(e: Point) {
		if (!this.active || !this.drag) return;
		const drag = this.drag;
		const { x, y } = this.local(e);
		drag.lastX = x;
		drag.lastY = y;
		drag.moved = Math.max(drag.moved, Math.hypot(x - drag.x, y - drag.y));

		if (drag.mode === "create") {
			if (this.preview) this.preview.r = Math.hypot(x - drag.x, y - drag.y);
		} else if (drag.mode === "move" && drag.shape) {
			this.field.setCenter(drag.shape, (drag.originX ?? 0) + (x - drag.x), (drag.originY ?? 0) + (y - drag.y));
		} else if (drag.shape) {
			this.field.setRadius(drag.shape, Math.hypot(x - drag.shape.x, y - drag.shape.y));
		}
	}

	private finish() {
		if (!this.active || !this.drag) return;
		const drag = this.drag;
		this.drag = null;
		this.preview = null;

		if (drag.mode === "move" || drag.mode === "resize") {
			// Persist once at the end — writing on every move would reapply
			// settings across every particle each frame.
			if (drag.moved > 0) this.onChange();
			return;
		}

		// A tap on empty space dismisses the current selection rather than
		// stacking a new shape on top of whatever was being edited.
		if (drag.moved <= TAP_SLOP && drag.hadSelection) {
			this.select(null);
			return;
		}

		const r =
			drag.moved <= TAP_SLOP
				? DEFAULT_TAP_RADIUS
				: Math.hypot(drag.lastX - drag.x, drag.lastY - drag.y);
		if (r < MIN_SHAPE_RADIUS) return;

		this.field.add(this.tool, drag.x, drag.y, r, this.color);
		this.onChange();
	}

	activate() {
		if (this.active) return;
		this.active = true;
		this.dock.classList.add("open");
		// Page content sits above the canvas, so the gesture has to be claimed
		// document-wide or the browser will scroll instead of drawing.
		this.prevTouchAction = document.body.style.touchAction;
		document.body.style.touchAction = "none";
		document.body.style.cursor = "crosshair";
		this.showCaption();
		this.syncDock();
	}

	deactivate() {
		if (!this.active) return;
		this.active = false;
		this.drag = null;
		this.preview = null;
		this.select(null);
		this.dock.classList.remove("open");
		this.caption.classList.remove("show");
		clearTimeout(this.captionTimer);
		document.body.style.touchAction = this.prevTouchAction || "";
		document.body.style.cursor = "";
		this.onDeactivate?.();
	}

	toggle() {
		if (this.active) this.deactivate();
		else this.activate();
	}
}
