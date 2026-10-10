// 3. copy each particle to its cell's run, bringing along its static fields
@group(0) @binding(1) var<storage, read> src: array<D>;
@group(0) @binding(2) var<storage, read> starts: array<u32>;
@group(0) @binding(3) var<storage, read> slot: array<u32>;
@group(0) @binding(4) var<storage, read> stat: array<S>;
@group(0) @binding(5) var<storage, read_write> dst: array<P>;

@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= u.n) { return; }
  let d = src[i];
  let s = stat[d.id];
  dst[starts[cell_of(d.pos)] + slot[i]] = P(d.pos, d.vel, s.mass, s.radius, s.color, d.id);
}
