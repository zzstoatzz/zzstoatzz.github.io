//! the homepage particle physics: cell grid, pair attraction and the
//! connection-line buffer, soft walls, mouse force, particle update and shape
//! collisions. typescript (src/particles) keeps rendering, ui, mouse visuals and
//! shape geometry, and reads and writes the particle columns directly.
//!
//! this started as a bit-for-bit port of an earlier js implementation; a few
//! js semantics remain (NaN-propagating max in the update), but the pair pass
//! and the grid no longer follow js operation order.
const std = @import("std");
const Allocator = std.mem.Allocator;

const Physics = @This();

pub const Settings = struct {
    interaction_radius: f64 = 60,
    attract: f64 = -100,
    /// already resolved like js: `SMOOTHING_FACTOR || 0.3`
    smoothing_factor: f64 = 0.13,
    connection_opacity: f64 = 0.05,
    /// `GRAVITY || 0`
    gravity: f64 = 0,
    /// `DRAG || 0.01`
    drag: f64 = 0.05,
    elasticity: f64 = 0.8,
    width: f64 = 800,
    height: f64 = 600,
    /// fill the connection-line buffer
    build_connections: bool = true,
};

pub const Mouse = struct {
    /// js: isMouseDown || releaseMultiplier > 1
    active: bool = false,
    x: f64 = 0,
    y: f64 = 0,
    radius: f64 = 0,
    force: f64 = 0,
    vortex: bool = false,
    down: bool = false,
    /// isMouseDown && holdStartTime, i.e. whether the tangential push applies
    spinning: bool = false,
    /// min(1, log(hold+1)/log(10)), computed in js
    vortex_intensity: f64 = 0,
    /// 1 + hold * 0.5
    speed_multiplier: f64 = 1,
};

pub const Shape = struct {
    circle: bool,
    x: f64,
    y: f64,
    r: f64,
    sides: u32 = 0,
    normals: [8]f64 = @splat(0),
    offsets: [4]f64 = @splat(0),
};

pub const max_conn_verts = 200000 * 2;

/// r-cell occupancy from which the grid switches to half-r cells
const SUB_AT = 3.0;

/// most cells the grid may use. its arrays are reserved by `resize`, so a
/// canvas too big for this many r-sized cells gets bigger cells instead,
/// which only adds candidates.
const max_cells_floor = 1 << 16;

/// one particle. the system stores these column-wise in a MultiArrayList,
/// which also owns the state js reads and writes (wasmPhysics.js).
pub const Particle = struct {
    x: f64 = 0,
    y: f64 = 0,
    vx: f64 = 0,
    vy: f64 = 0,
    radius: f64 = 0,
    mass: f64 = 0,
    /// Particle.sizeVariationFactor in [-1, 1]. physics never reads it; js
    /// re-derives radius from it when the size setting changes.
    size_var: f64 = 0,
    /// index into PARTICLE_COLORS (and `palette`)
    color: u8 = 0,
};

particles: std.MultiArrayList(Particle) = .empty,
// column views of `particles`, length n, refreshed by `resize`
n: usize = 0,
x: []f64 = &.{},
y: []f64 = &.{},
vx: []f64 = &.{},
vy: []f64 = &.{},
radius: []f64 = &.{},
mass: []f64 = &.{},
size_var: []f64 = &.{},
color: []u8 = &.{},

/// rgb per palette entry, as js computes them: parseInt(hex)/255
palette: [256][3]f64 = @splat(.{ 0, 0, 0 }),

settings: Settings = .{},
mouse: Mouse = .{},
shapes: std.ArrayList(Shape) = .empty,
rng: std.Random.DefaultPrng = .init(0x5eed),

// cell grid: gw × gh cells of cell_size px, row-major. particles past the
// canvas land in the edge cells, which keeps any pair within r at most one
// cell apart.
cell_size: f64 = 50,
/// cells per interaction radius: pairs are at most this many cells apart
reach: u32 = 1,
gw: u32 = 1,
gh: u32 = 1,
/// cell c holds sorted[cell_start[c]..cell_start[c + 1]]
cell_start: []u32 = &.{},
cell_of: []u32 = &.{},
sorted: []u32 = &.{},
scratch: Scratch = .{},

