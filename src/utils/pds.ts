import { getPdsEndpoint } from '@atcute/identity';
import {
    CompositeDidDocumentResolver,
    PlcDidDocumentResolver,
    WebDidDocumentResolver,
} from '@atcute/identity-resolver';
import type { Did } from '@atcute/lexicons';

type AtprotoDid = Did<'plc' | 'web'>;

export function pdsLookup(fetchThis: typeof fetch = fetch) {
    const documents = new CompositeDidDocumentResolver({
        methods: {
            plc: new PlcDidDocumentResolver({ fetch: fetchThis }),
            web: new WebDidDocumentResolver({ fetch: fetchThis }),
        },
    });
    const known = new Map<AtprotoDid, Promise<string>>();
    return (did: AtprotoDid): Promise<string> => {
        const cached = known.get(did);
        if (cached) return cached;
        const pds = documents.resolve(did).then((doc) => {
            const endpoint = getPdsEndpoint(doc);
            if (!endpoint) throw new Error(`${did} lists no atproto PDS`);
            return endpoint;
        });
        known.set(did, pds);
        pds.catch(() => known.delete(did));
        return pds;
    };
}

export const pdsOf = pdsLookup();

export async function latestRecords(did: AtprotoDid, collection: string, signal: AbortSignal) {
    const url = new URL('/xrpc/com.atproto.repo.listRecords', await pdsOf(did));
    url.search = new URLSearchParams({ repo: did, collection, limit: '1' }).toString();
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}
