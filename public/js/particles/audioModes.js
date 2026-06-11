// Experimental audio→physics rig: three switchable ways for voice to
// perturb the swarm. Pitch and loudness both matter in every mode;
// nothing recolors — sound moves matter.
//
//   cymatics — pitch picks a standing-wave pattern, loudness is how hard
//              particles snap onto its nodal lines (Chladni plate)
//   torch    — hold a steady note to charge the vortex (the mouse-hold
//              mechanic, but your lungs); breaking the note releases a blast
//   altitude — low notes sink the swarm, high notes levitate it

const MIN_CLARITY = 0.5;
// Real mics at conversational distance report tiny RMS (a hum is ~0.02);
// gate near zero and normalize against the speaker's own recent peak instead
// of any absolute scale.
const VOICE_FLOOR = 0.0025;
const PEAK_MIN = 0.012;
const PEAK_DECAY_PER_S = 0.12;
const VOICED_WINDOW_MS = 250;

// torch: how long the note can waver/drop before the hold breaks
const NOTE_BREAK_MS = 300;
const UNVOICED_BREAK_MS = 500;
const NOTE_TOLERANCE_SEMITONES = 0.8;

export class AudioModes {
	constructor(mouseEffects) {
		this.mouseEffects = mouseEffects;
		this.enabled = false;
		this.mode = "cymatics";
		this.virtualHold = false; // particleSystem renders vortex visuals at center while true

		this.level = 0;
		this.grip = 0;
		this._peak = PEAK_MIN;
		this._rawLevel = 0;
		this._midi = null;
		this._smoothedMidi = null;
		this._lastVoiced = 0;

		this._holdNote = null;
		this._holdStart = null;
		this._offNoteSince = null;
		this._unvoicedSince = null;
	}

	setSignal(frequency, clarity, level) {
		this._rawLevel = level || 0;
		if (frequency && clarity >= MIN_CLARITY && this._rawLevel >= VOICE_FLOOR) {
			this._midi = 69 + 12 * Math.log2(frequency / 440);
			this._lastVoiced = performance.now();
		}
	}

	setEnabled(enabled) {
		this.enabled = enabled;
		if (!enabled) {
			this._rawLevel = 0;
			this._breakHold(0, 0, 0, 0, true);
		}
	}

	setMode(mode) {
		if (mode === this.mode) return;
		this._breakHold(0, 0, 0, 0, true);
		this.mode = mode;
	}

	update(dtMs, particles, width, height) {
		const dt = Math.min(dtMs, 100) / 1000;
		const voiced =
			this.enabled && performance.now() - this._lastVoiced < VOICED_WINDOW_MS;

		this.level += (this._rawLevel - this.level) * Math.min(1, 12 * dt);
		if (voiced && this._midi !== null) {
			if (this._smoothedMidi === null) this._smoothedMidi = this._midi;
			this._smoothedMidi += (this._midi - this._smoothedMidi) * Math.min(1, 10 * dt);
		}

		// auto-gain: track the speaker's recent peak and judge loudness against it
		this._peak = Math.max(PEAK_MIN, this._peak * (1 - PEAK_DECAY_PER_S * dt), this.level);

		// grip: how strongly the voice holds the swarm right now (0..1)
		const gripTarget = voiced ? Math.min(1, (this.level / this._peak) * 1.15) : 0;
		this.grip += (gripTarget - this.grip) * Math.min(1, (voiced ? 5 : 2.5) * dt);

		if (this.mode === "torch") {
			this._updateTorch(voiced, particles, width, height);
			return;
		}
		this.virtualHold = false;

		if (this.grip < 0.02 || this._smoothedMidi === null) return;

		if (this.mode === "cymatics") {
			this._updateCymatics(particles, width, height);
		} else if (this.mode === "altitude") {
			this._updateAltitude(particles, height);
		}
	}

	// --- cymatics -----------------------------------------------------------

	_updateCymatics(particles, width, height) {
		const note = Math.round(this._smoothedMidi);
		// adjacent semitones land on visibly different (m, n) mode shapes
		const m = 1 + ((note * 7) % 5);
		let n = 1 + ((note * 3) % 7);
		if (n === m) n += 1;

		const k = (4.5 * this.grip) / (Math.PI * Math.max(m, n));
		const damp = 1 - 0.07 * this.grip;
		const PI = Math.PI;

		for (const p of particles) {
			const X = p.x / width;
			const Y = p.y / height;
			const cnX = Math.cos(n * PI * X);
			const cmY = Math.cos(m * PI * Y);
			const cmX = Math.cos(m * PI * X);
			const cnY = Math.cos(n * PI * Y);
			const S = cnX * cmY - cmX * cnY;
			const dSdX = PI * (-n * Math.sin(n * PI * X) * cmY + m * Math.sin(m * PI * X) * cnY);
			const dSdY = PI * (-m * cnX * Math.sin(m * PI * Y) + n * cmX * Math.sin(n * PI * Y));

			// descend S² → particles migrate to nodal lines (S = 0)
			p.vx = p.vx * damp - k * S * dSdX;
			p.vy = p.vy * damp - k * S * dSdY;
		}
	}

