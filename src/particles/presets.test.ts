import { expect, test } from 'bun:test';
import { COLLECTION, SaveError, normalize, parsePreset } from './presets';

const uri = `at://did:plc:xbtmt2zjwlrfegqvch7fboei/${COLLECTION}/3m2abc`;

test('a handle is normalized; a DID keeps its case', () => {
    expect(normalize('  @Zzstoatzz.IO ')).toBe('zzstoatzz.io');
    expect(normalize('at://zzstoatzz.io')).toBe('zzstoatzz.io');
    expect(normalize('did:plc:xbtmt2zjwlrfegqvch7fboei')).toBe('did:plc:xbtmt2zjwlrfegqvch7fboei');
});

test('something that is not an account is refused before any redirect', () => {
    expect(() => normalize('not a handle')).toThrow(SaveError);
    expect(() => normalize('')).toThrow(SaveError);
});

test('a preset record gives its settings and name', () => {
    const preset = parsePreset(uri, { $type: COLLECTION, settings: 'DRAG=0.17', name: 'goo', createdAt: '2026-10-23T00:00:00Z' });
    expect(preset).toEqual({ uri, settings: 'DRAG=0.17', name: 'goo' });
    expect(parsePreset(uri, { $type: COLLECTION, settings: '' }).name).toBeNull();
});

test('a record that is not a preset is refused', () => {
    expect(() => parsePreset(uri, { $type: 'app.bsky.feed.post', settings: 'DRAG=0.17' })).toThrow();
    expect(() => parsePreset(uri, { $type: COLLECTION, settings: 5 })).toThrow();
    expect(() => parsePreset(uri, { $type: COLLECTION, settings: 'x'.repeat(10001) })).toThrow();
    expect(() => parsePreset(uri, null)).toThrow();
});
