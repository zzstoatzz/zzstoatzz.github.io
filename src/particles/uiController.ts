// The settings panel: a gear icon that opens sliders, color pickers and
// toggles for every setting, plus reset/share and the shape tools. Styles are
// in particles.css.
import type { SettingKey, Settings } from "./config";
import { RANGES } from "./config";
import type { ParticleSystem } from "./particleSystem";

type SettingChange = <K extends SettingKey>(key: K, value: Settings[K]) => void;

export class UIController {
	private particleControls: HTMLElement | null = null;
	private settingsIcon: HTMLElement | null = null;

	constructor(
		private system: ParticleSystem,
		private onSettingChange: SettingChange,
		initialSettings: Settings,
	) {
		this.initControls();
		this.bindEvents();
		this.updateUI(initialSettings);
	}

	initControls() {
		// Insert the controls template into the DOM
		const controlsContainer = document.getElementById('particle-controls-container');
		if (!controlsContainer) {
			const container = document.createElement("div");
			container.id = 'particle-controls-container';
			container.innerHTML = this.generateControlsTemplate();
			document.body.appendChild(container);
			
			// Create success message div for notifications
			const successMsg = document.createElement("div");
			successMsg.id = "success-message";
			successMsg.className = "success-message";
			document.body.appendChild(successMsg);
			
			// Create always visible settings icon
			const settingsIcon = document.createElement("div");
			settingsIcon.id = "settings-icon";
			settingsIcon.className = "settings-icon";
			settingsIcon.innerHTML = "⚙";
			document.body.appendChild(settingsIcon);
		}

		this.particleControls = document.querySelector<HTMLElement>(".particle-controls");
		this.settingsIcon = document.getElementById("settings-icon");

		// Start with controls hidden
		if (this.particleControls) {
			this.particleControls.style.display = "none";
		}
	}

	generateControlsTemplate() {
		return `
			<div class="particle-controls">
				<div class="control-header">
					<h3>particle settings</h3>
					<button id="configToggle" class="toggle-button">×</button>
				</div>
				<div id="controlsContent" class="control-content">
					${this.generateControlGroups()}
					<div class="button-row">
						<button id="resetDefaults" class="button">reset</button>
						<button id="generateShareLink" class="button">share</button>
					</div>
				</div>
			</div>
		`;
	}

	generateControlGroups() {
		let html = '';

		// Group controls by category with updated names and added ELASTICITY
		const categories: Record<string, SettingKey[]> = {
			'particles': ['PARTICLE_COUNT', 'AVERAGE_PARTICLE_SIZE', 'DRAG', 'ELASTICITY'],
			'forces': ['GRAVITY', 'ATTRACT', 'SMOOTHING_FACTOR', 'EXPLOSION_RADIUS', 'EXPLOSION_FORCE', 'ENABLE_VORTEX_FORCE'],
			'color': ['PARTICLE_SINGLE_COLOR', 'PARTICLE_COLOR'],
			'connections': ['INTERACTION_RADIUS', 'CONNECTION_OPACITY', 'CONNECTION_WIDTH', 'CONNECTION_COLOR']
		};

		let first = true;
		for (const [category, keys] of Object.entries(categories)) {
			const open = first;
			first = false;
			html += `
				<div class="control-section">
					<button type="button" class="section-toggle" data-section="${category}" aria-expanded="${open}">
						<span class="chevron">▶</span>${category}
					</button>
					<div class="section-body${open ? ' open' : ''}" data-section-body="${category}">
			`;

			for (const key of keys) {
				const range = RANGES[key];
				if (!range) continue;
				
				// Generate label based on key with better formatting
				const labelText = key.toLowerCase().replace(/_/g, ' ');
				
				if (key === 'CONNECTION_COLOR' || key === 'PARTICLE_COLOR') {
					html += `
						<div class="control-group">
							<label for="${key}">${labelText}</label>
							<div class="slider-row">
								<input type="color" id="${key}" class="color-picker" value="${range.default}">
								<span id="${key}_VALUE" class="value-display">${range.default}</span>
							</div>
						</div>
					`;
				} else if (key === 'ENABLE_VORTEX_FORCE' || key === 'PARTICLE_SINGLE_COLOR') {
					const label = key === 'PARTICLE_SINGLE_COLOR' ? 'one color' : labelText;
					const note = key === 'PARTICLE_SINGLE_COLOR' ? 'same for all' : 'special mouse force';
					html += `
						<div class="control-group">
							<label for="${key}">${label}</label>
							<div class="slider-row">
								<input type="checkbox" id="${key}" ${range.default ? 'checked' : ''}>
								<span class="value-display">${note}</span>
							</div>
						</div>
					`;
				} else {
					html += `
						<div class="control-group">
							<label for="${key}">${labelText}</label>
							<div class="slider-row">
								<input type="range" id="${key}" class="slider-input" 
									min="${range.min}" max="${range.max}" step="${range.step}" value="${range.default}">
								<span id="${key}_VALUE" class="value-display">${range.default}</span>
							</div>
						</div>
					`;
				}
			}

			if (category === 'color') {
				html += `
					<div class="button-row" style="margin-top: 0;">
						<button id="randomizeColors" class="button">randomize colors</button>
					</div>
				`;
			}

			html += '</div></div>';
		}

		html += `
			<div class="control-section">
				<button type="button" class="section-toggle" data-section="shapes" aria-expanded="false">
					<span class="chevron">▶</span>shapes
				</button>
				<div class="section-body" data-section-body="shapes">
					<p class="section-note">solid obstacles the particles have to flow around.</p>
					<div class="button-row" style="margin-top: 0; flex-direction: column;">
						<button id="toggleShapeMode" class="button">place shapes</button>
						<button id="clearShapes" class="button">clear all shapes</button>
					</div>
				</div>
			</div>
		`;

		return html;
	}

