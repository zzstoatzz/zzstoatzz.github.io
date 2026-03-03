const ZLAY_FIREHOSE_URL = "wss://zlay.waow.tech/xrpc/com.atproto.sync.subscribeRepos";

const COLLECTION_BIAS = {
	post: 8,
	like: -5,
	repost: 11,
	follow: 14,
	profile: -3,
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
	for (let i = 0; i < bytes.length; i += 16) {
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
		this.gain = 0.85;
		this.ws = null;
		this.reconnectTimer = null;
		this.reconnectDelayMs = 1000;

		this.decoder = new TextDecoder();
		this.sampleStride = 18;
		this.messageCount = 0;

		this.buckets = [];
		this.eventRate = 0;
		this.byteRate = 0;
		this.opsMix = { create: 0, update: 0, delete: 0, meta: 0 };
		this.collectionMix = { post: 0, like: 0, repost: 0, follow: 0, profile: 0, other: 0 };

		this.baseHue = 190;
		this.tintHue = 190;
		this.tintAlpha = 0;
		this.targetAlpha = 0;
		this.phase = 0;

		this.centerX = 0.5;
		this.centerY = 0.5;
		this.targetCenterX = 0.5;
		this.targetCenterY = 0.5;

		this.pulse = 0;
		this.lastFrameMs = 0;
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
		this.gain = clamp(Number.isFinite(gain) ? gain : 0.85, 0.2, 2);
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
		this.tintAlpha = 0;
		this.targetAlpha = 0;
		this.pulse = 0;
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

	recordTraffic(nowMs, bytes, operation, collection) {
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
		bucket[operation] += 1;
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
	}

	applyImpulse(hash, operation, collection) {
		const angle = (hash / 4294967295) * Math.PI * 2;
		this.targetCenterX = 0.5 + Math.cos(angle) * 0.08;
		this.targetCenterY = 0.5 + Math.sin(angle) * 0.08;

		const opWeight = operation === "create" ? 0.18 : operation === "delete" ? 0.24 : operation === "update" ? 0.14 : 0.08;
		const collectionWeight = collection === "post" ? 0.14 : collection === "follow" ? 0.16 : collection === "repost" ? 0.15 : 0.1;
		this.pulse = clamp(this.pulse + opWeight + collectionWeight, 0, 1.2);
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

		let operation = "meta";
		let collection = "other";
		if (sample && sample.length > 0) {
			const text = this.decoder.decode(sample.subarray(0, Math.min(sample.length, 600)));
			operation = this.decodeOperation(text);
			collection = this.decodeCollection(text);
			this.applyImpulse(hashBytes(sample), operation, collection);
		}

		this.recordTraffic(performance.now(), bytes, operation, collection);
	}

	getCollectionHueShift() {
		let shift = 0;
		for (const key of COLLECTION_KEYS) {
			shift += (this.collectionMix[key] || 0) * (COLLECTION_BIAS[key] || 0);
		}
		return clamp(shift, -14, 14);
	}

	applySettingsInfluence(settings) {
		this.baseHue = lerp(this.baseHue, rgbToHue(hexToRgb(settings.CONNECTION_COLOR)), 0.08);

		const countNorm = clamp((settings.PARTICLE_COUNT - 50) / (15000 - 50), 0, 1);
		const radiusNorm = clamp((settings.INTERACTION_RADIUS - 10) / (300 - 10), 0, 1);
		const opacityNorm = clamp(settings.CONNECTION_OPACITY / 0.5, 0, 1);
		const settingsCoupling = 0.45 + countNorm * 0.15 + radiusNorm * 0.2 + opacityNorm * 0.2;

		const rateNorm = clamp(this.eventRate / 210, 0, 1.8);
		const bytesNorm = clamp(this.byteRate / 2_400_000, 0, 1.8);
		const target = (0.004 + rateNorm * 0.014 + bytesNorm * 0.016 + this.pulse * 0.02) * this.gain * settingsCoupling;

		this.targetAlpha = clamp(target, 0.004, 0.07);
		this.tintAlpha = lerp(this.tintAlpha, this.targetAlpha, 0.08);

		this.centerX = lerp(this.centerX, this.targetCenterX, 0.03);
		this.centerY = lerp(this.centerY, this.targetCenterY, 0.03);

		this.pulse = Math.max(0, this.pulse - 0.02);
	}

	draw(timestampMs, settings) {
		if (!this.enabled) return;

		const { width, height } = this.getViewport();
		if (!width || !height) return;

		const dt = this.lastFrameMs
			? Math.min((timestampMs - this.lastFrameMs) / 1000, 0.05)
			: 1 / 60;
		this.lastFrameMs = timestampMs;
		this.phase += dt * 0.22;

		this.setGain(settings.FIREHOSE_ENTROPY_GAIN);
		this.updateRates(timestampMs);
		this.applySettingsInfluence(settings);

		if (this.tintAlpha < 0.003) return;

		const hueShift = this.getCollectionHueShift();
		this.tintHue = lerp(this.tintHue, wrapHue(this.baseHue + hueShift), 0.05);
		const accentHue = wrapHue(this.tintHue + 16 + this.opsMix.delete * 8 - this.opsMix.meta * 4);

		const cx = width * this.centerX;
		const cy = height * this.centerY;
		const radius = Math.max(width, height) * (0.6 + Math.sin(this.phase) * 0.02);

		this.ctx.save();

		this.ctx.globalCompositeOperation = "soft-light";
		const wash = this.ctx.createLinearGradient(0, 0, width, height);
		wash.addColorStop(0, `hsla(${this.tintHue}, 46%, 50%, ${this.tintAlpha * 0.9})`);
		wash.addColorStop(0.55, `hsla(${accentHue}, 42%, 46%, ${this.tintAlpha * 0.6})`);
		wash.addColorStop(1, `hsla(${wrapHue(this.tintHue - 12)}, 38%, 40%, ${this.tintAlpha * 0.7})`);
		this.ctx.fillStyle = wash;
		this.ctx.fillRect(0, 0, width, height);

		this.ctx.globalCompositeOperation = "screen";
		const bloom = this.ctx.createRadialGradient(cx, cy, radius * 0.15, cx, cy, radius);
		bloom.addColorStop(0, `hsla(${accentHue}, 72%, 64%, ${this.tintAlpha * 0.55})`);
		bloom.addColorStop(0.45, `hsla(${this.tintHue}, 66%, 58%, ${this.tintAlpha * 0.22})`);
		bloom.addColorStop(1, "hsla(0, 0%, 0%, 0)");
		this.ctx.fillStyle = bloom;
		this.ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

		this.ctx.restore();
	}

	destroy() {
		this.enabled = false;
		this.disconnect();
		this.resetState();
	}
}
