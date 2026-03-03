const ZLAY_FIREHOSE_URL = "wss://zlay.waow.tech/xrpc/com.atproto.sync.subscribeRepos";

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
	const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
	return t * t * (3 - 2 * t);
}

function wrapHue(hue) {
	return ((hue % 360) + 360) % 360;
}

function hexToRgb(hex) {
	if (typeof hex !== "string") return null;
	const cleaned = hex.trim().replace("#", "");
	if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;

	return {
		r: Number.parseInt(cleaned.slice(0, 2), 16),
		g: Number.parseInt(cleaned.slice(2, 4), 16),
		b: Number.parseInt(cleaned.slice(4, 6), 16),
	};
}

function rgbToHue(rgb) {
	if (!rgb) return 190;
	const r = rgb.r / 255;
	const g = rgb.g / 255;
	const b = rgb.b / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	if (delta === 0) return 0;

	let hue = 0;
	if (max === r) {
		hue = ((g - b) / delta) % 6;
	} else if (max === g) {
		hue = (b - r) / delta + 2;
	} else {
		hue = (r - g) / delta + 4;
	}
	return wrapHue(hue * 60);
}

export class FirehoseEntropy {
	constructor(ctx, getViewport) {
		this.ctx = ctx;
		this.getViewport = getViewport;

		this.enabled = false;
		this.gain = 0.75;
		this.ws = null;
		this.reconnectTimer = null;
		this.reconnectDelayMs = 1000;

		this.decoder = new TextDecoder();
		this.sampleStride = 18;
		this.messageCount = 0;

		this.buckets = [];
		this.eventRate = 0;
		this.byteRate = 0;

		this.mixCreate = 0;
		this.mixUpdate = 0;
		this.mixDelete = 0;
		this.mixMeta = 0;

		this.energy = 0;
		this.pulse = 0;
		this.shear = 0;
		this.windAngle = 0;
		this.windSpeed = 0;
		this.windAngleTarget = 0;
		this.windSpeedTarget = 0;

		this.baseHue = 190;
		this.baseHueTarget = 190;
		this.phase = 0;
		this.lastFrameMs = 0;
	}

	setEnabled(enabled) {
		if (enabled === this.enabled) return;
		this.enabled = enabled;
		if (enabled) {
			this.connect();
		} else {
			this.disconnect();
			this.resetState();
		}
	}

	setGain(gain) {
		this.gain = clamp(Number.isFinite(gain) ? gain : 0.75, 0.1, 1.5);
	}

	connect() {
		if (!this.enabled || this.ws) return;

		const ws = new WebSocket(ZLAY_FIREHOSE_URL);
		ws.binaryType = "arraybuffer";

		ws.onopen = () => {
			this.reconnectDelayMs = 1000;
		};

		ws.onmessage = (event) => {
			void this.handleMessage(event.data);
		};

		ws.onclose = () => {
			if (this.ws === ws) {
				this.ws = null;
			}
			if (this.enabled) {
				this.scheduleReconnect();
			}
		};

		ws.onerror = () => ws.close();
		this.ws = ws;
	}

