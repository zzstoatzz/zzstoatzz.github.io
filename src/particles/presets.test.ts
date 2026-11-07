import { expect, test } from 'bun:test';
import metadata from '../../public/oauth-client-metadata.json';
import { COLLECTION, presetFields } from './presetRecord';
import { CLIENT_ID, REDIRECT_URI, SCOPE, SaveError, failureMessage, normalize } from './presets';

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
    const record = { $type: COLLECTION, settings: 'DRAG=0.17', name: 'goo', createdAt: '2026-10-23T00:00:00Z' };
    expect(presetFields(uri, record)).toEqual({ settings: 'DRAG=0.17', name: 'goo' });
    expect(presetFields(uri, { $type: COLLECTION, settings: '' }).name).toBeNull();
});

test('a record that is not a preset is refused', () => {
    expect(() => presetFields(uri, { $type: 'app.bsky.feed.post', settings: 'DRAG=0.17' })).toThrow();
    expect(() => presetFields(uri, { $type: COLLECTION, settings: 5 })).toThrow();
    expect(() => presetFields(uri, { $type: COLLECTION, settings: 'x'.repeat(10001) })).toThrow();
    expect(() => presetFields(uri, null)).toThrow();
});

test('a failed save reads as one sentence, whatever failed', () => {
    expect(failureMessage(new SaveError('cancelled'))).toBe('sign-in was cancelled.');
    expect(failureMessage(new TypeError('fetch failed'))).toBe("couldn't save to your pds.");
});

// the authorization server refuses any requested token the hosted metadata
// doesn't list, exactly; drift breaks every sign-in and nothing else notices
test('every token a save asks for is in the hosted client metadata', () => {
    const listed = metadata.scope.split(' ');
    for (const token of SCOPE.split(' ')) expect(listed).toContain(token);
    expect(metadata.client_id).toBe(CLIENT_ID);
    expect(metadata.redirect_uris).toContain(REDIRECT_URI);
});
