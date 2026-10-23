import { expect, test } from 'bun:test';
import { carriesSettings } from './settingsManager';

test('a shared link carries settings', () => {
    expect(carriesSettings('?COLOR_MODE=species&DRAG=0.15')).toBe(true);
    expect(carriesSettings('?PARTICLE_COUNT=3000')).toBe(true);
});

test('a plain visit, or one with only other params, does not', () => {
    expect(carriesSettings('')).toBe(false);
    expect(carriesSettings('?utm_source=bsky&gpu=0')).toBe(false);
});
