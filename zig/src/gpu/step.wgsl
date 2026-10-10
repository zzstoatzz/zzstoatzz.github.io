// 4. one particle per thread, in sorted order: gather pair forces from the
// 3x3 cells around it (each particle writes only itself, so no float atomics),
// then walls, mouse, the update and shape bounces, and write it back. lines
// go to an append buffer whose counter is also the indirect draw's count.
@group(0) @binding(1) var<storage, read> sorted: array<P>;
@group(0) @binding(2) var<storage, read> starts: array<u32>;
@group(0) @binding(3) var<storage, read_write> out: array<D>;
@group(0) @binding(4) var<storage, read_write> lines: array<L>;
@group(0) @binding(5) var<storage, read_write> args: array<atomic<u32>>;
// [max speed (f32 bits), sum of speed * 256, lines wanted, 0], read back by
// js for the rest check and the line budget
@group(0) @binding(6) var<storage, read_write> st: array<atomic<u32>>;
@group(0) @binding(7) var<storage, read> shapes: array<Shape>;

// soft wall: the crowd's average density over the part of the disc past it
fn wall(d: f32) -> f32 {
  let dd = max(d, u.min_dist);
  if (dd >= u.r) { return 0.0; }
  let q = sqrt(u.r * u.r - dd * dd);
  return u.wall_strength * (2.0 * log((u.r + q) / dd) - 2.0 * q / u.r);
}

fn edge(sh: Shape, k: u32) -> vec3f {
  switch k {
    case 0u: { return vec3f(sh.n01.xy, sh.off.x); }
    case 1u: { return vec3f(sh.n01.zw, sh.off.y); }
    case 2u: { return vec3f(sh.n23.xy, sh.off.z); }
    default: { return vec3f(sh.n23.zw, sh.off.w); }
  }
}

fn inside(sh: Shape, p: vec2f, pad: f32) -> bool {
  let d = p - sh.c.xy;
  if (dot(d, d) > (sh.c.z + pad) * (sh.c.z + pad)) { return false; }
  let sides = u32(sh.c.w);
  for (var k = 0u; k < sides; k++) {
    let e = edge(sh, k);
    if (dot(e.xy, p) - e.z >= pad) { return false; }
  }
  return true;
}

@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= u.n) { return; }
  let me = sorted[i];
  let p = me.pos;
  var dv = vec2f(0.0);
  let c = cell_xy(p);
  let attr = u.has_attr != 0u;
  let lines_on = u.build_lines != 0u;
  var wanted = 0u;
  for (var oy = -1; oy <= 1; oy++) {
    let cy = c.y + oy;
    if (cy < 0 || cy >= i32(u.rows)) { continue; }
    // a row's three cells are one contiguous run of sorted particles
    let row = u32(cy) * u.cols;
    let lo = starts[row + u32(max(c.x - 1, 0))];
    let hi = starts[row + u32(min(c.x + 1, i32(u.cols) - 1)) + 1u];
    for (var j = lo; j < hi; j++) {
      if (j == i) { continue; }
      let o = sorted[j];
      let d = o.pos - p;
      let d2 = dot(d, d);
      if (d2 >= u.r2 || d2 < 1e-6) { continue; }
      let dist = sqrt(d2);
      if (attr) {
        // physics.zig: fx = fs*ma*mb/sd^2 * dx/dist, then va += fx/ma
        let sd = max(dist, u.min_dist);
        dv += (u.fs * o.mass / (sd * sd * dist)) * d;
      }
      if (lines_on && j > i) {
        let al = u.opacity * (1.0 - dist / u.r);
        if (al > 0.001) {
          wanted++;
          // over budget, keep a subset that's stable per pair (no flicker)
          // and spread evenly (no band where the first threads ran)
          let ia = min(me.id, o.id);
          let ib = max(me.id, o.id);
          if (hash((ia * 2654435761u) ^ hash(ib)) <= u.line_keep) {
            let k = atomicAdd(&args[1], 1u);
            if (k < u.line_cap) { lines[k] = L(i, j, al); }
          }
        }
      }
    }
  }

  if (attr && u.fs < 0.0) {
    if (p.x < u.r) { dv.x -= wall(p.x); }
    if (u.w - p.x < u.r) { dv.x += wall(u.w - p.x); }
    if (p.y < u.r) { dv.y -= wall(p.y); }
    if (u.h - p.y < u.r) { dv.y += wall(u.h - p.y); }
  }

  if (u.m_active != 0u) {
    let d = p - vec2f(u.mx, u.my);
    let d2 = dot(d, d);
    if (d2 < u.m_radius * u.m_radius && d2 > 1e-6) {
      let dist = sqrt(d2);
      let strength = u.m_force * (1.0 - dist / u.m_radius) * (u.dt * 60.0);
      let dir = d / dist;
      if (u.m_vortex == 0u) {
        dv += dir * strength;
      } else {
        dv += dir * strength * select(1.0, 0.3, u.m_down != 0u);
        if (u.m_spinning != 0u) {
          dv += vec2f(-dir.y, dir.x) * (strength * u.m_vint * 0.8 * u.m_speed);
        }
      }
    }
  }

  // Particle.update
  var v = me.vel + dv;
  let dt_adj = u.dt * 60.0;
  v.y += u.gravity * u.dt;
  if (length(v) > 1e-6) { v *= max(0.0, 1.0 - u.drag * dt_adj); }
  var q = p + v * dt_adj;
  let r = me.radius;
  let e = u.elasticity;
  var seed = me.id * 9781u + u.frame * 6271u + 1u;
  if (q.x - r < 0.0) {
    q.x = r + 0.1; v.x *= -e; v.y += (rnd(&seed) - 0.5) * 0.1 * abs(v.x);
  } else if (q.x + r > u.w) {
    q.x = u.w - r - 0.1; v.x *= -e; v.y += (rnd(&seed) - 0.5) * 0.1 * abs(v.x);
  }
  if (q.y - r < 0.0) {
    q.y = r + 0.1; v.y *= -e; v.x += (rnd(&seed) - 0.5) * 0.1 * abs(v.y);
  } else if (q.y + r > u.h) {
    q.y = u.h - r - 0.1; v.y *= -e; v.x += (rnd(&seed) - 0.5) * 0.1 * abs(v.y);
  }

  // ShapeField.collide
  for (var s = 0u; s < u.nshapes; s++) {
    let sh = shapes[s];
    if (!inside(sh, q, r)) { continue; }
    var n = vec2f(1.0, 0.0);
    var depth = 0.0;
    let sides = u32(sh.c.w);
    if (sides == 0u) {
      let d = q - sh.c.xy;
      let dist = length(d);
      depth = sh.c.z + r;
      if (dist >= 1e-6) { n = d / dist; depth -= dist; }
    } else {
      var best = -1e30;
      for (var k = 0u; k < sides; k++) {
        let ed = edge(sh, k);
        let dd = dot(ed.xy, q) - ed.z;
        if (dd > best) { best = dd; n = ed.xy; }
      }
      depth = r - best;
    }
    if (depth <= 0.0) { continue; }
    q += n * (depth + 0.1);
    let vn = dot(v, n);
    if (vn < 0.0) {
      v += n * (-(1.0 + e) * vn);
      v += vec2f(-n.y, n.x) * ((rnd(&seed) - 0.5) * 0.1 * abs(vn));
    }
  }

  out[i] = D(q, v, me.id, 0u);
  let sp = length(v);
  atomicMax(&st[0], bitcast<u32>(sp));
  atomicAdd(&st[1], u32(min(sp, 40.0) * 256.0));
  if (wanted > 0u) { atomicAdd(&st[2], wanted); }
}