// connection buffers (same layout the webgl renderer uploads)
conn_pos: []f32 = &.{},
conn_alpha: []f32 = &.{},
conn_color: []f32 = &.{},
conn_verts: u32 = 0,
/// seconds, set at the start of each step
dt: f64 = 0,

pub fn deinit(p: *Physics, a: Allocator) void {
    p.particles.deinit(a);
    a.free(p.conn_pos);
    a.free(p.conn_alpha);
    a.free(p.conn_color);
    p.shapes.deinit(a);
    a.free(p.cell_start);
    a.free(p.cell_of);
    a.free(p.sorted);
    p.scratch.deinit(a);
}

/// resize to n particles, keeping existing ones and zeroing new ones. this is
/// the only call that allocates: it also reserves everything `step` needs for
/// n particles, so `step` never grows memory and column pointers stay valid
/// until the next resize.
pub fn resize(p: *Physics, a: Allocator, n: usize) !void {
    const old = p.particles.len;
    try p.particles.resize(a, n);
    if (n > old) for (old..n) |i| p.particles.set(i, .{});
    const cols = p.particles.slice();
    p.n = n;
    p.x = cols.items(.x);
    p.y = cols.items(.y);
    p.vx = cols.items(.vx);
    p.vy = cols.items(.vy);
    p.radius = cols.items(.radius);
    p.mass = cols.items(.mass);
    p.size_var = cols.items(.size_var);
    p.color = cols.items(.color);

    if (p.cell_start.len < maxCells(n) + 1) {
        a.free(p.cell_start);
        p.cell_start = try a.alloc(u32, maxCells(n) + 1);
    }
    if (p.sorted.len < n) {
        a.free(p.cell_of);
        a.free(p.sorted);
        p.cell_of = try a.alloc(u32, n);
        p.sorted = try a.alloc(u32, n);
    }
    try p.scratch.fit(a, n);
}

fn maxCells(n: usize) usize {
    return @max(max_cells_floor, 2 * n);
}

pub fn ensureConnections(p: *Physics, a: Allocator) !void {
    if (p.conn_alpha.len == max_conn_verts) return;
    p.conn_pos = try a.alloc(f32, max_conn_verts * 3);
    p.conn_alpha = try a.alloc(f32, max_conn_verts);
    p.conn_color = try a.alloc(f32, max_conn_verts * 3);
}

/// js Math.max(0, v): NaN-propagating
inline fn jsMax0(v: f64) f64 {
    if (std.math.isNan(v)) return v;
    return if (v > 0) v else 0;
}

/// cell index along one axis, clamped to [0, cells); NaN lands in cell 0
inline fn cellAt(v: f64, inv: f64, cells: u32) u32 {
    const c = @min(@max(v * inv, 0), @as(f64, @floatFromInt(cells - 1)));
    return @intFromFloat(c);
}

/// bucket every particle into its grid cell (a counting sort)
fn updateGrid(p: *Physics) void {
    const s = p.settings;
    const r = if (s.interaction_radius > 0) s.interaction_radius else 50;
    const w = if (s.width >= 1) s.width else 1;
    const h = if (s.height >= 1) s.height else 1;
    // cells at least r wide, and no more of them than were reserved
    const cap: f64 = @floatFromInt(p.cell_start.len - 1);
    // a crowded grid gets half-r cells: the candidates then cover 6.25 r²
    // per particle instead of 9 r², at the cost of more, shorter runs
    const per_cell = @as(f64, @floatFromInt(p.n)) * r * r / (w * h);
    const want: f64 = if (per_cell >= SUB_AT) r / 2 else r;
    p.cell_size = @max(want, @sqrt(w * h / cap) * 1.01);
    p.reach = @intFromFloat(@ceil(r / p.cell_size - 1e-9));
    p.gw = @intFromFloat(@max(1, @min(@ceil(w / p.cell_size), cap)));
    p.gh = @intFromFloat(@max(1, @min(@ceil(h / p.cell_size), @floor(cap / @as(f64, @floatFromInt(p.gw))))));
    const inv = 1 / p.cell_size;
    const nc = p.gw * p.gh;
    const start = p.cell_start[0 .. nc + 1];
    @memset(start, 0);
    for (0..p.n) |i| {
        const c = cellAt(p.y[i], inv, p.gh) * p.gw + cellAt(p.x[i], inv, p.gw);
        p.cell_of[i] = c;
        start[c + 1] += 1;
    }
    for (1..nc + 1) |c| start[c] += start[c - 1];
    // place back to front, so each cell keeps particle-index order. each
    // placement walks a cell's end back by one, so afterwards start[c + 1]
    // holds where cell c begins
    var i = p.n;
    while (i > 0) {
        i -= 1;
        const c = p.cell_of[i];
        start[c + 1] -= 1;
        p.sorted[start[c + 1]] = @intCast(i);
    }
    std.mem.copyForwards(u32, start[0..nc], start[1 .. nc + 1]);
    start[nc] = @intCast(p.n);
}

