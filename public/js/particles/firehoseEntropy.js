const ZLAY_FIREHOSE_URL = "wss://zlay.waow.tech/xrpc/com.atproto.sync.subscribeRepos";

const COLLECTION_HUE_BIAS = {
	post: 14,
	like: -18,
	repost: 22,
	follow: 34,
	profile: -8,
	other: 0,
};

const COLLECTION_KEYS = ["post", "like", "repost", "follow", "profile", "other"];

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
	return a + (b - a) * t;
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
	if (delta === 0) return 190;

	let hue = 0;
	if (max === r) hue = ((g - b) / delta) % 6;
	else if (max === g) hue = (b - r) / delta + 2;
	else hue = (r - g) / delta + 4;
	return wrapHue(hue * 60);
}

function hashBytes(bytes) {
	let hash = 2166136261;
	for (let i = 0; i < bytes.length; i += 12) {
		hash ^= bytes[i];
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

export class FirehoseEntropy {
	constructor(ctx, getViewport) {
		this.ctx = ctx;
		this.getViewport = getViewport;

		this.enabled = false;
		this.gain = 0.9;

		this.ws = null;
		this.reconnectTimer = null;
		this.reconnectDelayMs = 1000;

		this.decoder = new TextDecoder();
		this.sampleStride = 12;
		this.messageCount = 0;

		this.buckets = [];
		this.eventRate = 0;
		this.byteRate = 0;

		this.opsMix = { create: 0, update: 0, delete: 0, meta: 0 };
		this.collectionMix = { post: 0, like: 0, repost: 0, follow: 0, profile: 0, other: 0 };

		this.baseHue = 190;
		this.baseHueTarget = 190;
		this.intensity = 0;
		this.impulse = 0;
		this.windAngle = 0;
		this.windAngleTarget = 0;
		this.windSpeed = 0;
		this.windSpeedTarget = 0;
		this.phase = 0;
		this.lastFrameMs = 0;

		this.cells = [];
		this.initCells();
	}

	initCells() {
		const { width, height } = this.getViewport();
		const w = Math.max(1, width || 1920);
		const h = Math.max(1, height || 1080);

		if (this.cells.length === 0) {
			for (let i = 0; i < 7; i += 1) {
				const t = (i + 0.5) / 7;
				this.cells.push({
					x: w * (0.15 + t * 0.7),
					y: h * (0.2 + ((i * 0.137) % 0.6)),
					vx: 0,
					vy: 0,
					radius: Math.min(w, h) * (0.18 + (i % 3) * 0.06),
					weight: 0.75 + (i % 4) * 0.15,
					hueBias: 0,
				});
			}
			return;
		}

		for (const cell of this.cells) {
			cell.x = clamp(cell.x, 0, w);
			cell.y = clamp(cell.y, 0, h);
		}
	}

	setEnabled(enabled) {
		if (enabled === this.enabled) return;
		this.enabled = enabled;
		if (this.enabled) {
			this.connect();
		} else {
			this.disconnect();
			this.resetState();
		}
	}

	setGain(gain) {
		this.gain = clamp(Number.isFinite(gain) ? gain : 0.9, 0.2, 2);
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
		this.opsMix = { create: 0, update: 0, delete: 0, meta: 0 };
		this.collectionMix = { post: 0, like: 0, repost: 0, follow: 0, profile: 0, other: 0 };
		this.intensity = 0;
		this.impulse = 0;
		this.windSpeed = 0;
		this.windSpeedTarget = 0;
		for (const cell of this.cells) {
			cell.vx = 0;
			cell.vy = 0;
			cell.hueBias = 0;
		}
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

		const collectionsTotal = Math.max(1, COLLECTION_KEYS.reduce((sum, key) => sum + collections[key], 0));
		this.collectionMix = {
			post: collections.post / collectionsTotal,
			like: collections.like / collectionsTotal,
			repost: collections.repost / collectionsTotal,
			follow: collections.follow / collectionsTotal,
			profile: collections.profile / collectionsTotal,
			other: collections.other / collectionsTotal,
		};
	}

	applyEventImpulse(hash, op, collection) {
		if (!this.cells.length) return;
		const index = hash % this.cells.length;
		const cell = this.cells[index];
		const angle = ((hash >>> 6) / 67108864) * Math.PI * 2;
		const opForce = op === "create" ? 0.65 : op === "update" ? 0.4 : op === "delete" ? 0.9 : 0.25;
		const collectionForce = collection === "post" ? 0.6 : collection === "repost" ? 0.7 : collection === "follow" ? 0.75 : 0.45;
		const force = opForce + collectionForce;

		cell.vx += Math.cos(angle) * force;
		cell.vy += Math.sin(angle) * force;
		cell.hueBias = lerp(cell.hueBias, COLLECTION_HUE_BIAS[collection] || 0, 0.35);

		this.windAngleTarget = angle;
		this.impulse = clamp(this.impulse + force * 0.2, 0, 2.6);
	}

	async handleMessage(rawData) {
		if (!this.enabled) return;

		this.messageCount += 1;
		let bytes = 0;
		let sample = null;

		if (rawData instanceof ArrayBuffer) {
			bytes = rawData.byteLength;
			if (this.messageCount % this.sampleStride === 0) sample = new Uint8Array(rawData);
		} else if (rawData instanceof Blob) {
			bytes = rawData.size;
			if (this.messageCount % this.sampleStride === 0) {
				const arrayBuffer = await rawData.arrayBuffer();
				sample = new Uint8Array(arrayBuffer);
			}
		}

		let op = "meta";
		let collection = "other";
		if (sample && sample.length > 0) {
			const text = this.decoder.decode(sample.subarray(0, Math.min(sample.length, 680)));
			op = this.decodeOperation(text);
			collection = this.decodeCollection(text);
			this.applyEventImpulse(hashBytes(sample), op, collection);
		}

		this.recordTraffic(performance.now(), bytes, op, collection);
	}

	collectionHueShift() {
		let shift = 0;
		for (const key of COLLECTION_KEYS) {
			shift += (this.collectionMix[key] || 0) * (COLLECTION_HUE_BIAS[key] || 0);
		}
		return shift;
	}

	applySettingsInfluence(settings) {
		this.baseHueTarget = rgbToHue(hexToRgb(settings.CONNECTION_COLOR));
		this.baseHue = lerp(this.baseHue, this.baseHueTarget, 0.08);

		const countNorm = clamp((settings.PARTICLE_COUNT - 50) / (15000 - 50), 0, 1);
		const radiusNorm = clamp((settings.INTERACTION_RADIUS - 10) / (300 - 10), 0, 1);
		const opacityNorm = clamp(settings.CONNECTION_OPACITY / 0.5, 0, 1);

		const rateNorm = clamp(this.eventRate / 180, 0, 2.2);
		const bytesNorm = clamp(this.byteRate / 2_100_000, 0, 2.2);
		const settingsCoupling = 0.42 + countNorm * 0.2 + radiusNorm * 0.18 + opacityNorm * 0.2;
		const target = (rateNorm * 0.55 + bytesNorm * 0.7 + this.impulse * 0.5) * this.gain * settingsCoupling;

		this.intensity = lerp(this.intensity, clamp(target, 0, 2.1), 0.1);
		this.impulse = Math.max(0, this.impulse - 0.035);

		const windTarget = clamp(0.2 + rateNorm * 0.4 + bytesNorm * 0.45 + this.opsMix.delete * 0.45, 0.2, 2.8);
		this.windSpeedTarget = windTarget;

		let delta = this.windAngleTarget - this.windAngle;
		if (delta > Math.PI) delta -= Math.PI * 2;
		if (delta < -Math.PI) delta += Math.PI * 2;
		this.windAngle += delta * 0.04;
		this.windSpeed = lerp(this.windSpeed, this.windSpeedTarget, 0.08);
	}

	stepCells(dt, width, height) {
		const windX = Math.cos(this.windAngle) * this.windSpeed;
		const windY = Math.sin(this.windAngle) * this.windSpeed;
		const scale = dt * 60;

		for (const cell of this.cells) {
			cell.vx += windX * (0.012 + cell.weight * 0.004);
			cell.vy += windY * (0.012 + cell.weight * 0.004);
			cell.vx *= 0.985;
			cell.vy *= 0.985;
			cell.x += cell.vx * scale;
			cell.y += cell.vy * scale;

			const margin = cell.radius * 0.45;
			if (cell.x < -margin) cell.x = width + margin;
			if (cell.x > width + margin) cell.x = -margin;
			if (cell.y < -margin) cell.y = height + margin;
			if (cell.y > height + margin) cell.y = -margin;
		}
	}

	drawAmbient(width, height, intensity, leadHue, accentHue) {
		const ctx = this.ctx;
		ctx.globalCompositeOperation = "soft-light";

		const grad = ctx.createLinearGradient(0, 0, width, height);
		grad.addColorStop(0, `hsla(${leadHue}, 58%, 48%, ${0.04 + intensity * 0.07})`);
		grad.addColorStop(0.5, `hsla(${accentHue}, 50%, 42%, ${0.03 + intensity * 0.06})`);
		grad.addColorStop(1, `hsla(${wrapHue(leadHue - 24)}, 46%, 38%, ${0.03 + intensity * 0.05})`);
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, width, height);
	}

	drawCellMists(width, height, intensity, leadHue, accentHue) {
		const ctx = this.ctx;
		ctx.globalCompositeOperation = "screen";

		for (let i = 0; i < this.cells.length; i += 1) {
			const cell = this.cells[i];
			const hue = wrapHue(lerp(leadHue, accentHue, i / (this.cells.length - 1 || 1)) + cell.hueBias * 0.45);
			const radius = cell.radius * (0.88 + intensity * 0.36 + cell.weight * 0.08);
			const alpha = (0.014 + intensity * 0.055) * (0.75 + cell.weight * 0.22);

			const gradient = ctx.createRadialGradient(cell.x, cell.y, radius * 0.2, cell.x, cell.y, radius);
			gradient.addColorStop(0, `hsla(${hue}, 78%, 64%, ${alpha})`);
			gradient.addColorStop(0.45, `hsla(${wrapHue(hue + 10)}, 72%, 58%, ${alpha * 0.45})`);
			gradient.addColorStop(1, "hsla(0, 0%, 0%, 0)");

			ctx.fillStyle = gradient;
			ctx.fillRect(cell.x - radius, cell.y - radius, radius * 2, radius * 2);
		}
	}

	drawFilaments(intensity, hue) {
		if (this.cells.length < 3) return;
		const ctx = this.ctx;
		const cellsByX = [...this.cells].sort((a, b) => a.x - b.x);
		ctx.globalCompositeOperation = "screen";
		ctx.strokeStyle = `hsla(${hue}, 78%, 72%, ${0.015 + intensity * 0.055})`;
		ctx.lineWidth = 0.7 + intensity * 0.9;
		ctx.lineCap = "round";
		ctx.beginPath();
		ctx.moveTo(cellsByX[0].x, cellsByX[0].y);
		for (let i = 1; i < cellsByX.length; i += 1) {
			const prev = cellsByX[i - 1];
			const curr = cellsByX[i];
			const midX = (prev.x + curr.x) * 0.5;
			const midY = (prev.y + curr.y) * 0.5 + Math.sin(this.phase + i) * (8 + intensity * 18);
			ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
		}
		const last = cellsByX[cellsByX.length - 1];
		ctx.lineTo(last.x, last.y);
		ctx.stroke();
	}

	draw(timestampMs, settings) {
		if (!this.enabled) return;

		const { width, height } = this.getViewport();
		if (!width || !height) return;

		if (!this.cells.length) this.initCells();

		const dt = this.lastFrameMs
			? Math.min((timestampMs - this.lastFrameMs) / 1000, 0.05)
			: 1 / 60;
		this.lastFrameMs = timestampMs;
		this.phase += dt * (0.35 + this.windSpeed * 0.22);

		this.setGain(settings.FIREHOSE_ENTROPY_GAIN);
		this.updateRates(timestampMs);
		this.applySettingsInfluence(settings);

		if (this.intensity < 0.01 && this.eventRate < 0.5) return;

		this.stepCells(dt, width, height);

		const hueShift = this.collectionHueShift();
		const leadHue = wrapHue(this.baseHue + hueShift * 0.7);
		const accentHue = wrapHue(leadHue + 28 + this.opsMix.delete * 12 - this.opsMix.meta * 7);

		this.ctx.save();
		this.drawAmbient(width, height, this.intensity, leadHue, accentHue);
		this.drawCellMists(width, height, this.intensity, leadHue, accentHue);
		this.drawFilaments(this.intensity, wrapHue(leadHue + 14));
		this.ctx.restore();
	}

	destroy() {
		this.enabled = false;
		this.disconnect();
		this.resetState();
	}
}
