import { MIN_SHAPE_RADIUS, SHAPE_COLORS, SHAPE_TYPES } from "./shapes.js";

const DEFAULT_TAP_RADIUS = 45;
const TAP_SLOP = 10;
const HANDLE_HIT_RADIUS = 24;

const GLYPHS = { circle: "●", square: "■", triangle: "▲" };

const STYLES = `
	.shape-dock {
		position: fixed !important;
		bottom: max(20px, env(safe-area-inset-bottom, 0px)) !important;
		left: 50% !important;
		transform: translateX(-50%) !important;
		display: none;
		align-items: center !important;
		justify-content: center !important;
		flex-wrap: wrap !important;
		gap: 6px !important;
		padding: 8px !important;
		max-width: calc(100vw - 24px) !important;
		background: rgba(16, 20, 24, 0.85) !important;
		border: 1px solid rgba(100, 255, 218, 0.2) !important;
		border-radius: 14px !important;
		backdrop-filter: blur(10px) !important;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4) !important;
		font-family: var(--font-fira-code), monospace !important;
		z-index: 9999 !important;
		touch-action: manipulation !important;
	}
	.shape-dock.open { display: flex !important; }
	.shape-dock button {
		flex: none !important;
		width: 44px !important;
		height: 44px !important;
		display: flex !important;
		align-items: center !important;
		justify-content: center !important;
		background: transparent !important;
		border: 1px solid transparent !important;
		border-radius: 10px !important;
		color: rgba(255, 255, 255, 0.55) !important;
		font-family: inherit !important;
		font-size: 16px !important;
		cursor: pointer !important;
		transition: all 0.15s ease !important;
		padding: 0 !important;
	}
	.shape-dock button:hover { color: #64ffda !important; background: rgba(100, 255, 218, 0.08) !important; }
	.shape-dock button.selected {
		color: #64ffda !important;
		background: rgba(100, 255, 218, 0.14) !important;
		border-color: rgba(100, 255, 218, 0.35) !important;
	}
	.shape-dock button[data-action="delete"]:hover {
		color: #ff6b6b !important;
		background: rgba(255, 107, 107, 0.12) !important;
	}
	.shape-dock .dock-sep {
		flex: none !important;
		width: 1px !important;
		height: 26px !important;
		background: rgba(100, 255, 218, 0.15) !important;
		margin: 0 2px !important;
	}
	.shape-dock .dock-hint {
		font-size: 10px !important;
		color: rgba(255, 255, 255, 0.4) !important;
		padding: 0 8px !important;
		white-space: nowrap !important;
		letter-spacing: 0.3px !important;
	}
	.shape-dock .swatch { position: relative !important; }
	.shape-dock .swatch i {
		display: block !important;
		width: 22px !important;
		height: 22px !important;
		border-radius: 50% !important;
		border: 1px solid rgba(255, 255, 255, 0.25) !important;
	}
	.shape-dock .swatch.selected i {
		box-shadow: 0 0 0 2px rgba(16, 20, 24, 0.9), 0 0 0 4px #64ffda !important;
	}
	.shape-dock .swatch[data-color="0"] i {
		background:
			linear-gradient(45deg, transparent 44%, rgba(255,255,255,0.5) 44%, rgba(255,255,255,0.5) 56%, transparent 56%),
			rgba(0, 0, 0, 0.85) !important;
	}
	/* Groups wrap as units, so a narrow screen never orphans a lone swatch. */
	.shape-dock .dock-row {
		flex: 0 0 auto !important;
		display: flex !important;
		align-items: center !important;
		gap: 6px !important;
	}
	.shape-dock .dock-edit-only { display: none !important; }
	.shape-dock .dock-edit-only.on { display: flex !important; }
	.shape-dock .dock-hint.off { display: none !important; }
	@media (max-width: 640px) {
		.shape-dock { gap: 6px 2px !important; padding: 6px !important; }
		.shape-dock .dock-hint, .shape-dock .dock-sep { display: none !important; }
		.shape-dock .dock-row { gap: 2px !important; }
		.shape-dock button { width: 40px !important; }
		.shape-dock .swatch { width: 38px !important; }
	}
`;

// Modal shape editing. While active, canvas input places, selects, moves,
// resizes and recolours shapes instead of driving particle forces.
export class ShapeEditor {
	constructor(field, canvas, onChange) {
		this.field = field;
		this.canvas = canvas;
		this.onChange = onChange || (() => {});
		this.active = false;
		this.tool = "circle";
		this.color = 0;
		this.selected = null;
		this.preview = null;
		this._drag = null;

		this._buildDock();
		this._bind();
	}

