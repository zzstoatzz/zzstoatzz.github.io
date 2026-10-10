// fewer particles: keep ids below u.aux, each at index id (ids are 0..n-1,
// so this is a permutation and the survivors land in 0..aux-1)
@group(0) @binding(1) var<storage, read> src: array<D>;
@group(0) @binding(2) var<storage, read_write> dst: array<D>;

@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= u.n) { return; }
  let d = src[i];
  if (d.id < u.aux) { dst[d.id] = d; }
}