	bindEvents() {
		// Get all settings sliders and add direct event listeners
		// Scoped to the panel: other components (the shape dock) also put
		// inputs in the document, and a bare selector would hijack them.
		const allRangeInputs = document.querySelectorAll<HTMLInputElement>('.particle-controls input[type="range"]');
		
		for (const input of allRangeInputs) {
			// Extract key from ID
			const key = input.id as SettingKey;
			if (!key) continue;

			const handleChange = () => {
				const value = Number.parseFloat(newInput.value);
				if (Number.isNaN(value)) return;
				this.onSettingChange(key, value);

				const valueDisplay = document.getElementById(`${key}_VALUE`);
				if (valueDisplay) valueDisplay.textContent = value.toString();
			};

			// Remove existing handlers by cloning
			const newInput = input.cloneNode(true) as HTMLInputElement;
			input.replaceWith(newInput);
			
			// Add handlers to the new element
			newInput.addEventListener('input', handleChange);
			newInput.addEventListener('change', handleChange);
			newInput.addEventListener('touchstart', (e) => {
				e.stopPropagation(); // Prevent canvas interaction while using slider
			}, { passive: true });
			newInput.addEventListener('touchmove', (e) => {
				e.stopPropagation(); // Prevent canvas interaction while using slider
			}, { passive: true });
		}
		
		// Set up special controls: color pickers
		for (const colorKey of ["CONNECTION_COLOR", "PARTICLE_COLOR"] as const) {
			const colorPicker = document.getElementById(colorKey);
			if (!colorPicker) continue;
			const handleColorChange = () => {
				const value = newColorPicker.value;
				this.onSettingChange(colorKey, value);

				// picking a particle color means you want one color
				const single = document.getElementById("PARTICLE_SINGLE_COLOR") as HTMLInputElement | null;
				if (colorKey === "PARTICLE_COLOR" && single && !single.checked) {
					single.checked = true;
					this.onSettingChange("PARTICLE_SINGLE_COLOR", true);
				}

				const valueDisplay = document.getElementById(`${colorKey}_VALUE`);
				if (valueDisplay) {
					valueDisplay.textContent = value;
				}
			};

			const newColorPicker = colorPicker.cloneNode(true) as HTMLInputElement;
			colorPicker.replaceWith(newColorPicker);
			
			newColorPicker.addEventListener('input', handleColorChange);
			newColorPicker.addEventListener('change', handleColorChange);
			newColorPicker.addEventListener('touchstart', (e) => {
				e.stopPropagation(); // Prevent canvas interaction while using color picker
			}, { passive: true });
		}
		
		// Checkbox controls
		for (const checkboxKey of ["ENABLE_VORTEX_FORCE", "PARTICLE_SINGLE_COLOR"] as const) {
			const checkbox = document.getElementById(checkboxKey);
			if (!checkbox) continue;
			const handleCheckboxChange = () => {
				this.onSettingChange(checkboxKey, newCheckbox.checked);
			};

			const newCheckbox = checkbox.cloneNode(true) as HTMLInputElement;
			checkbox.replaceWith(newCheckbox);

			newCheckbox.addEventListener('change', handleCheckboxChange);
			newCheckbox.addEventListener('touchstart', (e) => {
				e.stopPropagation();
			}, { passive: true });
		}
		
		// Settings icon (always visible) for opening
		if (this.settingsIcon) {
			this.settingsIcon.addEventListener('click', () => {
				this.showControlPanel();
			});
			
			this.settingsIcon.addEventListener('touchend', (e) => {
				e.preventDefault();
				this.showControlPanel();
			}, { passive: false });
		}
		
		// Config toggle button in the panel (close button)
		const configToggle = document.getElementById("configToggle");
		
		if (configToggle && this.particleControls) {
			// Clone to remove existing listeners
			const newToggle = configToggle.cloneNode(true);
			configToggle.replaceWith(newToggle);
			
			newToggle.addEventListener('click', () => {
				this.hideControlPanel();
			});
			
			// Also add touch event
			newToggle.addEventListener('touchend', (e) => {
				e.preventDefault();
				this.hideControlPanel();
			}, { passive: false });
		}
		
		// Panel buttons. touchend fires before the synthetic click, so it
		// prevents that click and runs the action itself.
		const onTap = (id: string, action: () => void) => {
			const button = document.getElementById(id);
			if (!button) return;
			button.addEventListener('click', action);
			button.addEventListener('touchend', (e) => {
				e.preventDefault();
				action();
			}, { passive: false });
		};

		onTap("resetDefaults", () => {
			this.system.settingsManager.resetToDefaults();
			this.updateUI(this.system.settingsManager.getAllSettings());
			this.showSuccessMessage("settings reset to defaults");
		});

		onTap("generateShareLink", () => {
			this.copyToClipboard(this.system.settingsManager.generateShareLink());
			this.showSuccessMessage("link copied to clipboard");
		});

		onTap("randomizeColors", () => {
			this.system.randomizeColors();
			this.showSuccessMessage("colors randomized");
		});

		// Accordion sections — one open at a time
		for (const toggle of document.querySelectorAll<HTMLElement>('.section-toggle')) {
			toggle.addEventListener('click', () => {
				const wasOpen = toggle.getAttribute('aria-expanded') === 'true';
				for (const other of document.querySelectorAll('.section-toggle')) {
					other.setAttribute('aria-expanded', 'false');
				}
				for (const body of document.querySelectorAll('.section-body')) {
					body.classList.remove('open');
				}
				if (!wasOpen) {
					toggle.setAttribute('aria-expanded', 'true');
					document
						.querySelector(`[data-section-body="${toggle.dataset.section}"]`)
						?.classList.add('open');
				}
			});
		}

		// Shape mode
		const shapeModeButton = document.getElementById("toggleShapeMode");
		if (shapeModeButton) {
			shapeModeButton.addEventListener('click', () => {
				const editor = this.system.shapeEditor;
				editor.toggle();
				this.setShapeModeActive(editor.active);
				// Get the panel out of the way so the whole canvas is placeable.
				if (editor.active) this.hideControlPanel();
			});
		}

		const clearShapesButton = document.getElementById("clearShapes");
		if (clearShapesButton) {
			clearShapesButton.addEventListener('click', () => {
				const system = this.system;
				system.shapeField.clear();
				system.settingsManager.updateSetting("SHAPES", "");
				this.showSuccessMessage("shapes cleared");
			});
		}

		// Close when clicking outside
		document.addEventListener('click', (e) => {
			if (this.particleControls && this.particleControls.style.display !== "none") {
				// Check if click is outside the controls and not on the settings icon
				if (!this.particleControls.contains(e.target as Node) && e.target !== this.settingsIcon) {
					this.hideControlPanel();
				}
			}
		});
		
		// Also handle touch outside
		document.addEventListener('touchend', (e) => {
			if (this.particleControls && this.particleControls.style.display !== "none") {
				// Check if touch is outside the controls and not on the settings icon
				if (!this.particleControls.contains(e.target as Node) && e.target !== this.settingsIcon) {
					this.hideControlPanel();
				}
			}
		}, { passive: true });
	}
	