	_buildDock() {
		if (!document.getElementById("shape-editor-styles")) {
			const style = document.createElement("style");
			style.id = "shape-editor-styles";
			style.textContent = STYLES;
			document.head.appendChild(style);
		}

		const dock = document.createElement("div");
		dock.className = "shape-dock";
		// Types and colours are always reachable: with a shape selected they
		// restyle it, otherwise they set what the next drawn shape will be.
		dock.innerHTML = `
			<div class="dock-row">
				${SHAPE_TYPES.map(
					(t) => `<button type="button" data-tool="${t}" title="${t}" aria-label="${t}">${GLYPHS[t]}</button>`,
				).join("")}
			</div>
			<div class="dock-sep"></div>
			<div class="dock-row">
				${SHAPE_COLORS.map(
					(hex, i) =>
						`<button type="button" class="swatch" data-color="${i}" title="${hex || "void"}" aria-label="${hex || "void"}"><i style="${hex ? `background:${hex}` : ""}"></i></button>`,
				).join("")}
			</div>
			<div class="dock-sep"></div>
			<span class="dock-hint">drag to size · tap a shape to edit</span>
			<div class="dock-row">
				<button type="button" class="dock-edit-only" data-action="delete" title="delete shape" aria-label="delete shape">🗑</button>
				<button type="button" data-action="clear" title="clear all shapes" aria-label="clear all shapes">⌫</button>
				<button type="button" data-action="done" title="done" aria-label="done">✕</button>
			</div>
		`;
		document.body.appendChild(dock);
		this.dock = dock;

		dock.addEventListener("pointerdown", (e) => e.stopPropagation());
		dock.addEventListener("click", (e) => {
			const button = e.target.closest("button");
			if (!button) return;

			if (button.dataset.tool) {
				this.tool = button.dataset.tool;
				if (this.selected) {
					this.field.setType(this.selected, this.tool);
					this.onChange();
				}
			} else if (button.dataset.color !== undefined) {
				const color = Number(button.dataset.color);
				this.color = color;
				if (this.selected) {
					this.field.setColor(this.selected, color);
					this.onChange();
				}
			} else if (button.dataset.action === "delete") {
				if (this.selected && this.field.remove(this.selected)) {
					this.select(null);
					this.onChange();
				}
			} else if (button.dataset.action === "clear") {
				this.field.clear();
				this.select(null);
				this.onChange();
			} else {
				this.deactivate();
			}
			this._syncDock();
		});

		this._syncDock();
	}

	_syncDock() {
		const editing = !!this.selected;
		this.dock.querySelector(".dock-edit-only").classList.toggle("on", editing);
		this.dock.querySelector(".dock-hint").classList.toggle("off", editing);

		const type = editing ? this.selected.type : this.tool;
		for (const button of this.dock.querySelectorAll("button[data-tool]")) {
			button.classList.toggle("selected", button.dataset.tool === type);
		}
		const active = editing ? this.selected.color : this.color;
		for (const button of this.dock.querySelectorAll(".swatch")) {
			button.classList.toggle("selected", Number(button.dataset.color) === active);
		}
	}

	select(shape) {
		this.selected = shape;
		this._syncDock();
	}

	_bind() {
		// Document-level, like the rest of the particle input: page content sits
		// above the canvas, so the canvas itself rarely receives the event.
		document.addEventListener("pointerdown", (e) => this._onDown(e));
		window.addEventListener("pointermove", (e) => this._onMove(e));

		// Chromium cancels the pointer stream partway through a touch drag, so
		// touch sizing has to be driven by the touch events themselves.
		window.addEventListener(
			"touchmove",
			(e) => {
				if (!this.active || !this._drag || e.touches.length === 0) return;
				this._onMove(e.touches[0]);
				e.preventDefault();
			},
			{ passive: false },
		);

		for (const type of ["pointerup", "touchend", "touchcancel"]) {
			window.addEventListener(type, () => this._finish());
		}

		window.addEventListener("contextmenu", (e) => {
			if (this.active) e.preventDefault();
		});
		window.addEventListener("keydown", (e) => {
			if (!this.active) return;
			if (e.key === "Escape") {
				if (this.selected) this.select(null);
				else this.deactivate();
			} else if ((e.key === "Backspace" || e.key === "Delete") && this.selected) {
				this.field.remove(this.selected);
				this.select(null);
				this.onChange();
			}
		});
	}

	_local(e) {
		const rect = this.canvas.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	_onDown(e) {
		if (!this.active) return;
		if (e.target?.closest?.(".shape-dock, .particle-controls, #settings-icon, nav, a, button")) return;
		e.preventDefault();
		const { x, y } = this._local(e);

		if (this.selected) {
			const h = this.field.handlePos(this.selected);
			if (Math.hypot(x - h.x, y - h.y) <= HANDLE_HIT_RADIUS) {
				this._drag = { mode: "resize", x, y, lastX: x, lastY: y, moved: 0, shape: this.selected };
				return;
			}
		}

		const hit = this.field.hitTest(x, y);
		if (hit) {
			this.select(hit);
			this._drag = {
				mode: "move",
				x, y, lastX: x, lastY: y, moved: 0,
				shape: hit,
				originX: hit.x,
				originY: hit.y,
			};
			return;
		}

		this._drag = { mode: "create", x, y, lastX: x, lastY: y, moved: 0, hadSelection: !!this.selected };
		this.preview = { type: this.tool, color: this.color, x, y, r: 0 };
	}

	_onMove(e) {
		if (!this.active || !this._drag) return;
		const drag = this._drag;
		const { x, y } = this._local(e);
		drag.lastX = x;
		drag.lastY = y;
		drag.moved = Math.max(drag.moved, Math.hypot(x - drag.x, y - drag.y));

		if (drag.mode === "create") {
			if (this.preview) this.preview.r = Math.hypot(x - drag.x, y - drag.y);
		} else if (drag.mode === "move") {
			this.field.setCenter(drag.shape, drag.originX + (x - drag.x), drag.originY + (y - drag.y));
		} else {
			this.field.setRadius(drag.shape, Math.hypot(x - drag.shape.x, y - drag.shape.y));
		}
	}

	_finish() {
		if (!this.active || !this._drag) return;
		const drag = this._drag;
		this._drag = null;
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
		this._prevTouchAction = document.body.style.touchAction;
		document.body.style.touchAction = "none";
		document.body.style.cursor = "crosshair";
		this._syncDock();
	}

	deactivate() {
		if (!this.active) return;
		this.active = false;
		this._drag = null;
		this.preview = null;
		this.select(null);
		this.dock.classList.remove("open");
		document.body.style.touchAction = this._prevTouchAction || "";
		document.body.style.cursor = "";
		this.onDeactivate?.();
	}

	toggle() {
		if (this.active) this.deactivate();
		else this.activate();
	}
}
