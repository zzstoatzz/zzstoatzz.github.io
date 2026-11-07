// The two Cloudflare runtime pieces index.ts uses, typed here so the site's
// own `astro check` covers the worker.
declare module "*.wasm" {
	const module: WebAssembly.Module;
	export default module;
}

interface CacheStorage {
	readonly default: Cache;
}

interface ExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
}
