const ZLAY_FIREHOSE_URL = "wss://zlay.waow.tech/xrpc/com.atproto.sync.subscribeRepos";

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function fnv1a32(bytes) {
	let hash = 0x811c9dc5;
	for (let i = 0; i < bytes.length; i += 1) {
		hash ^= bytes[i];
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function pseudoRandom(seed) {
	let x = seed >>> 0;
	x ^= x << 13;
	x ^= x >>> 17;
	x ^= x << 5;
	return (x >>> 0) / 4294967295;
}

export class FirehoseEntropy {
	constructor(ctx, getViewport) {
		this.ctx = ctx;
		this.getViewport = getViewport;

		this.enabled = false;
		this.gain = 1;
		this.ws = null;
		this.reconnectTimer = null;
		this.reconnectDelayMs = 1200;

		this.messageCount = 0;
		this.sampleStride = 14;
		this.trafficBuckets = [];
		this.activity = 0;
		this.bandwidth = 0;
		this.energy = 0;
		this.pulseEnergy = 0;

		this.hue = 190;
		this.hueTarget = 190;
		this.wind = { x: 0, y: 0 };
		this.windTarget = { x: 0, y: 0 };

		this.bursts = [];
		this.trails = [];
		this.decoder = new TextDecoder();
		this.lastFrameMs = 0;
	}

	setEnabled(enabled) {
		if (enabled === this.enabled) {
			return;
		}

		this.enabled = enabled;
		if (this.enabled) {
			this.connect();
		} else {
			this.disconnect();
			this.resetVisualState();
		}
	}

	setGain(gain) {
		this.gain = clamp(Number.isFinite(gain) ? gain : 1, 0.1, 2);
	}

	connect() {
		if (!this.enabled || this.ws) {
			return;
		}

		const ws = new WebSocket(ZLAY_FIREHOSE_URL);
		ws.binaryType = "arraybuffer";

		ws.onopen = () => {
			this.reconnectDelayMs = 1200;
		};

		ws.onmessage = (event) => {
			void this.handleRawMessage(event.data);
		};

		ws.onclose = () => {
			if (this.ws === ws) {
				this.ws = null;
			}
			if (this.enabled) {
				this.scheduleReconnect();
			}
		};

		ws.onerror = () => {
			ws.close();
		};

		this.ws = ws;
	}

	scheduleReconnect() {
		if (this.reconnectTimer || !this.enabled) {
			return;
		}

		this.reconnectTimer = window.setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, this.reconnectDelayMs);

		this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 1.6, 15000);
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

	resetVisualState() {
		this.energy = 0;
		this.pulseEnergy = 0;
		this.bursts.length = 0;
		this.trails.length = 0;
		this.trafficBuckets.length = 0;
	}

	recordTraffic(nowMs, payloadSize) {
		const bucketMs = Math.floor(nowMs / 250) * 250;
		const last = this.trafficBuckets[this.trafficBuckets.length - 1];

		if (last && last.t === bucketMs) {
			last.count += 1;
			last.bytes += payloadSize;
		} else {
			this.trafficBuckets.push({ t: bucketMs, count: 1, bytes: payloadSize });
		}

		const cutoff = nowMs - 7000;
		while (this.trafficBuckets.length > 0 && this.trafficBuckets[0].t < cutoff) {
			this.trafficBuckets.shift();
		}
	}

	updateRates(nowMs) {
		let count = 0;
		let bytes = 0;
		const cutoff = nowMs - 4000;

		for (const bucket of this.trafficBuckets) {
			if (bucket.t >= cutoff) {
				count += bucket.count;
				bytes += bucket.bytes;
			}
		}

		this.activity = count / 4;
		this.bandwidth = bytes / 4;
	}

	sniffEventKind(bytes) {
		const headerText = this.decoder.decode(bytes.subarray(0, Math.min(220, bytes.length)));
		if (headerText.includes("identity")) return "identity";
		if (headerText.includes("account")) return "account";
		if (headerText.includes("handle")) return "handle";
		if (headerText.includes("commit")) return "commit";
		return "unknown";
	}

	eventHueOffset(kind) {
		switch (kind) {
			case "commit":
				return 12;
			case "identity":
				return 140;
			case "account":
				return 220;
			case "handle":
				return 300;
			default:
				return 0;
		}
	}

	createBurst(nowMs, payloadSize, hash, kind) {
		const { width, height } = this.getViewport();
		if (!width || !height) {
			return;
		}

		const eventScale = clamp(Math.log2(payloadSize + 1) / 12, 0.25, 1.2);
		const baseRand = pseudoRandom(hash);
		const angleRand = pseudoRandom(hash ^ 0x9e3779b9);
		const xRand = pseudoRandom(hash ^ 0xa24baed4);
		const yRand = pseudoRandom(hash ^ 0x48b17db7);

		const x = xRand * width;
		const y = yRand * height;
		const angle = angleRand * Math.PI * 2;
		const hue = (this.hue + this.eventHueOffset(kind) + baseRand * 40) % 360;

		this.bursts.push({
			x,
			y,
			radius: 12 + eventScale * 28,
			maxRadius: 85 + eventScale * 190,
			life: 1,
			hue,
			twist: (baseRand - 0.5) * 0.8,
			birth: nowMs,
		});

		const trailCount = 1 + Math.floor(eventScale * 3);
		for (let i = 0; i < trailCount; i += 1) {
			const localAngle = angle + (i - trailCount / 2) * 0.45;
			const speed = 90 + eventScale * 240 + i * 24;
			this.trails.push({
				x,
				y,
				px: x,
				py: y,
				vx: Math.cos(localAngle) * speed,
				vy: Math.sin(localAngle) * speed,
				life: 0.9,
				decay: 0.22 + i * 0.05,
				hue: (hue + i * 12) % 360,
				width: 1.2 + eventScale * 3,
			});
		}

		const windStrength = 0.35 + eventScale * 1.8;
		this.windTarget.x = Math.cos(angle) * windStrength;
		this.windTarget.y = Math.sin(angle) * windStrength;
		this.hueTarget = hue;
		this.pulseEnergy = clamp(this.pulseEnergy + eventScale * 0.2, 0, 1.2);

		if (this.bursts.length > 80) {
			this.bursts.splice(0, this.bursts.length - 80);
		}
		if (this.trails.length > 220) {
			this.trails.splice(0, this.trails.length - 220);
		}
	}

	async handleRawMessage(rawData) {
		if (!this.enabled) {
			return;
		}

		let payloadSize = 0;
		let sampledBytes = null;
		this.messageCount += 1;

		if (rawData instanceof ArrayBuffer) {
			payloadSize = rawData.byteLength;
			if (this.messageCount % this.sampleStride === 0) {
				sampledBytes = new Uint8Array(rawData);
			}
		} else if (rawData instanceof Blob) {
			payloadSize = rawData.size;
			if (this.messageCount % this.sampleStride === 0) {
				const arrayBuffer = await rawData.arrayBuffer();
				sampledBytes = new Uint8Array(arrayBuffer);
			}
		}

		const nowMs = performance.now();
		this.recordTraffic(nowMs, payloadSize);

		if (!sampledBytes || sampledBytes.length === 0) {
			return;
		}

		const hash = fnv1a32(sampledBytes);
		const kind = this.sniffEventKind(sampledBytes);
		this.createBurst(nowMs, payloadSize, hash, kind);
	}

	drawAurora(timestampMs, width, height, intensity) {
		const ctx = this.ctx;
		const driftX = this.wind.x * width * 0.15;
		const phase = timestampMs * 0.00008;
		const hueA = (this.hue + Math.sin(phase * 8) * 24 + 360) % 360;
		const hueB = (this.hue + 80 + Math.cos(phase * 5.5) * 28 + 360) % 360;
		const hueC = (this.hue + 200 + Math.sin(phase * 4) * 16 + 360) % 360;

		ctx.globalCompositeOperation = "screen";

		const gradA = ctx.createLinearGradient(
			-driftX,
			height * (0.35 + this.wind.y * 0.08),
			width + driftX,
			height * (0.75 - this.wind.y * 0.08),
		);
		gradA.addColorStop(0, `hsla(${hueA}, 95%, 55%, ${0.04 + intensity * 0.16})`);
		gradA.addColorStop(0.5, `hsla(${hueB}, 88%, 64%, ${0.02 + intensity * 0.12})`);
		gradA.addColorStop(1, `hsla(${hueC}, 95%, 60%, ${0.03 + intensity * 0.14})`);
		ctx.fillStyle = gradA;
		ctx.fillRect(0, 0, width, height);

		const centerX = width * (0.5 + this.wind.x * 0.1);
		const centerY = height * (0.5 + this.wind.y * 0.1);
		const radial = ctx.createRadialGradient(
			centerX,
			centerY,
			Math.min(width, height) * 0.08,
			centerX,
			centerY,
			Math.max(width, height) * (0.45 + intensity * 0.2),
		);
		radial.addColorStop(0, `hsla(${(hueA + 45) % 360}, 95%, 62%, ${0.08 + intensity * 0.14})`);
		radial.addColorStop(0.35, `hsla(${(hueB + 20) % 360}, 96%, 58%, ${0.05 + intensity * 0.1})`);
		radial.addColorStop(1, "hsla(0, 0%, 0%, 0)");
		ctx.fillStyle = radial;
		ctx.fillRect(0, 0, width, height);
	}

	drawBursts(dt, intensity) {
		const ctx = this.ctx;

		for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
			const burst = this.bursts[i];
			burst.life -= dt * (0.55 + intensity * 0.5);
			burst.radius += dt * (80 + intensity * 320);
			if (burst.life <= 0 || burst.radius >= burst.maxRadius) {
				this.bursts.splice(i, 1);
				continue;
			}

			const inner = Math.max(1, burst.radius * 0.12);
			const gradient = ctx.createRadialGradient(
				burst.x,
				burst.y,
				inner,
				burst.x,
				burst.y,
				burst.radius,
			);
			gradient.addColorStop(0, `hsla(${burst.hue}, 98%, 74%, ${burst.life * 0.22 * intensity})`);
			gradient.addColorStop(0.45, `hsla(${(burst.hue + 26) % 360}, 96%, 62%, ${burst.life * 0.16 * intensity})`);
			gradient.addColorStop(1, "hsla(0, 0%, 0%, 0)");
			ctx.fillStyle = gradient;
			ctx.beginPath();
			ctx.arc(burst.x, burst.y, burst.radius, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	drawTrails(dt, intensity) {
		const ctx = this.ctx;
		const windPushX = this.wind.x * (70 + intensity * 260) * this.gain;
		const windPushY = this.wind.y * (70 + intensity * 260) * this.gain;

		ctx.globalCompositeOperation = "lighter";
		for (let i = this.trails.length - 1; i >= 0; i -= 1) {
			const trail = this.trails[i];
			trail.life -= dt * trail.decay;
			if (trail.life <= 0) {
				this.trails.splice(i, 1);
				continue;
			}

			trail.px = trail.x;
			trail.py = trail.y;
			trail.vx = lerp(trail.vx, trail.vx + windPushX, 0.02);
			trail.vy = lerp(trail.vy, trail.vy + windPushY, 0.02);
			trail.x += trail.vx * dt;
			trail.y += trail.vy * dt;

			ctx.strokeStyle = `hsla(${trail.hue}, 95%, 68%, ${trail.life * 0.24 * intensity})`;
			ctx.lineWidth = trail.width;
			ctx.beginPath();
			ctx.moveTo(trail.px, trail.py);
			ctx.lineTo(trail.x, trail.y);
			ctx.stroke();
		}
	}

	drawDust(timestampMs, width, height, intensity) {
		const ctx = this.ctx;
		const fleckCount = Math.floor(6 + intensity * 20);
		ctx.globalCompositeOperation = "screen";

		for (let i = 0; i < fleckCount; i += 1) {
			const seed = ((timestampMs | 0) + i * 977 + this.messageCount * 37) >>> 0;
			const x = pseudoRandom(seed ^ 0x8f1bbcdc) * width;
			const y = pseudoRandom(seed ^ 0x14f02d4e) * height;
			const hue = (this.hue + pseudoRandom(seed ^ 0xb5297a4d) * 120) % 360;
			const size = 0.7 + pseudoRandom(seed ^ 0x68e31da4) * 2.8;
			ctx.fillStyle = `hsla(${hue}, 88%, 72%, ${0.03 + intensity * 0.09})`;
			ctx.fillRect(x, y, size, size);
		}
	}

	draw(timestampMs, settings) {
		if (!this.enabled) {
			return;
		}

		const { width, height } = this.getViewport();
		if (!width || !height) {
			return;
		}

		const dt = this.lastFrameMs ? Math.min((timestampMs - this.lastFrameMs) / 1000, 0.05) : 1 / 60;
		this.lastFrameMs = timestampMs;

		const configuredGain = settings && Number.isFinite(settings.FIREHOSE_ENTROPY_GAIN)
			? settings.FIREHOSE_ENTROPY_GAIN
			: this.gain;
		this.setGain(configuredGain);

		this.updateRates(timestampMs);

		const activityN = clamp(this.activity / 220, 0, 1);
		const bandwidthN = clamp(this.bandwidth / 2_800_000, 0, 1);
		const targetEnergy = clamp(activityN * 0.8 + bandwidthN * 0.65 + this.pulseEnergy, 0, 1.7);

		this.energy = lerp(this.energy, targetEnergy, 0.1);
		this.pulseEnergy = Math.max(0, this.pulseEnergy - dt * 0.28);
		this.hue = lerp(this.hue, this.hueTarget, 0.03);
		this.wind.x = lerp(this.wind.x, this.windTarget.x, 0.04);
		this.wind.y = lerp(this.wind.y, this.windTarget.y, 0.04);

		const intensity = clamp(this.energy * this.gain, 0, 1.8);
		if (intensity < 0.015 && this.bursts.length === 0 && this.trails.length === 0) {
			return;
		}

		this.ctx.save();
		this.drawAurora(timestampMs, width, height, intensity);
		this.drawBursts(dt, intensity);
		this.drawTrails(dt, intensity);
		this.drawDust(timestampMs, width, height, intensity);
		this.ctx.restore();
	}

	destroy() {
		this.enabled = false;
		this.disconnect();
		this.resetVisualState();
	}
}
