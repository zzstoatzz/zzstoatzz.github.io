import { DEFAULT_SHAPE_COLOR, MIN_SHAPE_RADIUS, SHAPE_TYPES } from "./shapes.js";

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

const STYLES = `
	.shape-dock {
		position: fixed !important;
		bottom: max(20px, env(safe-area-inset-bottom, 0px)) !important;
		left: 50% !important;
		transform: translateX(-50%) !important;
		display: none;
		align-items: center !important;
		gap: 10px !important;
		padding: 7px !important;
		max-width: calc(100vw - 24px) !important;
		background: rgba(22, 26, 31, 0.72) !important;
		border: 1px solid rgba(255, 255, 255, 0.09) !important;
		border-radius: 16px !important;
		backdrop-filter: blur(20px) saturate(180%) !important;
		-webkit-backdrop-filter: blur(20px) saturate(180%) !important;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45) !important;
		font-family: var(--font-fira-code), monospace !important;
		z-index: 9999 !important;
		touch-action: manipulation !important;
	}
	.shape-dock.open { display: flex !important; }

	.shape-dock button {
		flex: none !important;
		display: flex !important;
		align-items: center !important;
		justify-content: center !important;
		width: 42px !important;
		height: 38px !important;
		padding: 0 !important;
		background: transparent !important;
		border: none !important;
		border-radius: 9px !important;
		color: rgba(255, 255, 255, 0.5) !important;
		cursor: pointer !important;
		transition: color 0.15s ease, background 0.15s ease !important;
	}
	.shape-dock button:hover { color: rgba(255, 255, 255, 0.9) !important; }

	/* Segmented control: one track, a single sliding selection. */
	.shape-seg {
		flex: none !important;
		display: flex !important;
		gap: 2px !important;
		padding: 3px !important;
		background: rgba(255, 255, 255, 0.07) !important;
		border-radius: 11px !important;
	}
	.shape-seg button.selected {
		color: #0b1417 !important;
		background: #64ffda !important;
	}

	.shape-divider {
		flex: none !important;
		width: 1px !important;
		height: 22px !important;
		background: rgba(255, 255, 255, 0.12) !important;
	}

	.shape-dock .disc {
		display: block !important;
		flex: none !important;
		width: 24px !important;
		height: 24px !important;
		border-radius: 50% !important;
		border: 1.5px solid rgba(255, 255, 255, 0.35) !important;
		box-shadow: inset 0 0 0 2px rgba(22, 26, 31, 0.9) !important;
		transition: background 0.15s ease !important;
	}
	/* Anchors the popover over the well it belongs to, not over the dock. */
	.color-slot { position: relative !important; flex: none !important; display: flex !important; }
	.color-well {
		width: 38px !important;
		height: 38px !important;
		border-radius: 50% !important;
	}
	.color-well.on { background: rgba(255, 255, 255, 0.1) !important; }
	.disc.none {
		background:
			linear-gradient(45deg, transparent 43%, rgba(255,255,255,0.55) 43%, rgba(255,255,255,0.55) 57%, transparent 57%),
			rgba(255, 255, 255, 0.06) !important;
	}

	/* Colour popover: no-fill, or the system colour wheel. */
	.color-pop {
		position: absolute !important;
		bottom: calc(100% + 10px) !important;
		left: 50% !important;
		transform: translateX(-50%) translateY(4px) !important;
		display: flex !important;
		align-items: center !important;
		gap: 6px !important;
		padding: 7px !important;
		background: rgba(28, 33, 39, 0.86) !important;
		border: 1px solid rgba(255, 255, 255, 0.1) !important;
		border-radius: 14px !important;
		backdrop-filter: blur(20px) saturate(180%) !important;
		-webkit-backdrop-filter: blur(20px) saturate(180%) !important;
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5) !important;
		opacity: 0 !important;
		pointer-events: none !important;
		transition: opacity 0.16s ease, transform 0.16s ease !important;
	}
	.color-pop.open {
		opacity: 1 !important;
		pointer-events: auto !important;
		transform: translateX(-50%) translateY(0) !important;
	}
	.color-pop .wheel {
		position: relative !important;
		display: flex !important;
		align-items: center !important;
		justify-content: center !important;
		width: 42px !important;
		height: 38px !important;
		border-radius: 9px !important;
		cursor: pointer !important;
	}
	.color-pop .wheel:hover { background: rgba(255, 255, 255, 0.08) !important; }
	.color-pop .wheel input {
		position: absolute !important;
		inset: 0 !important;
		opacity: 0 !important;
		width: 100% !important;
		height: 100% !important;
		cursor: pointer !important;
		border: none !important;
		padding: 0 !important;
	}
	.color-pop .wheel .disc {
		background: conic-gradient(#ff6b6b, #ffb86c, #f8f38d, #42b883, #00bfff, #bd93f9, #ff79c6, #ff6b6b) !important;
	}
	.color-pop button.selected .disc, .color-pop .wheel.selected .disc {
		box-shadow: inset 0 0 0 2px rgba(28, 33, 39, 0.95), 0 0 0 2px #64ffda !important;
	}

	/* Transient caption, so the gestures are discoverable without permanent chrome. */
	.shape-caption {
		position: fixed !important;
		left: 50% !important;
		transform: translateX(-50%) !important;
		bottom: calc(max(20px, env(safe-area-inset-bottom, 0px)) + 64px) !important;
		padding: 6px 12px !important;
		background: rgba(22, 26, 31, 0.72) !important;
		border-radius: 999px !important;
		backdrop-filter: blur(20px) !important;
		-webkit-backdrop-filter: blur(20px) !important;
		font-family: var(--font-fira-code), monospace !important;
		font-size: 11px !important;
		letter-spacing: 0.3px !important;
		color: rgba(255, 255, 255, 0.6) !important;
		white-space: nowrap !important;
		z-index: 9998 !important;
		opacity: 0 !important;
		pointer-events: none !important;
		transition: opacity 0.4s ease !important;
	}
	.shape-caption.show { opacity: 1 !important; }

	.shape-dock .dock-edit-only { display: none !important; }
	.shape-dock .dock-edit-only.on { display: flex !important; }

	@media (max-width: 640px) {
		.shape-dock { gap: 8px !important; }
		.shape-dock button { width: 40px !important; }
		.shape-caption { font-size: 10px !important; }
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
		this.color = null;
		this.pickerColor = DEFAULT_SHAPE_COLOR;
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
		this.pop = dock.querySelector(".color-pop");
		this.colorInput = dock.querySelector('input[type="color"]');

		const caption = document.createElement("div");
		caption.className = "shape-caption";
		caption.textContent = "drag to size · tap a shape to edit";
		document.body.appendChild(caption);
		this.caption = caption;

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
			} else if (button.dataset.action === "color") {
				this.pop.classList.toggle("open");
			} else if (button.dataset.action === "nofill") {
				this._applyColor(null);
				this.pop.classList.remove("open");
			} else if (button.dataset.action === "delete") {
				if (this.selected && this.field.remove(this.selected)) {
					this.select(null);
					this.onChange();
				}
			} else {
				this.deactivate();
			}
			this._syncDock();
		});

		// `input` fires continuously while the wheel is open, so the shape
		// recolours live rather than only on commit.
		this.colorInput.addEventListener("input", (e) => {
			this.pickerColor = e.target.value;
			this._applyColor(e.target.value);
			this._syncDock();
		});

		this._syncDock();
	}

	_applyColor(color) {
		this.color = color;
		if (!this.selected) return; // only the default for the next shape changed
		this.field.setColor(this.selected, color);
		this.onChange();
	}

	_syncDock() {
		const editing = !!this.selected;
		this.dock.querySelector(".dock-edit-only").classList.toggle("on", editing);

		const type = editing ? this.selected.type : this.tool;
		for (const button of this.dock.querySelectorAll("button[data-tool]")) {
			button.classList.toggle("selected", button.dataset.tool === type);
		}

		const color = editing ? this.selected.color : this.color;
		const disc = this.dock.querySelector(".color-well .disc");
		disc.classList.toggle("none", !color);
		disc.style.background = color || "";
		this.dock.querySelector(".color-well").classList.toggle("on", this.pop.classList.contains("open"));
		this.pop.querySelector('[data-action="nofill"]').classList.toggle("selected", !color);
		this.pop.querySelector(".wheel").classList.toggle("selected", !!color);
	}

	select(shape) {
		this.selected = shape;
		if (!shape) this.pop.classList.remove("open");
		this._syncDock();
	}

	_showCaption() {
		clearTimeout(this._captionTimer);
		this.caption.classList.add("show");
		this._captionTimer = setTimeout(() => this.caption.classList.remove("show"), HINT_DURATION);
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
				if (this.pop.classList.contains("open")) {
					this.pop.classList.remove("open");
					this._syncDock();
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

	_local(e) {
		const rect = this.canvas.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	_onDown(e) {
		if (!this.active) return;
		if (e.target?.closest?.(".shape-dock, .particle-controls, #settings-icon, nav, a, button")) return;
		e.preventDefault();

		this.caption.classList.remove("show");
		if (this.pop.classList.contains("open")) {
			this.pop.classList.remove("open");
			this._syncDock();
		}

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
		this._showCaption();
		this._syncDock();
	}

	deactivate() {
		if (!this.active) return;
		this.active = false;
		this._drag = null;
		this.preview = null;
		this.select(null);
		this.dock.classList.remove("open");
		this.caption.classList.remove("show");
		clearTimeout(this._captionTimer);
		document.body.style.touchAction = this._prevTouchAction || "";
		document.body.style.cursor = "";
		this.onDeactivate?.();
	}

	toggle() {
		if (this.active) this.deactivate();
		else this.activate();
	}
}
