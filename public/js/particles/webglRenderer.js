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

		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
		geo.setAttribute('customColor', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
		geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
		geo.setDrawRange(0, 0);

		const material = new THREE.ShaderMaterial({
			uniforms: {
				pixelRatio: { value: this.renderer.getPixelRatio() },
			},
			vertexShader: `
				attribute vec3 customColor;
				attribute float size;
				varying vec3 vColor;
				uniform float pixelRatio;
				void main() {
					vColor = customColor;
					gl_PointSize = size * 2.0 * pixelRatio;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: `
				varying vec3 vColor;
				void main() {
					vec2 cxy = 2.0 * gl_PointCoord - 1.0;
					float r = dot(cxy, cxy);
					float delta = fwidth(r);
					float alpha = 1.0 - smoothstep(1.0 - delta, 1.0 + delta, r);
					if (alpha < 0.01) discard;
					gl_FragColor = vec4(vColor, alpha);
				}
			`,
			transparent: true,
			depthTest: false,
			depthWrite: false,
		});

		this.particlesMesh = new THREE.Points(geo, material);
		this.particlesMesh.renderOrder = 1;
		this.scene.add(this.particlesMesh);
	}

	_initConnections() {
		const geo = new THREE.BufferGeometry();

		const positions = new Float32Array(MAX_CONNECTIONS * 2 * 3);
		const alphas = new Float32Array(MAX_CONNECTIONS * 2);

		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
		geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
		geo.setDrawRange(0, 0);

		const material = new THREE.ShaderMaterial({
			uniforms: {
				connectionColor: { value: new THREE.Vector3(0.392, 1.0, 0.855) },
			},
			vertexShader: `
				attribute float alpha;
				varying float vAlpha;
				void main() {
					vAlpha = alpha;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: `
				uniform vec3 connectionColor;
				varying float vAlpha;
				void main() {
					gl_FragColor = vec4(connectionColor, vAlpha);
				}
			`,
			transparent: true,
			depthTest: false,
			depthWrite: false,
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
		}

		geo.getAttribute('position').needsUpdate = true;
		geo.getAttribute('customColor').needsUpdate = true;
		geo.getAttribute('size').needsUpdate = true;
		geo.setDrawRange(0, count);
	}

	// Upload pre-built connection buffer (built during physics pass to avoid double iteration)
	uploadConnections(connPos, connAlpha, vertCount, settings) {
		const geo = this.connectionsMesh.geometry;

		if (vertCount === 0) {
			geo.setDrawRange(0, 0);
			return;
		}

		// Update connection color uniform
		const cc = settings.CONNECTION_COLOR;
		this.connectionsMesh.material.uniforms.connectionColor.value.set(
			parseInt(cc.slice(1, 3), 16) / 255,
			parseInt(cc.slice(3, 5), 16) / 255,
			parseInt(cc.slice(5, 7), 16) / 255,
		);

		const posArr = geo.getAttribute('position').array;
		const alphaArr = geo.getAttribute('alpha').array;

		// Copy from pre-built buffers
		posArr.set(connPos.subarray(0, vertCount * 3));
		alphaArr.set(connAlpha.subarray(0, vertCount));

		geo.getAttribute('position').needsUpdate = true;
		geo.getAttribute('alpha').needsUpdate = true;
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
