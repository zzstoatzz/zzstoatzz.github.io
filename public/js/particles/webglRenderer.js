import * as THREE from 'three';
import { PARTICLE_COLORS } from './config.js';

const MAX_PARTICLES = 50000;
const MAX_CONNECTIONS = 200000;

// Pre-compute RGB for each particle color
const COLOR_RGB = PARTICLE_COLORS.map(hex => [
	parseInt(hex.slice(1, 3), 16) / 255,
	parseInt(hex.slice(3, 5), 16) / 255,
	parseInt(hex.slice(5, 7), 16) / 255,
]);

// Fast hex -> index lookup
const COLOR_INDEX = new Map();
for (let i = 0; i < PARTICLE_COLORS.length; i++) {
	COLOR_INDEX.set(PARTICLE_COLORS[i], i);
}

export class WebGLParticleRenderer {
	constructor(width, height) {
		this.width = width;
		this.height = height;

		this.renderer = new THREE.WebGLRenderer({
			alpha: true,
			antialias: false,
			premultipliedAlpha: false,
		});
		this.renderer.setSize(width, height);
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.renderer.setClearColor(0x000000, 0);

		this.domElement = this.renderer.domElement;

		this.scene = new THREE.Scene();

		// Orthographic camera: y-down matching Canvas 2D coordinates
		// top=0 at screen top, bottom=height at screen bottom
		this.camera = new THREE.OrthographicCamera(0, width, 0, height, -1, 1);

		this._initParticles();
		this._initConnections();
	}

	_initParticles() {
		const geo = new THREE.BufferGeometry();

		const positions = new Float32Array(MAX_PARTICLES * 3);
		const colors = new Float32Array(MAX_PARTICLES * 3);
		const sizes = new Float32Array(MAX_PARTICLES);
		const seeds = new Float32Array(MAX_PARTICLES);

		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
		geo.setAttribute('customColor', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
		geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
		geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1).setUsage(THREE.DynamicDrawUsage));
		geo.setDrawRange(0, 0);

		// Bubble shader.
		// - Translucent body so colors layer like soap film.
		// - Fresnel-style rim brightening: color is most saturated near the edge.
		// - Off-center specular highlight (the white "reflection" you see on Apple bubbles).
		// - Inner core kept faint to read as glass, not paint.
		// Point sprites are scaled up (3.4x) to give the shading room to read on small radii.
		const material = new THREE.ShaderMaterial({
			uniforms: {
				pixelRatio: { value: this.renderer.getPixelRatio() },
			},
			vertexShader: `
				attribute vec3 customColor;
				attribute float size;
				attribute float seed;
				varying vec3 vColor;
				varying float vSize;
				varying float vSeed;
				uniform float pixelRatio;
				void main() {
					vColor = customColor;
					vSize = size;
					vSeed = seed;
					gl_PointSize = size * 2.0 * pixelRatio;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: `
				varying vec3 vColor;
				varying float vSize;
				varying float vSeed;
				void main() {
					// gl_PointCoord goes 0..1 across the point; remap to -1..1.
					vec2 cxy = 2.0 * gl_PointCoord - 1.0;
					float r2 = dot(cxy, cxy);
					if (r2 > 1.0) discard;
					float r = sqrt(r2);

					// Per-particle gentle variation — feel, not direction.
					float s1 = fract(vSeed * 17.31);
					float s2 = fract(vSeed * 53.97);

					// Flat-top body: solid across the disc the user actually asked for,
					// soft roll-off only at the very edge. Preserves the user's radius
					// while removing the hard antialiased boundary.
					float body = 1.0 - smoothstep(0.7, 1.0, r);

					// Tactile inner glow — subtle brighter core, like lit-from-within.
					float core = 1.0 - smoothstep(0.0, 0.75, r);

					// Color: source tint at full strength on the body, with a brighter
					// inner lift at the core. Varied per-particle so no two read identically.
					vec3 inner = vColor + vec3(mix(0.10, 0.20, s1));
					vec3 finalColor = mix(vColor, inner, core * 0.85);

					// Translucent but bright — soap-film feel without dimming the hue.
					float alpha = body * mix(0.82, 0.95, s2) + core * 0.15;
					if (alpha < 0.005) discard;
					gl_FragColor = vec4(finalColor, alpha);
				}
			`,
			transparent: true,
			depthTest: false,
			depthWrite: false,
			blending: THREE.NormalBlending,
		});

		this.particlesMesh = new THREE.Points(geo, material);
		this.particlesMesh.renderOrder = 1;
		this.scene.add(this.particlesMesh);
	}

	_initConnections() {
		const geo = new THREE.BufferGeometry();

		const positions = new Float32Array(MAX_CONNECTIONS * 2 * 3);
		const alphas = new Float32Array(MAX_CONNECTIONS * 2);
		const endpointColors = new Float32Array(MAX_CONNECTIONS * 2 * 3);

		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
		geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
		geo.setAttribute('endpointColor', new THREE.BufferAttribute(endpointColors, 3).setUsage(THREE.DynamicDrawUsage));
		geo.setDrawRange(0, 0);

		// Connections blend each endpoint's particle color with the base connection tint —
		// reads as "energy between bubbles" rather than a flat lattice.
		const material = new THREE.ShaderMaterial({
			uniforms: {
				connectionColor: { value: new THREE.Vector3(0.392, 1.0, 0.855) },
				tintAmount: { value: 0.7 },
			},
			vertexShader: `
				attribute float alpha;
				attribute vec3 endpointColor;
				varying float vAlpha;
				varying vec3 vColor;
				uniform vec3 connectionColor;
				uniform float tintAmount;
				void main() {
					vAlpha = alpha;
					vColor = mix(connectionColor, endpointColor, tintAmount);
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: `
				varying float vAlpha;
				varying vec3 vColor;
				void main() {
					gl_FragColor = vec4(vColor, vAlpha);
				}
			`,
			transparent: true,
			depthTest: false,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});

		this.connectionsMesh = new THREE.LineSegments(geo, material);
		this.connectionsMesh.renderOrder = 0;
		this.scene.add(this.connectionsMesh);
	}

