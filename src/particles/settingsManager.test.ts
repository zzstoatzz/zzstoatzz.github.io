import { expect, test } from 'bun:test';
import { carriesSettings, settingsFromQuery } from './settingsManager';

test('a shared link carries settings', () => {
    expect(carriesSettings('?COLOR_MODE=species&DRAG=0.15')).toBe(true);
    expect(carriesSettings('?PARTICLE_COUNT=3000')).toBe(true);
});

test('a plain visit, or one with only other params, does not', () => {
    expect(carriesSettings('')).toBe(false);
    expect(carriesSettings('?utm_source=bsky&gpu=0')).toBe(false);
});

test('a preset link carries a look too', () => {
    expect(carriesSettings('?preset=at%3A%2F%2Fdid%3Aplc%3Aabc%2Fio.zzstoatzz.physics.preset%2F3m2abc')).toBe(true);
});

test('a query string reads into known settings, clamped, dropping the rest', () => {
    expect(settingsFromQuery('PARTICLE_COUNT=6650&DRAG=0.17&COLOR_MODE=species&NOPE=1')).toEqual({
        PARTICLE_COUNT: 6650,
        DRAG: 0.17,
        COLOR_MODE: 'species',
    });
    expect(settingsFromQuery('PARTICLE_COUNT=999999&COLOR_MODE=plaid&DRAG=x')).toEqual({ PARTICLE_COUNT: 15000 });
});
