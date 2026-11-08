import { expect, test } from 'bun:test';
import { pdsLookup } from './pds';

const PLC = 'did:plc:xbtmt2zjwlrfegqvch7fboei';
const WEB = 'did:web:example.com';

const didDoc = (id: string, service: { id: string; type: string; serviceEndpoint: string }[]) => ({
    '@context': ['https://www.w3.org/ns/did/v1'],
    id,
    alsoKnownAs: ['at://zzstoatzz.io'],
    service,
});

const pdsService = (endpoint: string) => ({
    id: '#atproto_pds',
    type: 'AtprotoPersonalDataServer',
    serviceEndpoint: endpoint,
});

function fakeFetch(docs: Record<string, unknown>) {
    const requested: string[] = [];
    const impl = async (input: RequestInfo | URL) => {
        const url = decodeURIComponent(String(input));
        requested.push(url);
        const doc = docs[url];
        if (doc === undefined) return new Response('not found', { status: 404 });
        return Response.json(doc);
    };
    return { requested, fetch: impl as typeof fetch };
}

test('a did:plc resolves to the PDS its PLC document lists', async () => {
    const fake = fakeFetch({
        [`https://plc.directory/${PLC}`]: didDoc(PLC, [
            { id: '#bsky_fg', type: 'BskyFeedGenerator', serviceEndpoint: 'https://feed.example.com' },
            pdsService('https://zds.example.com'),
        ]),
    });
    expect(await pdsLookup(fake.fetch)(PLC)).toBe('https://zds.example.com');
});

test('a did:web resolves through its .well-known document', async () => {
    const fake = fakeFetch({
        'https://example.com/.well-known/did.json': didDoc(WEB, [pdsService('https://pds.example.com')]),
    });
    expect(await pdsLookup(fake.fetch)(WEB)).toBe('https://pds.example.com');
});

test('the PDS is resolved once per lookup and then reused', async () => {
    const fake = fakeFetch({ [`https://plc.directory/${PLC}`]: didDoc(PLC, [pdsService('https://zds.example.com')]) });
    const pdsOf = pdsLookup(fake.fetch);
    await Promise.all([pdsOf(PLC), pdsOf(PLC)]);
    await pdsOf(PLC);
    expect(fake.requested).toEqual([`https://plc.directory/${PLC}`]);
});

test('a failed resolution is not cached', async () => {
    const docs: Record<string, unknown> = {};
    const fake = fakeFetch(docs);
    const pdsOf = pdsLookup(fake.fetch);
    await expect(pdsOf(PLC)).rejects.toThrow();
    await pdsOf(PLC).catch(() => {});
    docs[`https://plc.directory/${PLC}`] = didDoc(PLC, [pdsService('https://zds.example.com')]);
    expect(await pdsOf(PLC)).toBe('https://zds.example.com');
});

test('a document without an atproto PDS is an error', async () => {
    const fake = fakeFetch({
        [`https://plc.directory/${PLC}`]: didDoc(PLC, [
            { id: '#bsky_fg', type: 'BskyFeedGenerator', serviceEndpoint: 'https://feed.example.com' },
        ]),
    });
    await expect(pdsLookup(fake.fetch)(PLC)).rejects.toThrow('lists no atproto PDS');
});