const PairCtx = struct {
    has_attraction: bool,
    has_connections: bool,
    r2: K,
    inv_r: K,
    force_scale: K,
    min_dist: K,
    opacity: K,
};

/// the pair pass runs in f32: positions only need to resolve a fraction of a
/// pixel there, and f32 fits twice the lanes per simd register. the particle
/// columns stay f64; the pass gathers f32 copies and adds the f32 velocity
/// changes back at the end.
const K = f32;
const lanes = 4;
const V = @Vector(lanes, K);
const Mask = @Int(.unsigned, lanes);

/// every pair (a, b) for b in [lo, hi) of the cell-sorted scratch arrays,
/// `lanes` candidates at a time. b's velocity changes are written straight
/// back as vectors; a's are summed in registers and written once at the end.
///
/// with s = max(d, min_dist), the kick on a is
///   Δva = force_scale · ma·mb / s² · d̂ / ma = force_scale · mb · dx / (s²·d)
/// so a's own mass cancels and the whole pair needs one division.
///
/// the last chunk runs past hi (the scratch arrays are padded); lanes past
/// hi are masked out, so they add exactly zero to whatever they read.
inline fn sweep(p: *Physics, ctx: *const PairCtx, a: u32, lo: u32, hi: u32) void {
    const g = &p.scratch;
    const ax: V = @splat(g.x[a]);
    const ay: V = @splat(g.y[a]);
    const ma: V = @splat(g.mass[a]);
    const r2: V = @splat(ctx.r2);
    const eps: V = @splat(1e-6);
    const min_dist: V = @splat(ctx.min_dist);
    const force_scale: V = @splat(ctx.force_scale);
    const opacity: V = @splat(ctx.opacity);
    const inv_r: V = @splat(ctx.inv_r);
    const one: V = @splat(1);
    const zero: V = @splat(0);
    const lane_idx: @Vector(lanes, u32) = std.simd.iota(u32, lanes);
    var acc_x: V = zero;
    var acc_y: V = zero;
    var b = lo;
    while (b < hi) : (b += lanes) {
        const bx: V = g.x[b..][0..lanes].*;
        const by: V = g.y[b..][0..lanes].*;
        const dx = bx - ax;
        const dy = by - ay;
        const d2 = dx * dx + dy * dy;
        const live = lane_idx < @as(@Vector(lanes, u32), @splat(hi - b));
        const near = @select(bool, d2 < r2, d2 >= eps, d2 < r2);
        const valid = @select(bool, live, near, live);
        if (!@reduce(.Or, valid)) continue;
        const dist = @sqrt(d2);
        if (ctx.has_attraction) {
            const mb: V = g.mass[b..][0..lanes].*;
            const sd = @max(dist, min_dist);
            const k = @select(K, valid, force_scale / (sd * sd * dist), zero);
            const kx = k * dx;
            const ky = k * dy;
            // masked lanes: k is 0 but dx may be inf or NaN there
            acc_x += @select(K, valid, kx * mb, zero);
            acc_y += @select(K, valid, ky * mb, zero);
            const vbx: *[lanes]K = g.dvx[b..][0..lanes];
            const vby: *[lanes]K = g.dvy[b..][0..lanes];
            vbx.* = @as(V, vbx.*) - @select(K, valid, kx * ma, zero);
            vby.* = @as(V, vby.*) - @select(K, valid, ky * ma, zero);
        }
        // lines: write every lane's record and advance the cursor only past
        // the shown ones. hits are random, so this beats a branch per lane.
        // the buffer stops up to `lanes` lines short so every record fits.
        if (ctx.has_connections and p.conn_verts + 2 * lanes <= max_conn_verts) {
            const al = opacity * (one - dist * inv_r);
            const show = @select(bool, valid, al > @as(V, @splat(0.001)), valid);
            if (@reduce(.Or, show)) {
                const al_a: [lanes]K = al;
                const show_a: [lanes]bool = show;
                inline for (0..lanes) |k| {
                    p.connect(a, b + @as(u32, k), al_a[k]);
                    p.conn_verts += 2 * @as(u32, @intFromBool(show_a[k]));
                }
            }
        }
    }
    g.dvx[a] += @reduce(.Add, acc_x);
    g.dvy[a] += @reduce(.Add, acc_y);
}

