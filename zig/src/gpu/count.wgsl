// 1. each particle bumps its cell's counter; the old count is its slot
@group(0) @binding(1) var<storage, read> src: array<D>;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> slot: array<u32>;

@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= u.n) { return; }
  slot[i] = atomicAdd(&counts[cell_of(src[i].pos)], 1u);
}
