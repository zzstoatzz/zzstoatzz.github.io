const ZLAY_FIREHOSE_URL = "wss://zlay.waow.tech/xrpc/com.atproto.sync.subscribeRepos";

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function wrapHue(h) {
	return ((h % 360) + 360) % 360;
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
	if (delta === 0) return 190;

	let hue = 0;
	if (max === r) hue = ((g - b) / delta) % 6;
	else if (max === g) hue = (b - r) / delta + 2;
	else hue = (r - g) / delta + 4;
	return wrapHue(hue * 60);
}

function shortHash(bytes) {
	let hash = 2166136261;
	for (let i = 0; i < bytes.length; i += 8) {
		hash ^= bytes[i];
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

const COLLECTION_KEYS = ["post", "like", "repost", "follow", "profile", "other"];
const COLLECTION_HUE_OFFSETS = {
	post: 18,
	like: 305,
	repost: 42,
	follow: 132,
	profile: 195,
	other: 255,
};

export class FirehoseEntropy {
	constructor(ctx, getViewport) {
		this.ctx = ctx;
		this.getViewport = getViewport;

		this.enabled = false;
		this.gain = 1.3;

		this.ws = null;
		this.reconnectTimer = null;
		this.reconnectDelayMs = 1000;

		this.decoder = new TextDecoder();
		this.sampleStride = 8;
		this.messageCount = 0;

		this.buckets = [];
		this.eventRate = 0;
		this.byteRate = 0;

		this.opsMix = { create: 0, update: 0, delete: 0, meta: 0 };
		this.collectionMix = { post: 0, like: 0, repost: 0, follow: 0, profile: 0, other: 0 };

		this.energy = 0;
		this.pulse = 0;
		this.shear = 0;

		this.baseHue = 190;
		this.baseHueTarget = 190;

		this.windAngle = 0;
		this.windAngleTarget = 0;
		this.windSpeed = 0;
		this.windSpeedTarget = 0;

		this.phase = 0;
		this.lastFrameMs = 0;
		this.statsText = "";
	}

	setEnabled(enabled) {
		if (enabled === this.enabled) return;
		this.enabled = enabled;
		if (this.enabled) this.connect();
		else {
			this.disconnect();
			this.resetState();
		}
	}

	setGain(gain) {
		this.gain = clamp(Number.isFinite(gain) ? gain : 1.3, 0.2, 3);
	}

	connect() {
		if (!this.enabled || this.ws) return;

		const ws = new WebSocket(ZLAY_FIREHOSE_URL);
		ws.binaryType = "arraybuffer";

		ws.onopen = () => {
			this.reconnectDelayMs = 1000;
		};

		ws.onmessage = (evt) => {
			void this.handleMessage(evt.data);
		};

		ws.onclose = () => {
			if (this.ws === ws) this.ws = null;
			if (this.enabled) this.scheduleReconnect();
		};

		ws.onerror = () => {
			ws.close();
		};

		this.ws = ws;
	}

	scheduleReconnect() {
		if (!this.enabled || this.reconnectTimer) return;
		this.reconnectTimer = window.setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, this.reconnectDelayMs);
		this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 1.7, 20000);
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
		this.energy = 0;
		this.pulse = 0;
		this.shear = 0;
		this.windSpeed = 0;
		this.windSpeedTarget = 0;
		this.statsText = "";
	}

	decodeOperation(text) {
		if (text.includes("fcreate")) return "create";
		if (text.includes("fupdate")) return "update";
		if (text.includes("fdelete")) return "delete";
		return "meta";
	}

	decodeCollection(text) {
		if (text.includes("app.bsky.feed.post")) return "post";
		if (text.includes("app.bsky.feed.like")) return "like";
		if (text.includes("app.bsky.feed.repost")) return "repost";
		if (text.includes("graph.follow")) return "follow";
		if (text.includes("app.bsky.actor.profile")) return "profile";
		return "other";
	}

	recordTraffic(nowMs, bytes, op, collection) {
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
				post: 0,
				like: 0,
				repost: 0,
				follow: 0,
				profile: 0,
				other: 0,
			};
			this.buckets.push(bucket);
		}

		bucket.count += 1;
		bucket.bytes += bytes;
		bucket[op] += 1;
		bucket[collection] += 1;

		const cutoff = nowMs - 10000;
		while (this.buckets.length && this.buckets[0].t < cutoff) {
			this.buckets.shift();
		}
	}

	updateRates(nowMs) {
		const cutoff = nowMs - 5000;
		let count = 0;
		let bytes = 0;
		const ops = { create: 0, update: 0, delete: 0, meta: 0 };
		const collections = { post: 0, like: 0, repost: 0, follow: 0, profile: 0, other: 0 };

		for (const bucket of this.buckets) {
			if (bucket.t < cutoff) continue;
			count += bucket.count;
			bytes += bucket.bytes;
			ops.create += bucket.create;
			ops.update += bucket.update;
			ops.delete += bucket.delete;
			ops.meta += bucket.meta;
			for (const key of COLLECTION_KEYS) collections[key] += bucket[key];
		}

		this.eventRate = count / 5;
		this.byteRate = bytes / 5;

		const opsTotal = Math.max(1, ops.create + ops.update + ops.delete + ops.meta);
		this.opsMix = {
			create: ops.create / opsTotal,
			update: ops.update / opsTotal,
			delete: ops.delete / opsTotal,
			meta: ops.meta / opsTotal,
		};

		const collectionTotal = Math.max(1, COLLECTION_KEYS.reduce((sum, key) => sum + collections[key], 0));
		this.collectionMix = {
			post: collections.post / collectionTotal,
			like: collections.like / collectionTotal,
			repost: collections.repost / collectionTotal,
			follow: collections.follow / collectionTotal,
			profile: collections.profile / collectionTotal,
			other: collections.other / collectionTotal,
		};

		let dominant = "other";
		let dominantScore = this.collectionMix.other;
		for (const key of COLLECTION_KEYS) {
			if (this.collectionMix[key] > dominantScore) {
				dominant = key;
				dominantScore = this.collectionMix[key];
			}
		}

		this.statsText = `${Math.round(this.eventRate)} ev/s · ${dominant}`;
	}

	kickField(sample, op, collection) {
		const hash = shortHash(sample);
		const angle = (hash / 4294967295) * Math.PI * 2;
		this.windAngleTarget = angle;

		const opBoost = op === "create" ? 0.38 : op === "delete" ? 0.45 : op === "update" ? 0.25 : 0.18;
		const collectionBoost = collection === "post" ? 0.24 : collection === "like" ? 0.21 : collection === "repost" ? 0.29 : collection === "follow" ? 0.34 : 0.16;
		this.pulse = clamp(this.pulse + opBoost + collectionBoost, 0, 2.2);

		const heavyPayloadBoost = sample.length > 2500 ? 0.24 : 0.12;
		this.shear = clamp(this.shear + heavyPayloadBoost, 0, 1.8);
	}

	async handleMessage(rawData) {
		if (!this.enabled) return;

		this.messageCount += 1;
		let bytes = 0;
		let sample = null;

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

		let op = "meta";
		let collection = "other";
		if (sample && sample.length > 0) {
			const text = this.decoder.decode(sample.subarray(0, Math.min(sample.length, 720)));
			op = this.decodeOperation(text);
			collection = this.decodeCollection(text);
			this.kickField(sample, op, collection);
		}

		this.recordTraffic(performance.now(), bytes, op, collection);
	}

	computePalette(baseHue) {
		let x = 0;
		let y = 0;
		for (const key of COLLECTION_KEYS) {
			const weight = this.collectionMix[key] || 0;
			if (weight <= 0) continue;
			const hue = wrapHue(baseHue + COLLECTION_HUE_OFFSETS[key]);
			const radians = (hue * Math.PI) / 180;
			x += Math.cos(radians) * weight;
			y += Math.sin(radians) * weight;
		}

		if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) {
			return {
				lead: wrapHue(baseHue + 25),
				accent: wrapHue(baseHue + 150),
				shadow: wrapHue(baseHue - 70),
			};
		}

		const lead = wrapHue((Math.atan2(y, x) * 180) / Math.PI);
		return {
			lead,
			accent: wrapHue(lead + 120),
			shadow: wrapHue(lead - 85),
		};
	}

	applySettingsInfluence(settings) {
		const colorHue = rgbToHue(hexToRgb(settings.CONNECTION_COLOR));
		this.baseHueTarget = colorHue;
		this.baseHue = lerp(this.baseHue, this.baseHueTarget, 0.08);

		const countNorm = clamp((settings.PARTICLE_COUNT - 50) / (15000 - 50), 0, 1);
		const radiusNorm = clamp((settings.INTERACTION_RADIUS - 10) / (300 - 10), 0, 1);
		const opacityNorm = clamp(settings.CONNECTION_OPACITY / 0.5, 0, 1);

		const rateNorm = clamp(this.eventRate / 180, 0, 2);
		const bytesNorm = clamp(this.byteRate / 2_200_000, 0, 2);
		const settingsCoupling = 0.55 + countNorm * 0.15 + radiusNorm * 0.15 + opacityNorm * 0.15;
		const targetEnergy = (rateNorm * 0.8 + bytesNorm * 0.85 + this.pulse) * settingsCoupling * this.gain;

		this.energy = lerp(this.energy, clamp(targetEnergy, 0, 3), 0.14);
		this.pulse = Math.max(0, this.pulse - 0.04);
		this.shear = Math.max(0, this.shear - 0.025);

		const targetSpeed = clamp(0.2 + rateNorm * 0.6 + bytesNorm * 0.5 + this.shear, 0.2, 3.2);
		this.windSpeedTarget = targetSpeed;

		let angleDelta = this.windAngleTarget - this.windAngle;
		if (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
		if (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
		this.windAngle += angleDelta * 0.05;
		this.windSpeed = lerp(this.windSpeed, this.windSpeedTarget, 0.08);
	}

	drawAtmosphere(width, height, intensity, palette, driftX, driftY) {
		const ctx = this.ctx;
		ctx.globalCompositeOperation = "screen";

		const wash = ctx.createLinearGradient(
			width * (0.08 - driftX * 0.07),
			height * (0.1 - driftY * 0.05),
			width * (0.92 + driftX * 0.12),
			height * (0.9 + driftY * 0.08),
		);
		wash.addColorStop(0, `hsla(${palette.shadow}, 95%, 54%, ${0.06 + intensity * 0.16})`);
		wash.addColorStop(0.45, `hsla(${palette.lead}, 92%, 62%, ${0.08 + intensity * 0.2})`);
		wash.addColorStop(1, `hsla(${palette.accent}, 95%, 60%, ${0.06 + intensity * 0.17})`);
		ctx.fillStyle = wash;
		ctx.fillRect(0, 0, width, height);

		const glow = ctx.createRadialGradient(
			width * (0.5 + driftX * 0.08),
			height * (0.5 + driftY * 0.08),
			Math.min(width, height) * 0.1,
			width * (0.5 + driftX * 0.12),
			height * (0.5 + driftY * 0.12),
			Math.max(width, height) * (0.52 + intensity * 0.24),
		);
		glow.addColorStop(0, `hsla(${palette.lead}, 98%, 70%, ${0.09 + intensity * 0.14})`);
		glow.addColorStop(0.4, `hsla(${palette.accent}, 95%, 66%, ${0.05 + intensity * 0.1})`);
		glow.addColorStop(1, "hsla(0, 0%, 0%, 0)");
		ctx.fillStyle = glow;
		ctx.fillRect(0, 0, width, height);
	}

	drawRibbons(width, height, intensity, palette, driftX, driftY) {
		const ctx = this.ctx;
		const count = Math.round(3 + intensity * 4);
		const speed = this.windSpeed;
		ctx.globalCompositeOperation = "lighter";

		for (let i = 0; i < count; i += 1) {
			const lane = (i + 1) / (count + 1);
			const yBase =
				height * lane +
				Math.sin(this.phase * 0.8 + i * 0.9) * height * 0.08 +
				driftY * height * 0.14;

			const xStart = -width * 0.2 + Math.sin(this.phase * 0.3 + i) * width * 0.08;
			const xEnd = width * 1.2 + Math.cos(this.phase * 0.25 + i * 0.7) * width * 0.08;
			const yLift = (Math.cos(this.phase * 0.6 + i * 1.2) + driftX * 1.3) * height * 0.11;

			const cp1x = width * (0.24 + speed * 0.03);
			const cp2x = width * (0.76 - speed * 0.02);
			const cp1y = yBase - yLift;
			const cp2y = yBase + yLift;

			const grad = ctx.createLinearGradient(0, yBase - yLift, width, yBase + yLift);
			const hueA = wrapHue(palette.shadow + i * 9);
			const hueB = wrapHue(palette.lead + i * 6);
			const hueC = wrapHue(palette.accent - i * 10);
			grad.addColorStop(0, `hsla(${hueA}, 95%, 60%, 0)`);
			grad.addColorStop(0.2, `hsla(${hueA}, 95%, 60%, ${0.1 + intensity * 0.14})`);
			grad.addColorStop(0.55, `hsla(${hueB}, 94%, 66%, ${0.14 + intensity * 0.18})`);
			grad.addColorStop(0.85, `hsla(${hueC}, 95%, 64%, ${0.1 + intensity * 0.14})`);
			grad.addColorStop(1, `hsla(${hueC}, 95%, 64%, 0)`);

			ctx.strokeStyle = grad;
			ctx.lineWidth = 8 + intensity * 20 + (1 - Math.abs(lane - 0.5)) * 8;
			ctx.lineCap = "round";
			ctx.beginPath();
			ctx.moveTo(xStart, yBase);
			ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, xEnd, yBase);
			ctx.stroke();
		}
	}

	drawContours(width, height, intensity, palette) {
		const ctx = this.ctx;
		const count = Math.round(7 + intensity * 8);
		const segments = 28;
		const amplitude = height * (0.012 + intensity * 0.04);

		ctx.globalCompositeOperation = "screen";
		for (let i = 0; i < count; i += 1) {
			const t = count <= 1 ? 0.5 : i / (count - 1);
			const yBase = height * (0.06 + t * 0.88);
			const freq = 1.3 + (i % 5) * 0.32 + intensity * 0.7;
			const phase = this.phase * (0.55 + this.windSpeed * 0.18) + i * 0.6;
			const hue = wrapHue(palette.lead + Math.sin(phase * 0.6) * 24 + i * 3);

			ctx.beginPath();
			for (let s = 0; s <= segments; s += 1) {
				const u = s / segments;
				const x = u * width;
				const y =
					yBase +
					Math.sin(u * Math.PI * 2 * freq + phase) * amplitude +
					Math.cos(u * Math.PI * 2 * (freq * 0.45) - phase * 1.4) * amplitude * 0.5;
				if (s === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}

			ctx.strokeStyle = `hsla(${hue}, 82%, 70%, ${0.07 + intensity * 0.1})`;
			ctx.lineWidth = 0.8 + intensity * 1.6;
			ctx.stroke();
		}
	}

	drawHUD(width, height, intensity, palette) {
		if (!this.statsText) return;
		const ctx = this.ctx;
		ctx.save();
		ctx.globalCompositeOperation = "source-over";
		ctx.font = "500 12px 'Fira Code', monospace";
		ctx.textAlign = "left";
		ctx.textBaseline = "bottom";

		const label = `zlay weather  ${this.statsText}`;
		const x = 18;
		const y = height - 16;
		const padX = 8;
		const padY = 5;
		const textWidth = ctx.measureText(label).width;
		ctx.fillStyle = `hsla(${palette.shadow}, 45%, 12%, ${0.25 + intensity * 0.2})`;
		ctx.fillRect(x - padX, y - 14 - padY, textWidth + padX * 2, 14 + padY * 2);
		ctx.strokeStyle = `hsla(${palette.lead}, 85%, 72%, ${0.25 + intensity * 0.3})`;
		ctx.strokeRect(x - padX, y - 14 - padY, textWidth + padX * 2, 14 + padY * 2);
		ctx.fillStyle = `hsla(${palette.accent}, 95%, 78%, ${0.7 + intensity * 0.25})`;
		ctx.fillText(label, x, y);
		ctx.restore();
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

		const intensity = clamp(this.energy, 0, 2.8);
		if (intensity < 0.03 && this.eventRate < 0.5) return;

		this.phase += dt * (0.8 + this.windSpeed * 0.6);
		const driftX = Math.cos(this.windAngle) * this.windSpeed;
		const driftY = Math.sin(this.windAngle) * this.windSpeed;
		const palette = this.computePalette(this.baseHue);

		this.ctx.save();
		this.drawAtmosphere(width, height, intensity, palette, driftX, driftY);
		this.drawRibbons(width, height, intensity, palette, driftX, driftY);
		this.drawContours(width, height, intensity, palette);
		this.drawHUD(width, height, intensity, palette);
		this.ctx.restore();
	}

	destroy() {
		this.enabled = false;
		this.disconnect();
		this.resetState();
	}
}
