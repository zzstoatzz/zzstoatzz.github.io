import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from './config';
import { HEIGHT, WIDTH, png, renderFrame, seeded } from './preview';
import { WasmPhysics } from './wasmPhysics';

const { w: physics } = await WasmPhysics.fromBytes(readFileSync(new URL('./physics.wasm', import.meta.url)));
const look = { ...DEFAULT_SETTINGS, PARTICLE_COUNT: 400 };

function frame(seed: number) {
    physics.seed(seed);
    return renderFrame(physics, look, seeded(seed));
}

test('a look and a seed render the same frame every time', () => {
    expect(frame(7)).toEqual(frame(7));
    expect(frame(8)).not.toEqual(frame(7));
});

test('a frame encodes as a png of the card size', async () => {
    const bytes = await png(frame(7));
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = new DataView(bytes.buffer, bytes.byteOffset + 16, 8);
    expect([ihdr.getUint32(0), ihdr.getUint32(4)]).toEqual([WIDTH, HEIGHT]);
});