/// write the line a-b at the cursor (without advancing it)
inline fn connect(p: *Physics, a: u32, b: u32, al: K) void {
    const g = &p.scratch;
    const vi = p.conn_verts;
    const o = vi * 3;
    p.conn_pos[o] = @floatCast(g.x[a]);
    p.conn_pos[o + 1] = @floatCast(g.y[a]);
    p.conn_pos[o + 2] = 0;
    p.conn_pos[o + 3] = @floatCast(g.x[b]);
    p.conn_pos[o + 4] = @floatCast(g.y[b]);
    p.conn_pos[o + 5] = 0;
    p.conn_alpha[vi] = @floatCast(al);
    p.conn_alpha[vi + 1] = @floatCast(al);
    p.conn_color[o..][0..3].* = g.rgb[a];
    p.conn_color[o + 3 ..][0..3].* = g.rgb[b];
}

/// f32 copies of the particle columns in cell order, plus each particle's
/// velocity change from the pair pass. padded by `lanes` so a sweep can read
/// a whole vector past the last particle.
const Scratch = struct {
    x: []K = &.{},
    y: []K = &.{},
    mass: []K = &.{},
    dvx: []K = &.{},
    dvy: []K = &.{},
    idx: []u32 = &.{},
    /// line color of each particle
    rgb: [][3]f32 = &.{},

    fn deinit(g: *Scratch, a: Allocator) void {
        for ([_][]K{ g.x, g.y, g.mass, g.dvx, g.dvy }) |s| a.free(s);
        a.free(g.idx);
        a.free(g.rgb);
    }

    fn fit(g: *Scratch, a: Allocator, n: usize) !void {
        if (g.idx.len >= n + lanes) return;
        g.deinit(a);
        const cap = @max(n, 64) + lanes;
        inline for (.{ "x", "y", "mass", "dvx", "dvy" }) |f| {
            @field(g, f) = try a.alloc(K, cap);
            @memset(@field(g, f), 0);
        }
        g.idx = try a.alloc(u32, cap);
        @memset(g.idx, 0);
        g.rgb = try a.alloc([3]f32, cap);
        @memset(g.rgb, .{ 0, 0, 0 });
    }
};

fn pairs(p: *Physics) void {
    const s = p.settings;
    const r = s.interaction_radius;
    const has_attraction = @abs(s.attract) >= 1e-6 and r > 0;
    const has_connections = s.build_connections and s.connection_opacity > 0.001 and r > 0 and p.conn_alpha.len > 0;
    p.conn_verts = 0;
    if (!has_attraction and !has_connections) return;
    const ctx: PairCtx = .{
        .has_attraction = has_attraction,
        .has_connections = has_connections,
        .r2 = @floatCast(r * r),
        .inv_r = @floatCast(1 / r),
        .force_scale = @floatCast(s.attract * p.dt),
        .min_dist = @floatCast(s.smoothing_factor * r),
        .opacity = @floatCast(s.connection_opacity),
    };

    // gather into cell order
    const g = &p.scratch;
    for (p.sorted[0..p.n], 0..) |i, k| {
        g.x[k] = @floatCast(p.x[i]);
        g.y[k] = @floatCast(p.y[i]);
        g.mass[k] = @floatCast(p.mass[i]);
        g.dvx[k] = 0;
        g.dvy[k] = 0;
        g.idx[k] = i;
    }
    if (has_connections) for (p.sorted[0..p.n], 0..) |i, k| {
        const c = p.palette[p.color[i]];
        g.rgb[k] = .{ @floatCast(c[0]), @floatCast(c[1]), @floatCast(c[2]) };
    };

    // half stencil, with reach R cells: the rest of my cell plus the R cells
    // to my right (one contiguous run in row-major order), then for each of
    // the R rows below, the 2R + 1 cells around my column (one run per row).
    // every pair of cells at most R apart is covered once.
    const gw = p.gw;
    const gh = p.gh;
    const reach = p.reach;
    const start = p.cell_start;
    for (0..gh) |cy| {
        const rows_below = @min(reach, gh - 1 - cy);
        for (0..gw) |cx| {
            const c: u32 = @intCast(cy * gw + cx);
            const right = @min(reach, gw - 1 - cx);
            const right_end = start[c + right + 1];
            const lo_x: u32 = @intCast(cx -| reach);
            const hi_x: u32 = @intCast(@min(cx + reach, gw - 1));
            var ai = start[c];
            while (ai < start[c + 1]) : (ai += 1) {
                p.sweep(&ctx, ai, ai + 1, right_end);
                for (1..rows_below + 1) |dy| {
                    const row: u32 = @intCast((cy + dy) * gw);
                    p.sweep(&ctx, ai, start[row + lo_x], start[row + hi_x + 1]);
                }
            }
        }
    }

    // add the velocity changes back (pairs never move positions)
    for (g.idx[0..p.n], 0..) |i, k| {
        p.vx[i] += g.dvx[k];
        p.vy[i] += g.dvy[k];
    }
}

