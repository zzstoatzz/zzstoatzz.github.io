import { expect, test } from 'bun:test';
import { presetLook, settingsLook } from './look';

test('a preset links by its repo and record key', () => {
    expect(presetLook('at://did:plc:xbtmt2zjwlrfegqvch7fboei/io.zzstoatzz.physics.preset/3m2abc'))
        .toBe('https://look.zzstoatzz.io/did:plc:xbtmt2zjwlrfegqvch7fboei/3m2abc');
});

test('settings link as their query string', () => {
    expect(settingsLook('DRAG=0.17&COLOR_MODE=species')).toBe('https://look.zzstoatzz.io/?DRAG=0.17&COLOR_MODE=species');
});