	scheduleReconnect() {
		if (!this.enabled || this.reconnectTimer) return;
		this.reconnectTimer = window.setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, this.reconnectDelayMs);
		this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 1.6, 16000);
	}

	disconnect() {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}

	resetState() {
		this.buckets.length = 0;
		this.eventRate = 0;
		this.byteRate = 0;
		this.mixCreate = 0;
		this.mixUpdate = 0;
		this.mixDelete = 0;
		this.mixMeta = 0;
		this.energy = 0;
		this.pulse = 0;
		this.shear = 0;
		this.windSpeed = 0;
		this.windSpeedTarget = 0;
	}

	recordTraffic(nowMs, bytes, category) {
		const bucketTime = Math.floor(nowMs / 250) * 250;
		let bucket = this.buckets[this.buckets.length - 1];
		if (!bucket || bucket.t !== bucketTime) {
			bucket = {
				t: bucketTime,
				count: 0,
				bytes: 0,
				create: 0,
				update: 0,
				delete: 0,
				meta: 0,
			};
			this.buckets.push(bucket);
		}

		bucket.count += 1;
		bucket.bytes += bytes;
		if (category === "create") bucket.create += 1;
		else if (category === "update") bucket.update += 1;
		else if (category === "delete") bucket.delete += 1;
		else bucket.meta += 1;

		const cutoff = nowMs - 9000;
		while (this.buckets.length && this.buckets[0].t < cutoff) {
			this.buckets.shift();
		}
	}

	updateRates(nowMs) {
		const cutoff = nowMs - 4500;
		let count = 0;
		let bytes = 0;
		let create = 0;
		let update = 0;
		let del = 0;
		let meta = 0;

		for (const bucket of this.buckets) {
			if (bucket.t < cutoff) continue;
			count += bucket.count;
			bytes += bucket.bytes;
			create += bucket.create;
			update += bucket.update;
			del += bucket.delete;
			meta += bucket.meta;
		}

		this.eventRate = count / 4.5;
		this.byteRate = bytes / 4.5;

		const total = Math.max(1, create + update + del + meta);
		this.mixCreate = create / total;
		this.mixUpdate = update / total;
		this.mixDelete = del / total;
		this.mixMeta = meta / total;
	}

	decodeCategory(sample) {
		const text = this.decoder.decode(sample.subarray(0, Math.min(sample.length, 240)));
		if (text.includes("fcreate")) return "create";
		if (text.includes("fupdate")) return "update";
		if (text.includes("fdelete")) return "delete";
		return "meta";
	}

	kickField(sample, category) {
		let hash = 2166136261;
		for (let i = 0; i < sample.length; i += 16) {
			hash ^= sample[i];
			hash = Math.imul(hash, 16777619);
		}
		hash >>>= 0;

		const angle = (hash / 4294967295) * Math.PI * 2;
		this.windAngleTarget = angle;

		const categoryBoost =
			category === "create"
				? 0.32
				: category === "update"
					? 0.22
					: category === "delete"
						? 0.4
						: 0.14;

		this.pulse = clamp(this.pulse + categoryBoost, 0, 1.6);
		this.shear = clamp(this.shear + (sample.length > 3000 ? 0.18 : 0.1), 0, 1.2);
	}

	async handleMessage(rawData) {
		if (!this.enabled) return;

		let bytes = 0;
		let sample = null;
		this.messageCount += 1;

		if (rawData instanceof ArrayBuffer) {
			bytes = rawData.byteLength;
			if (this.messageCount % this.sampleStride === 0) {
				sample = new Uint8Array(rawData);
			}
		} else if (rawData instanceof Blob) {
			bytes = rawData.size;
			if (this.messageCount % this.sampleStride === 0) {
				const ab = await rawData.arrayBuffer();
				sample = new Uint8Array(ab);
			}
		}

		let category = "meta";
		if (sample && sample.length > 0) {
			category = this.decodeCategory(sample);
			this.kickField(sample, category);
		}

		this.recordTraffic(performance.now(), bytes, category);
	}

	applySettingsInfluence(settings) {
		const colorHue = rgbToHue(hexToRgb(settings.CONNECTION_COLOR));
		this.baseHueTarget = colorHue;

		const countNorm = clamp((settings.PARTICLE_COUNT - 50) / (15000 - 50), 0, 1);
		const radiusNorm = clamp((settings.INTERACTION_RADIUS - 10) / (300 - 10), 0, 1);
		const opacityNorm = clamp(settings.CONNECTION_OPACITY / 0.5, 0, 1);

		const coupling =
			this.gain *
			(0.42 + countNorm * 0.18 + radiusNorm * 0.22 + opacityNorm * 0.18);

		const rateNorm = clamp(this.eventRate / 260, 0, 1.3);
		const byteNorm = clamp(this.byteRate / 3_200_000, 0, 1.2);
		const targetEnergy = clamp(rateNorm * 0.75 + byteNorm * 0.65 + this.pulse, 0, 2.2);

		this.energy = lerp(this.energy, targetEnergy * coupling, 0.09);
		this.pulse = Math.max(0, this.pulse - 0.024);
		this.shear = Math.max(0, this.shear - 0.017);
		this.baseHue = lerp(this.baseHue, this.baseHueTarget, 0.05);

		const speedTarget = clamp(0.08 + rateNorm * 0.9 + byteNorm * 0.6 + this.shear, 0.08, 1.9);
		this.windSpeedTarget = speedTarget * (0.7 + coupling * 0.5);

		let angleDiff = this.windAngleTarget - this.windAngle;
		if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
		if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
		this.windAngle += angleDiff * 0.03;
		this.windSpeed = lerp(this.windSpeed, this.windSpeedTarget, 0.06);
	}

	drawAtmosphere(width, height, intensity, driftX, driftY, hueShift) {
		const ctx = this.ctx;
		const warm = wrapHue(this.baseHue + hueShift + 24);
		const cool = wrapHue(this.baseHue + hueShift - 68);
		const spectral = wrapHue(this.baseHue + hueShift + 148);

		ctx.globalCompositeOperation = "screen";

		const wash = ctx.createLinearGradient(
			width * (0.1 - driftX * 0.12),
			height * (0.2 - driftY * 0.08),
			width * (0.9 + driftX * 0.15),
			height * (0.8 + driftY * 0.11),
		);
		wash.addColorStop(0, `hsla(${cool}, 94%, 57%, ${0.02 + intensity * 0.08})`);
		wash.addColorStop(0.5, `hsla(${warm}, 90%, 63%, ${0.03 + intensity * 0.1})`);
		wash.addColorStop(1, `hsla(${spectral}, 94%, 60%, ${0.02 + intensity * 0.08})`);
		ctx.fillStyle = wash;
		ctx.fillRect(0, 0, width, height);

		const radial = ctx.createRadialGradient(
			width * (0.5 + driftX * 0.1),
			height * (0.52 + driftY * 0.08),
			Math.min(width, height) * 0.12,
			width * (0.5 + driftX * 0.16),
			height * (0.52 + driftY * 0.12),
			Math.max(width, height) * (0.44 + intensity * 0.2),
		);
		radial.addColorStop(0, `hsla(${warm}, 96%, 70%, ${0.04 + intensity * 0.12})`);
		radial.addColorStop(0.4, `hsla(${spectral}, 90%, 66%, ${0.02 + intensity * 0.09})`);
		radial.addColorStop(1, "hsla(0, 0%, 0%, 0)");
		ctx.fillStyle = radial;
		ctx.fillRect(0, 0, width, height);
	}

	drawIsobars(width, height, intensity, settings) {
		const ctx = this.ctx;
		const radiusNorm = clamp((settings.INTERACTION_RADIUS - 10) / (300 - 10), 0, 1);
		const opacityNorm = clamp(settings.CONNECTION_OPACITY / 0.5, 0, 1);
		const lineCount = Math.round(6 + radiusNorm * 10 + opacityNorm * 8);
		const segments = 30;

		const mixTilt = this.mixCreate * 0.8 - this.mixDelete * 0.9 + this.mixUpdate * 0.25;
		const bandAlpha = (0.01 + intensity * 0.09) * (0.55 + opacityNorm * 0.9);
		const amplitude = height * (0.012 + intensity * 0.04 + radiusNorm * 0.02);

		ctx.globalCompositeOperation = "lighter";
		for (let i = 0; i < lineCount; i += 1) {
			const t = lineCount <= 1 ? 0 : i / (lineCount - 1);
			const y0 = height * (0.1 + t * 0.8);
			const freq = 1.2 + (i % 4) * 0.38 + intensity * 0.9;
			const phase = this.phase * (0.8 + this.windSpeed * 0.35) + i * 0.55;
			const hue = wrapHue(
				this.baseHue +
					mixTilt * 70 +
					Math.sin(this.phase * 0.2 + i * 0.33) * 22,
			);

			ctx.beginPath();
			for (let s = 0; s <= segments; s += 1) {
				const u = s / segments;
				const x = u * width;
				const waveA = Math.sin((u * Math.PI * 2 * freq) + phase);
				const waveB = Math.cos((u * Math.PI * 2 * (freq * 0.62)) - phase * 1.7);
				const y = y0 + waveA * amplitude + waveB * amplitude * 0.45;
				if (s === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}

			ctx.strokeStyle = `hsla(${hue}, 88%, 68%, ${bandAlpha * (0.7 + (1 - Math.abs(t - 0.5)) * 0.6)})`;
			ctx.lineWidth = 0.8 + smoothstep(0, 1, intensity) * 2.2;
			ctx.stroke();
		}
	}

	drawShearBands(width, height, intensity) {
		const ctx = this.ctx;
		if (intensity < 0.04) return;

		const bandCount = Math.round(2 + intensity * 4);
		const drift = this.phase * (16 + this.windSpeed * 55);
		const metaBias = this.mixMeta * 0.4 + this.mixUpdate * 0.25;
		ctx.globalCompositeOperation = "screen";

		for (let i = 0; i < bandCount; i += 1) {
			const widthRatio = 0.12 + (i % 3) * 0.07 + metaBias * 0.08;
			const bandWidth = width * widthRatio;
			const x = ((drift * (0.45 + i * 0.16)) + i * width * 0.23) % (width + bandWidth) - bandWidth;
			const yOffset = Math.sin(this.phase * 0.6 + i * 0.9) * height * 0.08;
			const y = height * (0.1 + ((i * 0.28) % 0.7)) + yOffset;
			const grad = ctx.createLinearGradient(x, y, x + bandWidth, y + height * 0.16);
			const hue = wrapHue(this.baseHue - 30 + i * 36 + this.mixDelete * 40);
			grad.addColorStop(0, `hsla(${hue}, 95%, 58%, 0)`);
			grad.addColorStop(0.5, `hsla(${hue}, 90%, 64%, ${0.02 + intensity * 0.08})`);
			grad.addColorStop(1, `hsla(${hue}, 95%, 58%, 0)`);

			ctx.fillStyle = grad;
			ctx.fillRect(x, y - height * 0.12, bandWidth, height * 0.26);
		}
	}

	draw(timestampMs, settings) {
		if (!this.enabled) return;

		const { width, height } = this.getViewport();
		if (!width || !height) return;

		const dt = this.lastFrameMs
			? Math.min((timestampMs - this.lastFrameMs) / 1000, 0.05)
			: 1 / 60;
		this.lastFrameMs = timestampMs;

		this.setGain(settings.FIREHOSE_ENTROPY_GAIN);
		this.updateRates(timestampMs);
		this.applySettingsInfluence(settings);

		const intensity = clamp(this.energy, 0, 1.8);
		if (intensity < 0.012 && this.eventRate < 0.5) return;

		this.phase += dt * (0.7 + this.windSpeed * 0.9);
		const driftX = Math.cos(this.windAngle) * this.windSpeed;
		const driftY = Math.sin(this.windAngle) * this.windSpeed;
		const hueShift = this.mixCreate * 52 - this.mixDelete * 67 + this.mixUpdate * 24;

		this.ctx.save();
		this.drawAtmosphere(width, height, intensity, driftX, driftY, hueShift);
		this.drawIsobars(width, height, intensity, settings);
		this.drawShearBands(width, height, intensity);
		this.ctx.restore();
	}

	destroy() {
		this.enabled = false;
		this.disconnect();
		this.resetState();
	}
}