/// push (or spin) the particles within the mouse radius
fn mouseForce(p: *Physics) void {
    const m = p.mouse;
    if (!m.active) return;
    // the cells the mouse disc overlaps, clamped to the grid. a cell row is
    // one contiguous run of sorted particles.
    const inv = 1 / p.cell_size;
    const x0 = cellAt(m.x - m.radius, inv, p.gw);
    const x1 = cellAt(m.x + m.radius, inv, p.gw);
    const y0 = cellAt(m.y - m.radius, inv, p.gh);
    const y1 = cellAt(m.y + m.radius, inv, p.gh);
    // a disc covering more cells than there are particles (a released
    // vortex reaches far past the canvas) visits the particles instead; each
    // push depends only on its own particle, so the order is free
    if (@as(u64, x1 - x0 + 1) * (y1 - y0 + 1) > p.n) {
        for (0..p.n) |i| p.mousePush(i);
        return;
    }
    for (y0..y1 + 1) |cy| {
        const row: u32 = @intCast(cy * p.gw);
        for (p.sorted[p.cell_start[row + x0]..p.cell_start[row + x1 + 1]]) |i| p.mousePush(i);
    }
}

inline fn mousePush(p: *Physics, i: usize) void {
    const m = p.mouse;
    const r2 = m.radius * m.radius;
    const dx = p.x[i] - m.x;
    const dy = p.y[i] - m.y;
    const d2 = dx * dx + dy * dy;
    if (!(d2 < r2 and d2 > 1e-6)) return;
    const dist = @sqrt(d2);
    const strength = m.force * (1 - dist / m.radius) * (p.dt * 60);
    const dir_x = dx / dist;
    const dir_y = dy / dist;
    if (!m.vortex) {
        p.vx[i] += dir_x * strength;
        p.vy[i] += dir_y * strength;
    } else {
        const radial = strength * @as(f64, if (m.down) 0.3 else 1.0);
        p.vx[i] += dir_x * radial;
        p.vy[i] += dir_y * radial;
        if (m.spinning) {
            const vs = strength * m.vortex_intensity * 0.8 * m.speed_multiplier;
            p.vx[i] += -dir_y * vs;
            p.vy[i] += dir_x * vs;
        }
    }
}

/// soft walls: each wall pushes like the crowd's average
/// density spread over the part of the interaction disc beyond it.
fn wallForce(p: *Physics) void {
    const s = p.settings;
    const r = s.interaction_radius;
    if (!(s.attract <= -1e-6) or r <= 0) return;
    var total_mass: f64 = 0;
    for (p.mass[0..p.n]) |m| total_mass += m;
    const ctx: WallCtx = .{
        .r = r,
        .strength = (s.attract * p.dt * total_mass) / (s.width * s.height),
        .min_dist = s.smoothing_factor * r,
    };
    for (0..p.n) |i| {
        if (p.x[i] < r) p.vx[i] -= ctx.push(p.x[i]);
        if (s.width - p.x[i] < r) p.vx[i] += ctx.push(s.width - p.x[i]);
        if (p.y[i] < r) p.vy[i] -= ctx.push(p.y[i]);
        if (s.height - p.y[i] < r) p.vy[i] += ctx.push(s.height - p.y[i]);
    }
}

