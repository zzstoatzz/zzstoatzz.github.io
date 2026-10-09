import { expect, test } from 'bun:test';
import { playHref, plyrEmbedUrl } from './teal';

// shape of a real fm.teal.feed.play record written by plyr.fm
const play = {
    $type: 'fm.teal.feed.play',
    trackName: 'smėėrr',
    artists: [{ artistName: 'gggiiirrrlllsss' }],
    originUri: 'https://plyr.fm/track/1227',
    musicServiceUri: 'https://plyr.fm',
};

test('a play links to its originUri', () => {
    expect(playHref(play)).toBe('https://plyr.fm/track/1227');
});

test('a play without a web origin has no link', () => {
    expect(playHref({ trackName: 'x' })).toBeUndefined();
    expect(playHref({ trackName: 'x', originUri: '' })).toBeUndefined();
    expect(playHref({ trackName: 'x', originUri: 'javascript:alert(1)' })).toBeUndefined();
});

test('a plyr.fm play has an embed url, other origins do not', () => {
    expect(plyrEmbedUrl(play)).toBe('https://plyr.fm/embed/track/1227');
    expect(plyrEmbedUrl({ trackName: 'x', originUri: 'https://open.spotify.com/track/1' })).toBeUndefined();
    expect(plyrEmbedUrl({ trackName: 'x' })).toBeUndefined();
});