	// --- altitude -----------------------------------------------------------

	_updateAltitude(particles, height) {
		// singable range A2..A5 → bottom..top of screen
		const frac = 1 - Math.min(1, Math.max(0, (this._smoothedMidi - 45) / 36));
		const targetY = (0.08 + frac * 0.84) * height;
		const damp = 1 - 0.05 * this.grip;

		for (const p of particles) {
			// per-particle offset keeps it a cloud, not a line
			const target = targetY + p.sizeVariationFactor * height * 0.07;
			const dy = target - p.y;
			p.vy = p.vy * damp + Math.max(-0.6, Math.min(0.6, dy * 0.0005)) * this.grip;
		}
	}

	// --- torch --------------------------------------------------------------

	_updateTorch(voiced, particles, width, height) {
		const now = performance.now();
		const holding = this._holdStart !== null;

		if (!holding) {
			this.virtualHold = false;
			if (voiced && this._midi !== null) {
				this._holdNote = Math.round(this._midi);
				this._holdStart = now;
				this._offNoteSince = null;
				this._unvoicedSince = null;
				this.mouseEffects.startHold();
			}
			return;
		}

		// is the note still being held steadily?
		if (voiced && this._midi !== null) {
			this._unvoicedSince = null;
			if (Math.abs(this._midi - this._holdNote) <= NOTE_TOLERANCE_SEMITONES) {
				this._offNoteSince = null;
			} else if (this._offNoteSince === null) {
				this._offNoteSince = now;
			}
		} else if (this._unvoicedSince === null) {
			this._unvoicedSince = now;
		}

		const wavered = this._offNoteSince !== null && now - this._offNoteSince > NOTE_BREAK_MS;
		const faded = this._unvoicedSince !== null && now - this._unvoicedSince > UNVOICED_BREAK_MS;

		if (wavered || faded) {
			this._breakHold(width / 2, height / 2, width, height, false, particles);
			return;
		}

		this.virtualHold = true;

		// charging vortex at screen center, same growth curve as the mouse hold
		const holdDuration = (now - this._holdStart) / 1000;
		const intensity = Math.min(1, Math.log(holdDuration + 1) / Math.log(10));
		const cx = width / 2;
		const cy = height / 2;
		const radius = Math.min(width, height) * 0.38 * (1 + intensity);
		const radiusSq = radius * radius;
		// floor the drive so the swirl answers the very first moment of a hold
		const drive = 0.3 + 0.7 * intensity;
		const swirl = (0.5 + holdDuration * 0.25) * drive * Math.max(0.4, this.grip);

		for (const p of particles) {
			const dx = p.x - cx;
			const dy = p.y - cy;
			const distSq = dx * dx + dy * dy;
			if (distSq >= radiusSq || distSq < 1e-6) continue;

			const dist = Math.sqrt(distSq);
			const falloff = 1 - dist / radius;
			const dirX = dx / dist;
			const dirY = dy / dist;

			p.vx += (dirX * 0.12 + -dirY * swirl) * falloff;
			p.vy += (dirY * 0.12 + dirX * swirl) * falloff;
		}
	}

	_breakHold(cx, cy, width, height, quiet, particles) {
		if (this._holdStart === null) {
			this.virtualHold = false;
			return;
		}

		const holdDuration = (performance.now() - this._holdStart) / 1000;
		this._holdStart = null;
		this._holdNote = null;
		this._offNoteSince = null;
		this._unvoicedSince = null;
		this.virtualHold = false;

		if (quiet) {
			this.mouseEffects.holdStartTime = null;
			return;
		}

		// existing release visuals + torch-bearer high score
		this.mouseEffects.stopHold(cx, cy, width, height, { ENABLE_VORTEX_FORCE: true });

		if (particles) {
			const blast = Math.min(14, 2 ** (holdDuration / 2));
			const maxDist = Math.sqrt(width * width + height * height) / 2;
			for (const p of particles) {
				const dx = p.x - cx;
				const dy = p.y - cy;
				const dist = Math.sqrt(dx * dx + dy * dy);
				if (dist < 1e-6) continue;
				const strength = blast * (1 - Math.min(1, dist / maxDist)) * 0.5;
				p.vx += (dx / dist) * strength;
				p.vy += (dy / dist) * strength;
			}
		}
	}
}