const WallCtx = struct {
    r: f64,
    strength: f64,
    min_dist: f64,

    fn push(c: WallCtx, d: f64) f64 {
        const dd = jsMax(d, c.min_dist);
        if (dd >= c.r) return 0;
        const q = @sqrt(c.r * c.r - dd * dd);
        return c.strength * (2 * @log((c.r + q) / dd) - (2 * q) / c.r);
    }
};

/// js Math.max(a, b): NaN-propagating, +0 over -0
inline fn jsMax(a: f64, b: f64) f64 {
    if (std.math.isNan(a) or std.math.isNan(b)) return std.math.nan(f64);
    if (a == b) return if (std.math.signbit(a)) b else a;
    return if (a > b) a else b;
}

/// Particle.update
fn updateParticle(p: *Physics, i: usize) void {
    const s = p.settings;
    const dt = p.dt;
    const dt_adj = dt * 60;
    if (s.gravity != 0) p.vy[i] += s.gravity * dt;
    const speed = @sqrt(p.vx[i] * p.vx[i] + p.vy[i] * p.vy[i]);
    if (speed > 1e-6) {
        const f = 1.0 - (s.drag * dt_adj);
        p.vx[i] *= jsMax0(f);
        p.vy[i] *= jsMax0(f);
    }
    p.x[i] += p.vx[i] * dt_adj;
    p.y[i] += p.vy[i] * dt_adj;
    const push_out = 0.1;
    const r = p.radius[i];
    const e = s.elasticity;
    if (p.x[i] - r < 0) {
        p.x[i] = r + push_out;
        p.vx[i] *= -e;
        p.vy[i] += (p.rng.random().float(f64) - 0.5) * 0.1 * @abs(p.vx[i]);
    } else if (p.x[i] + r > s.width) {
        p.x[i] = s.width - r - push_out;
        p.vx[i] *= -e;
        p.vy[i] += (p.rng.random().float(f64) - 0.5) * 0.1 * @abs(p.vx[i]);
    }
    if (p.y[i] - r < 0) {
        p.y[i] = r + push_out;
        p.vy[i] *= -e;
        p.vx[i] += (p.rng.random().float(f64) - 0.5) * 0.1 * @abs(p.vy[i]);
    } else if (p.y[i] + r > s.height) {
        p.y[i] = s.height - r - push_out;
        p.vy[i] *= -e;
        p.vx[i] += (p.rng.random().float(f64) - 0.5) * 0.1 * @abs(p.vy[i]);
    }
}

/// ShapeField.contains
fn contains(sh: *const Shape, x: f64, y: f64, pad: f64) bool {
    const dx = x - sh.x;
    const dy = y - sh.y;
    if (dx * dx + dy * dy > (sh.r + pad) * (sh.r + pad)) return false;
    if (sh.circle) return true;
    for (0..sh.sides) |k| {
        if (sh.normals[k * 2] * x + sh.normals[k * 2 + 1] * y - sh.offsets[k] >= pad) return false;
    }
    return true;
}

/// ShapeField.collide
fn collide(p: *Physics, i: usize) void {
    const e = p.settings.elasticity;
    for (p.shapes.items) |*sh| {
        if (!contains(sh, p.x[i], p.y[i], p.radius[i])) continue;
        var nx: f64 = undefined;
        var ny: f64 = undefined;
        var depth: f64 = undefined;
        if (sh.circle) {
            const dx = p.x[i] - sh.x;
            const dy = p.y[i] - sh.y;
            const dist = std.math.hypot(dx, dy);
            const target = sh.r + p.radius[i];
            if (dist < 1e-6) {
                nx = 1;
                ny = 0;
                depth = target;
            } else {
                nx = dx / dist;
                ny = dy / dist;
                depth = target - dist;
            }
        } else {
            var best = -std.math.inf(f64);
            var bi: usize = 0;
            for (0..sh.sides) |k| {
                const d = sh.normals[k * 2] * p.x[i] + sh.normals[k * 2 + 1] * p.y[i] - sh.offsets[k];
                if (d > best) {
                    best = d;
                    bi = k;
                }
            }
            nx = sh.normals[bi * 2];
            ny = sh.normals[bi * 2 + 1];
            depth = p.radius[i] - best;
        }
        if (depth <= 0) continue;
        p.x[i] += nx * (depth + 0.1);
        p.y[i] += ny * (depth + 0.1);
        const vn = p.vx[i] * nx + p.vy[i] * ny;
        if (vn < 0) {
            const j = -(1 + e) * vn;
            p.vx[i] += nx * j;
            p.vy[i] += ny * j;
            const jitter = (p.rng.random().float(f64) - 0.5) * 0.1 * @abs(vn);
            p.vx[i] += -ny * jitter;
            p.vy[i] += nx * jitter;
        }
    }
}

