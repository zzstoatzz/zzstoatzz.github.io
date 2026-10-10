// shared by every compute kernel. gpu.zig fills `U` each frame (its extern
// struct `Uniforms` has the same layout) and prepends this file to each kernel.

// a particle as it moves: the canonical buffer, in no particular order
struct D { pos: vec2f, vel: vec2f, id: u32, pad: u32 };
// what never moves, indexed by id: rewritten from the js store when sizes or
// colors change
struct S { radius: f32, mass: f32, color: u32, pad: u32 };
// a particle sorted into its grid cell, with its static fields copied in
struct P { pos: vec2f, vel: vec2f, mass: f32, radius: f32, color: u32, id: u32 };
// a connection line between two sorted particles
struct L { a: u32, b: u32, al: f32 };
// an obstacle: c = (x, y, r, sides; 0 = circle), then up to 4 edge planes
struct Shape { c: vec4f, n01: vec4f, n23: vec4f, off: vec4f };

struct U {
  n: u32, cols: u32, rows: u32, ncells: u32,
  cs: f32, inv_cs: f32, r: f32, r2: f32,
  fs: f32, min_dist: f32, opacity: f32, drag: f32,
  elasticity: f32, gravity: f32, w: f32, h: f32,
  dt: f32, wall_strength: f32, frame: u32, line_cap: u32,
  m_active: u32, m_vortex: u32, m_down: u32, m_spinning: u32,
  mx: f32, my: f32, m_radius: f32, m_force: f32,
  m_vint: f32, m_speed: f32, build_lines: u32, has_attr: u32,
  line_keep: u32, nshapes: u32, aux: u32, pad: u32,
};
@group(0) @binding(0) var<uniform> u: U;

fn cell_xy(p: vec2f) -> vec2i {
  let c = vec2i(floor(p * u.inv_cs));
  return clamp(c, vec2i(0), vec2i(i32(u.cols) - 1, i32(u.rows) - 1));
}
fn cell_of(p: vec2f) -> u32 {
  let c = cell_xy(p);
  return u32(c.y) * u.cols + u32(c.x);
}
fn hash(x: u32) -> u32 {
  var v = x * 747796405u + 2891336453u;
  v = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  return (v >> 22u) ^ v;
}
// uniform in [0, 1), advancing the seed
fn rnd(s: ptr<function, u32>) -> f32 {
  *s = hash(*s);
  return f32(*s >> 8u) / 16777216.0;
}