	updateParticles(particles, count) {
		const geo = this.particlesMesh.geometry;
		const posArr = geo.getAttribute('position').array;
		const colArr = geo.getAttribute('customColor').array;
		const sizeArr = geo.getAttribute('size').array;
		const seedArr = geo.getAttribute('seed').array;

		for (let i = 0; i < count; i++) {
			const p = particles[i];
			const i3 = i * 3;
			posArr[i3] = p.x;
			posArr[i3 + 1] = p.y;
			posArr[i3 + 2] = 0;

			const ci = COLOR_INDEX.get(p.color);
			if (ci !== undefined) {
				const rgb = COLOR_RGB[ci];
				colArr[i3] = rgb[0];
				colArr[i3 + 1] = rgb[1];
				colArr[i3 + 2] = rgb[2];
			} else {
				colArr[i3] = parseInt(p.color.slice(1, 3), 16) / 255;
				colArr[i3 + 1] = parseInt(p.color.slice(3, 5), 16) / 255;
				colArr[i3 + 2] = parseInt(p.color.slice(5, 7), 16) / 255;
			}

			sizeArr[i] = p.radius;
			seedArr[i] = p.seed;
		}

		geo.getAttribute('position').needsUpdate = true;
		geo.getAttribute('customColor').needsUpdate = true;
		geo.getAttribute('size').needsUpdate = true;
		geo.getAttribute('seed').needsUpdate = true;
		geo.setDrawRange(0, count);
	}

	// Upload pre-built connection buffer (built during physics pass to avoid double iteration).
	// connColor: per-endpoint RGB (Float32Array, length vertCount*3) — each line endpoint
	// carries its source particle's color so connections gradient between bubbles.
	uploadConnections(connPos, connAlpha, connColor, vertCount, settings) {
		const geo = this.connectionsMesh.geometry;

		if (vertCount === 0) {
			geo.setDrawRange(0, 0);
			return;
		}

		const cc = settings.CONNECTION_COLOR;
		this.connectionsMesh.material.uniforms.connectionColor.value.set(
			parseInt(cc.slice(1, 3), 16) / 255,
			parseInt(cc.slice(3, 5), 16) / 255,
			parseInt(cc.slice(5, 7), 16) / 255,
		);

		const posArr = geo.getAttribute('position').array;
		const alphaArr = geo.getAttribute('alpha').array;
		const colArr = geo.getAttribute('endpointColor').array;

		posArr.set(connPos.subarray(0, vertCount * 3));
		alphaArr.set(connAlpha.subarray(0, vertCount));
		colArr.set(connColor.subarray(0, vertCount * 3));

		geo.getAttribute('position').needsUpdate = true;
		geo.getAttribute('alpha').needsUpdate = true;
		geo.getAttribute('endpointColor').needsUpdate = true;
		geo.setDrawRange(0, vertCount);
	}

	render() {
		this.renderer.render(this.scene, this.camera);
	}

	resize(width, height) {
		this.width = width;
		this.height = height;
		this.renderer.setSize(width, height);
		this.camera.right = width;
		this.camera.bottom = height;
		this.camera.updateProjectionMatrix();
	}

	dispose() {
		this.particlesMesh.geometry.dispose();
		this.particlesMesh.material.dispose();
		this.connectionsMesh.geometry.dispose();
		this.connectionsMesh.material.dispose();
		this.renderer.dispose();
		if (this.domElement.parentElement) {
			this.domElement.parentElement.removeChild(this.domElement);
		}
	}
}