/// one frame of physics; delta_ms is the frame time in milliseconds. it takes
/// no allocator: everything it touches was reserved by `resize`, so js's raw
/// views into the columns stay valid.
pub fn step(p: *Physics, delta_ms: f64) void {
    p.dt = delta_ms / 1000.0;
    p.updateGrid();
    p.pairs();
    p.wallForce();
    p.mouseForce();
    const has_shapes = p.shapes.items.len > 0;
    for (0..p.n) |i| {
        p.updateParticle(i);
        if (has_shapes) p.collide(i);
    }
}

test "resize keeps particles and zeroes new ones" {
    const a = std.testing.allocator;
    var p: Physics = .{};
    defer p.deinit(a);
    try p.resize(a, 3);
    p.x[2] = 42;
    p.color[2] = 7;
    try p.resize(a, 1000);
    try std.testing.expectEqual(@as(f64, 42), p.x[2]);
    try std.testing.expectEqual(@as(u8, 7), p.color[2]);
    try std.testing.expectEqual(Particle{}, p.particles.get(999));
    try p.resize(a, 2);
    try std.testing.expectEqual(@as(usize, 2), p.x.len);
}

test "step keeps particles in the box" {
    const a = std.testing.allocator;
    var p: Physics = .{};
    defer p.deinit(a);
    try p.resize(a, 300);
    try p.ensureConnections(a);
    var prng = std.Random.DefaultPrng.init(1);
    const r = prng.random();
    for (0..300) |i| {
        p.x[i] = r.float(f64) * 800;
        p.y[i] = r.float(f64) * 600;
        p.vx[i] = r.float(f64) - 0.5;
        p.vy[i] = r.float(f64) - 0.5;
        p.radius[i] = 2.5;
        p.mass[i] = std.math.pi * 2.5 * 2.5;
    }
    for (0..300) |_| p.step(16.6);
    for (p.x[0..p.n], p.y[0..p.n]) |x, y| {
        try std.testing.expect(x >= 0 and x <= 800);
        try std.testing.expect(y >= 0 and y <= 600);
    }
}

test "a mouse wider than the crowd pushes like the cell walk does" {
    // 40 particles near the mouse; the same 40 plus 400 parked far away make
    // the cells fewer than the particles, so the walk runs instead
    const a = std.testing.allocator;
    var near: Physics = .{};
    defer near.deinit(a);
    var crowd: Physics = .{};
    defer crowd.deinit(a);
    try near.resize(a, 40);
    try crowd.resize(a, 440);
    var prng = std.Random.DefaultPrng.init(3);
    const r = prng.random();
    for (0..440) |i| {
        const x = if (i < 40) 300 + r.float(f64) * 200 else 5000 + r.float(f64) * 100;
        const y = if (i < 40) 200 + r.float(f64) * 200 else 5000 + r.float(f64) * 100;
        for ([_]*Physics{ &near, &crowd }) |p| if (i < p.n) {
            p.x[i] = x;
            p.y[i] = y;
        };
    }
    for ([_]*Physics{ &near, &crowd }) |p| {
        p.settings = .{ .interaction_radius = 60, .width = 6000, .height = 6000 };
        p.mouse = .{ .active = true, .x = 400, .y = 300, .radius = 250, .force = 2, .vortex = true, .down = true, .spinning = true, .vortex_intensity = 0.7, .speed_multiplier = 3 };
        p.dt = 0.0166;
        p.updateGrid();
        p.mouseForce();
    }
    // 250 / 60 rounds up to 5 cells each way: 121 cells, between 40 and 440
    for (0..40) |i| {
        try std.testing.expect(near.vx[i] != 0 or near.vy[i] != 0);
        try std.testing.expectEqual(near.vx[i], crowd.vx[i]);
        try std.testing.expectEqual(near.vy[i], crowd.vy[i]);
    }
}
