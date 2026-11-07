// The site's link preview, dist/og.png: species mode settled into creatures
// (src/particles/preview.ts draws it). The species table and the crowd were
// picked by eye; wasm floats are deterministic, so every build renders the
// same frame.
//
//   bun scripts/og.ts [out.png]
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_SETTINGS } from "../src/particles/config";
import { png, renderFrame, seeded } from "../src/particles/preview";
import { WasmPhysics } from "../src/particles/wasmPhysics";

// the species table and the crowd (spawn order)
const TABLE = 8;
const CROWD = 3;

const out = process.argv[2] ?? "dist/og.png";
const { w: physics } = await WasmPhysics.fromBytes(
	readFileSync(new URL("../src/particles/physics.wasm", import.meta.url)),
);
physics.seed(CROWD);
const random = seeded(CROWD);
// the frame was picked while WasmPhysics drew its own seed from this stream
// first; skipping that draw keeps the same crowd
random();

const frame = renderFrame(
	physics,
	{
		...DEFAULT_SETTINGS,
		// a phone's worth of a dense look, 1800 particles in the card
		PARTICLE_COUNT: 6525,
		AVERAGE_PARTICLE_SIZE: 1.1,
		DRAG: 0.17,
		COLOR_MODE: "species",
		SPECIES_SEED: TABLE,
	},
	random,
);
writeFileSync(out, await png(frame));
console.log(`og: ${out}`);
