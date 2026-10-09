## [zzstoatzz.io](https://zzstoatzz.io/)

my website: a static next.js site with an interactive particle background whose physics runs in zig, compiled to webassembly. installable as a PWA.

```sh
bun install && bun run dev    # site at localhost:3000
cd zig && zig build test      # physics tests (zig 0.16)
cd zig && zig build wasm      # rebuild public/js/particles/*.wasm
```

pushes to `main` deploy to github pages. see [AGENTS.md](AGENTS.md) for how it fits together.