	setShapeModeActive(active: boolean) {
		const button = document.getElementById("toggleShapeMode");
		if (!button) return;
		button.classList.toggle("armed", active);
		button.textContent = active ? "placing…" : "place shapes";
	}

	showControlPanel() {
		if (this.particleControls) {
			this.particleControls.style.display = "block";
			if (this.settingsIcon) {
				this.settingsIcon.style.display = "none";
			}
		}
	}
	
	hideControlPanel() {
		if (this.particleControls) {
			this.particleControls.style.display = "none";
			if (this.settingsIcon) {
				this.settingsIcon.style.display = "flex";
			}
		}
	}

	updateUI(settings: Settings) {
		// Update all sliders and displays
		for (const key of Object.keys(settings) as SettingKey[]) {
			const value = settings[key];
			const control = document.getElementById(key) as HTMLInputElement | null;
			const valueDisplay = document.getElementById(`${key}_VALUE`);

			if (!control) continue;

			// Update control value
			if (control.type === "checkbox") {
				control.checked = !!value;
			} else {
				control.value = String(value);
			}

			// Update display value
			if (valueDisplay) {
				if (control.type === "checkbox") {
					valueDisplay.textContent = value ? 'on' : 'off';
				} else if (typeof value === "number") {
					valueDisplay.textContent = Number.parseFloat(value.toFixed(3)).toString();
				} else {
					valueDisplay.textContent = String(value);
				}
			}
		}
	}

	copyToClipboard(text: string) {
		// Create temporary element
		const el = document.createElement("textarea");
		el.value = text;
		el.setAttribute("readonly", "");
		el.style.position = "absolute";
		el.style.left = "-9999px";
		document.body.appendChild(el);

		// Select and copy
		const selection = document.getSelection();
		const selected = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

		el.select();
		document.execCommand("copy");
		document.body.removeChild(el);

		// Restore selection if any
		if (selection && selected) {
			selection.removeAllRanges();
			selection.addRange(selected);
		}
	}
	
	showSuccessMessage(message: string) {
		const messageElement = document.getElementById("success-message");
		if (!messageElement) return;
		
		messageElement.textContent = message;
		messageElement.classList.add("show");
		
		// Hide after 2 seconds
		setTimeout(() => {
			messageElement.classList.remove("show");
		}, 2000);
	}
}
