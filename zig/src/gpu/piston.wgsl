// a shrinking canvas edge is a piston: particles it swept past go back inside,
// moving inward as fast as an edge that crossed them over 12 frames
// (particleSystem.ts pistonWalls)
@group(0) @binding(1) var<storage, read_write> parts: array<D>;
@group(0) @binding(2) var<storage, read> stat: array<S>;

@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= u.n) { return; }
  var d = parts[i];
  let r = stat[d.id].radius;
  let over = d.pos + vec2f(r) - vec2f(u.w, u.h);
  if (over.x > 0.0) {
    d.pos.x = u.w - r - 0.1;
    d.vel.x = min(d.vel.x, 0.0) - over.x / 12.0;
  }
  if (over.y > 0.0) {
    d.pos.y = u.h - r - 0.1;
    d.vel.y = min(d.vel.y, 0.0) - over.y / 12.0;
  }
  parts[i] = d;
}
