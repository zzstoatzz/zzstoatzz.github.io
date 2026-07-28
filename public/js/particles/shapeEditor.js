import { MIN_SHAPE_RADIUS, SHAPE_TYPES } from "./shapes.js";

const DEFAULT_TAP_RADIUS = 45;
const TAP_SLOP = 10;

const GLYPHS = { circle: "●", square: "■", triangle: "▲" };

const STYLES = `
	.shape-dock {
		position: fixed !important;
		bottom: max(20px, env(safe-area-inset-bottom, 0px)) !important;
		left: 50% !important;
		transform: translateX(-50%) !important;
		display: none;
		align-items: center !important;
		gap: 6px !important;
		padding: 8px !important;
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
	}
	.shape-dock button:hover { color: #64ffda !important; background: rgba(100, 255, 218, 0.08) !important; }
	.shape-dock button.selected {
		color: #64ffda !important;
		background: rgba(100, 255, 218, 0.14) !important;
		border-color: rgba(100, 255, 218, 0.35) !important;
	}
	.shape-dock .dock-sep {
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
	@media (max-width: 640px) {
		.shape-dock .dock-hint { display: none !important; }
	}
`;

// Modal shape placement. While active, canvas pointer input draws and deletes
// shapes instead of driving particle forces.
export class ShapeEditor {
	constructor(field, canvas, onChange) {
		this.field = field;
		this.canvas = canvas;
		this.onChange = onChange || (() => {});
		this.active = false;
		this.tool = "circle";
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
		dock.innerHTML = `
			${SHAPE_TYPES.map(
				(t) =>
					`<button type="button" data-tool="${t}" title="${t}" aria-label="${t}">${GLYPHS[t]}</button>`,
			).join("")}
			<div class="dock-sep"></div>
			<span class="dock-hint">drag to size · tap a shape to delete</span>
			<button type="button" data-action="clear" title="clear all shapes" aria-label="clear all shapes">⌫</button>
			<button type="button" data-action="done" title="done" aria-label="done">✕</button>
		`;
		document.body.appendChild(dock);
		this.dock = dock;

		dock.addEventListener("pointerdown", (e) => e.stopPropagation());
		dock.addEventListener("click", (e) => {
			const button = e.target.closest("button");
			if (!button) return;
			if (button.dataset.tool) {
				this.tool = button.dataset.tool;
				this._syncDock();
			} else if (button.dataset.action === "clear") {
				this.field.clear();
				this.onChange();
			} else {
				this.deactivate();
			}
		});

		this._syncDock();
	}

	_syncDock() {
		for (const button of this.dock.querySelectorAll("button[data-tool]")) {
			button.classList.toggle("selected", button.dataset.tool === this.tool);
		}
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
			if (e.key === "Escape" && this.active) this.deactivate();
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
		const hit = this.field.hitTest(x, y);
		this._drag = { x, y, lastX: x, lastY: y, deleting: !!hit, moved: 0 };
		this.preview = hit ? null : { type: this.tool, x, y, r: 0 };
	}

	_onMove(e) {
		if (!this.active || !this._drag) return;
		const { x, y } = this._local(e);
		this._drag.lastX = x;
		this._drag.lastY = y;
		const dist = Math.hypot(x - this._drag.x, y - this._drag.y);
		this._drag.moved = Math.max(this._drag.moved, dist);
		if (this.preview) this.preview.r = dist;
	}

	_finish() {
		if (!this.active || !this._drag) return;
		const drag = this._drag;
		this._drag = null;
		this.preview = null;

		if (drag.deleting) {
			if (drag.moved <= TAP_SLOP && this.field.removeAt(drag.lastX, drag.lastY)) this.onChange();
			return;
		}

		const r =
			drag.moved <= TAP_SLOP
				? DEFAULT_TAP_RADIUS
				: Math.hypot(drag.lastX - drag.x, drag.lastY - drag.y);
		if (r < MIN_SHAPE_RADIUS) return;

		this.field.add(this.tool, drag.x, drag.y, r);
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
	}

	deactivate() {
		if (!this.active) return;
		this.active = false;
		this._drag = null;
		this.preview = null;
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
