// draws straight from the sorted particle buffer and the line buffer the
// step wrote. it blends exactly like the three.js renderer (non-premultiplied
// color + alpha in an offscreen target) and a last pass premultiplies for the
// transparent canvas (blit.wgsl), so the page composites the same.
struct P { pos: vec2f, vel: vec2f, mass: f32, radius: f32, color: u32, id: u32 };
struct L { a: u32, b: u32, al: f32 };
// size in css px, then the connection color; palette has a slot per color
struct R { size: vec4f, conn: vec4f, palette: array<vec4f, 16> };
@group(0) @binding(0) var<uniform> ru: R;
@group(0) @binding(1) var<storage, read> parts: array<P>;
@group(0) @binding(2) var<storage, read> lines: array<L>;

fn clip(p: vec2f) -> vec4f {
  return vec4f(p.x / ru.size.x * 2.0 - 1.0, 1.0 - p.y / ru.size.y * 2.0, 0.0, 1.0);
}

struct DiscOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec3f };
@vertex fn vs_disc(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DiscOut {
  var corner = array<vec2f, 4>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(1, 1));
  let p = parts[ii];
  var o: DiscOut;
  o.uv = corner[vi];
  o.pos = clip(p.pos + corner[vi] * p.radius);
  o.col = ru.palette[min(p.color, 15u)].rgb;
  return o;
}
// the webgl bubble shader: solid disc, hairline antialiased edge, gentle lift
@fragment fn fs_disc(i: DiscOut) -> @location(0) vec4f {
  let r = length(i.uv);
  if (r > 1.0) { discard; }
  let a = 1.0 - smoothstep(0.92, 1.0, r);
  let core = 1.0 - smoothstep(0.0, 0.9, r);
  return vec4f(i.col + vec3f(core * 0.08), a);
}

struct LineOut { @builtin(position) pos: vec4f, @location(0) col: vec4f };
@vertex fn vs_line(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LineOut {
  let l = lines[ii];
  let p = parts[select(l.a, l.b, vi == 1u)];
  var o: LineOut;
  o.pos = clip(p.pos);
  o.col = vec4f(mix(ru.conn.rgb, ru.palette[min(p.color, 15u)].rgb, 0.7), l.al);
  return o;
}
@fragment fn fs_line(i: LineOut) -> @location(0) vec4f { return i.col; }
