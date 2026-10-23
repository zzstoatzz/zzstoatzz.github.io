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
    color_mode: ColorMode = .off,
    /// species: how hard the colors pull and push on each other
    species_force: f64 = 0,
    /// dye: how readily particles that touch take each other's color
    dye_rate: f64 = 0,
};

/// what color does besides look: nothing, a force between colors (each
/// color feels every other through the `species` table), or a dye that
/// spreads where particles rub past each other
pub const ColorMode = enum(u8) { off, species, dye };

/// species: below this fraction of r every pair pushes apart; past it the
/// table's pull or push rises to a peak midway out and fades by r
pub const species_core = 0.3;
/// dye: particles closer than this fraction of r touch
pub const dye_reach = 0.5;
/// dye: a press paints the particles within this fraction of its radius
pub const paint_reach = 0.4;
/// the species table's side: colors past it share rows (index & 15)
pub const max_species = 16;

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
    /// dye: the color a press paints
    paint: u8 = 0,
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

/// the pair force fades to zero over this outer fraction of the interaction
/// radius (a smoothstep). cut off abruptly, every dense line of particles
/// pushes everything within r and nothing past it, so the crowd stacks
/// copies of a wall's crust one radius in.
pub const taper_band = 0.25;

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
/// species[a][b]: how color a feels color b, in [-1, 1] (> 0 pulls). not
/// symmetric, so one color can chase another that runs from it.
species: [max_species][max_species]f32 = @splat(@splat(0)),
/// bumped whenever the dye changes a color, so js knows to redraw them
dyed: u32 = 0,
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

/// a fresh species table from seed
pub fn seedSpecies(p: *Physics, seed: u32) void {
    var prng: std.Random.DefaultPrng = .init(seed);
    const r = prng.random();
    for (&p.species) |*row| for (row) |*m| {
        m.* = r.float(f32) * 2 - 1;
    };
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
    has_species: bool,
    has_dye: bool,
    /// species: the kick per unit of profile, species_force · 60 dt
    sp_scale: K,
    core: K,
    inv_core: K,
    /// r + core, and 1 / (r - core): the profile peaks at (r + core) / 2
    peak2: K,
    inv_span: K,
    reach2: K,
    dye_scale: f64,
    r: K,
    r2: K,
    inv_r: K,
    inv_band: K,
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
    const rr: V = @splat(ctx.r);
    const inv_band: V = @splat(ctx.inv_band);
    const three: V = @splat(3);
    const two: V = @splat(2);
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
            // min/max as selects: @min/@max carry NaN rules that wasm simd
            // has no instruction for, so they lower to a per-lane sequence
            // that cost more than the rest of the pair. no lane that counts
            // is NaN here.
            const sd = @select(K, dist > min_dist, dist, min_dist);
            const u = (rr - dist) * inv_band;
            const t = @select(K, u < one, @select(K, u > zero, u, zero), one);
            const taper = t * t * (three - two * t);
            const k = @select(K, valid, force_scale * taper / (sd * sd * dist), zero);
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
        if (ctx.has_species) {
            // each side feels the other through its own row of the table
            var mab: V = undefined;
            var mba: V = undefined;
            const ca = g.col[a] % max_species;
            inline for (0..lanes) |k| {
                const cb = g.col[b + k] % max_species;
                mab[k] = p.species[ca][cb];
                mba[k] = p.species[cb][ca];
            }
            const core: V = @splat(ctx.core);
            const in_core = dist < core;
            const push = dist * @as(V, @splat(ctx.inv_core)) - one;
            const tent = one - @abs(two * dist - @as(V, @splat(ctx.peak2))) * @as(V, @splat(ctx.inv_span));
            const fa = @select(K, in_core, push, mab * tent);
            const fb = @select(K, in_core, push, mba * tent);
            // masked lanes: dist may be 0 or NaN there
            const k = @select(K, valid, @as(V, @splat(ctx.sp_scale)) / dist, zero);
            acc_x += @select(K, valid, k * fa * dx, zero);
            acc_y += @select(K, valid, k * fa * dy, zero);
            const vbx: *[lanes]K = g.dvx[b..][0..lanes];
            const vby: *[lanes]K = g.dvy[b..][0..lanes];
            vbx.* = @as(V, vbx.*) - @select(K, valid, k * fb * dx, zero);
            vby.* = @as(V, vby.*) - @select(K, valid, k * fb * dy, zero);
        }
        if (ctx.has_dye) {
            const touch = @select(bool, valid, d2 < @as(V, @splat(ctx.reach2)), valid);
            if (@reduce(.Or, touch)) {
                const touch_a: [lanes]bool = touch;
                inline for (0..lanes) |k| if (touch_a[k]) p.rub(ctx, a, b + @as(u32, k));
            }
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

/// two touching particles of different colors: the faster they slide past
/// each other, the likelier one takes the other's color
fn rub(p: *Physics, ctx: *const PairCtx, a: u32, b: u32) void {
    const g = &p.scratch;
    if (g.col[a] == g.col[b]) return;
    const i = g.idx[a];
    const j = g.idx[b];
    const dvx = p.vx[i] - p.vx[j];
    const dvy = p.vy[i] - p.vy[j];
    const chance = ctx.dye_scale * @sqrt(dvx * dvx + dvy * dvy);
    const r = p.rng.random();
    if (!(r.float(f64) < chance)) return;
    if (r.boolean()) g.col[a] = g.col[b] else g.col[b] = g.col[a];
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
    /// palette index of each particle
    col: []u8 = &.{},

    fn deinit(g: *Scratch, a: Allocator) void {
        for ([_][]K{ g.x, g.y, g.mass, g.dvx, g.dvy }) |s| a.free(s);
        a.free(g.idx);
        a.free(g.rgb);
        a.free(g.col);
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
        g.col = try a.alloc(u8, cap);
        @memset(g.col, 0);
    }
};

fn pairs(p: *Physics) void {
    const s = p.settings;
    const r = s.interaction_radius;
    const has_attraction = @abs(s.attract) >= 1e-6 and r > 0;
    const has_connections = s.build_connections and s.connection_opacity > 0.001 and r > 0 and p.conn_alpha.len > 0;
    const has_species = s.color_mode == .species and s.species_force > 0 and r > 0;
    const has_dye = s.color_mode == .dye and s.dye_rate > 0 and r > 0;
    p.conn_verts = 0;
    if (!has_attraction and !has_connections and !has_species and !has_dye) return;
    const core = species_core * r;
    const ctx: PairCtx = .{
        .has_attraction = has_attraction,
        .has_connections = has_connections,
        .has_species = has_species,
        .has_dye = has_dye,
        .sp_scale = @floatCast(s.species_force * p.dt * 60),
        .core = @floatCast(core),
        .inv_core = @floatCast(1 / core),
        .peak2 = @floatCast(r + core),
        .inv_span = @floatCast(1 / (r - core)),
        .reach2 = @floatCast(dye_reach * dye_reach * r * r),
        .dye_scale = s.dye_rate * p.dt * 60,
        .r = @floatCast(r),
        .r2 = @floatCast(r * r),
        .inv_r = @floatCast(1 / r),
        .inv_band = @floatCast(1 / (taper_band * r)),
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
        g.col[k] = p.color[i];
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
    if (has_dye) for (g.idx[0..p.n], g.col[0..p.n]) |i, c| {
        if (p.color[i] == c) continue;
        p.color[i] = c;
        p.dyed +%= 1;
    };
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
    if (p.settings.color_mode == .dye and m.down and d2 < paint_reach * paint_reach * r2 and p.color[i] != m.paint) {
        p.color[i] = m.paint;
        p.dyed +%= 1;
    }
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

/// soft walls: a wall acts as a mirror. a particle within r of one is pushed
/// by the mirror images of its neighbors (itself included) beyond it, with
/// the pair force, so the wall pushes exactly as hard as the crowd pressing
/// on it: a crowd piled up by gravity gets a floor as strong as it needs, and
/// nothing builds up a crust on the edge.
fn wallForce(p: *Physics) void {
    const s = p.settings;
    const r = s.interaction_radius;
    if (!(s.attract <= -1e-6) or r <= 0) return;
    const ctx: WallCtx = .{
        .r = @splat(@floatCast(r)),
        .r2 = @splat(@floatCast(r * r)),
        .inv_band = @splat(@floatCast(1 / (taper_band * r))),
        .fs = @splat(@floatCast(s.attract * p.dt)),
        .min_dist = @splat(@floatCast(s.smoothing_factor * r)),
    };
    const w = s.width;
    const h = s.height;
    const inv = 1 / p.cell_size;
    // a mirror image is within r only of a source within r of the same
    // wall, so only the cells that far in hold sources
    const edge_cells = p.reach + 1;
    // pairs() left f32 copies of the columns in cell order (scratch), which
    // read far better than the columns through `sorted`, and are padded so a
    // sweep may read `lanes` past its end
    const g = &p.scratch;
    const lane_idx: @Vector(lanes, u32) = std.simd.iota(u32, lanes);
    // the mirror of o across a wall at 0 or at `size` is -o or 2·size - o
    const wx: V = @splat(@floatCast(2 * w));
    const wy: V = @splat(@floatCast(2 * h));
    for (0..p.n) |i| {
        const x = p.x[i];
        const y = p.y[i];
        const nl = x < r;
        const nr = w - x < r;
        const nt = y < r;
        const nb = h - y < r;
        const nx = nl or nr;
        const ny = nt or nb;
        if (!(nx or ny)) continue;
        const cx = cellAt(x, inv, p.gw);
        const cy = cellAt(y, inv, p.gh);
        var x0 = cx -| p.reach;
        var x1 = @min(cx + p.reach, p.gw - 1);
        var y0 = cy -| p.reach;
        var y1 = @min(cy + p.reach, p.gh - 1);
        if (nx and !ny) {
            if (nl) x1 = @min(x1, edge_cells - 1) else x0 = @max(x0, p.gw -| edge_cells);
        } else if (ny and !nx) {
            if (nt) y1 = @min(y1, edge_cells - 1) else y0 = @max(y0, p.gh -| edge_cells);
        }
        const px: V = @splat(@floatCast(x));
        const py: V = @splat(@floatCast(y));
        var fx: V = @splat(0);
        var fy: V = @splat(0);
        for (y0..y1 + 1) |row| {
            const c: u32 = @intCast(row * p.gw);
            const hi: u32 = p.cell_start[c + x1 + 1];
            var k: u32 = p.cell_start[c + x0];
            while (k < hi) : (k += lanes) {
                const live = lane_idx < @as(@Vector(lanes, u32), @splat(hi - k));
                const ox: V = g.x[k..][0..lanes].*;
                const oy: V = g.y[k..][0..lanes].*;
                const m: V = g.mass[k..][0..lanes].*;
                const mx = if (nl) -ox else wx - ox;
                const my = if (nt) -oy else wy - oy;
                if (nx) ctx.add(&fx, &fy, live, mx - px, oy - py, m);
                if (ny) ctx.add(&fx, &fy, live, ox - px, my - py, m);
                if (nx and ny) ctx.add(&fx, &fy, live, mx - px, my - py, m);
            }
        }
        p.vx[i] += @reduce(.Add, fx);
        p.vy[i] += @reduce(.Add, fy);
    }
}

const WallCtx = struct {
    r: V,
    r2: V,
    inv_band: V,
    fs: V,
    min_dist: V,

    /// the pair force from mirror images of mass m at offsets (dx, dy),
    /// `lanes` at a time, into (fx, fy). min/max are selects, as in sweep.
    inline fn add(c: WallCtx, fx: *V, fy: *V, live: @Vector(lanes, bool), dx: V, dy: V, m: V) void {
        const zero: V = @splat(0);
        const one: V = @splat(1);
        const d2 = dx * dx + dy * dy;
        const near = @select(bool, d2 < c.r2, d2 >= @as(V, @splat(1e-6)), d2 < c.r2);
        const valid = @select(bool, live, near, live);
        if (!@reduce(.Or, valid)) return;
        const dist = @sqrt(d2);
        const sd = @select(K, dist > c.min_dist, dist, c.min_dist);
        const u = (c.r - dist) * c.inv_band;
        const t = @select(K, u < one, @select(K, u > zero, u, zero), one);
        const k = @select(K, valid, c.fs * m * t * t * (@as(V, @splat(3)) - @as(V, @splat(2)) * t) / (sd * sd * dist), zero);
        // masked lanes: k is 0 but dx may be inf or NaN there
        fx.* += @select(K, valid, k * dx, zero);
        fy.* += @select(K, valid, k * dy, zero);
    }
};

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

test "a species table is seeded, in range and not symmetric" {
    var p: Physics = .{};
    var q: Physics = .{};
    p.seedSpecies(7);
    q.seedSpecies(7);
    try std.testing.expectEqual(p.species, q.species);
    var asymmetric = false;
    for (0..max_species) |a| for (0..max_species) |b| {
        try std.testing.expect(p.species[a][b] >= -1 and p.species[a][b] <= 1);
        if (p.species[a][b] != p.species[b][a]) asymmetric = true;
    };
    try std.testing.expect(asymmetric);
    q.seedSpecies(8);
    try std.testing.expect(!std.meta.eql(p.species, q.species));
}

/// two particles 30 px apart on a line, colors 0 and 1, nothing but species
fn speciesPair(a: f32, b: f32) !struct { f64, f64 } {
    const al = std.testing.allocator;
    var p: Physics = .{};
    defer p.deinit(al);
    try p.resize(al, 2);
    p.settings = .{ .attract = 0, .connection_opacity = 0, .color_mode = .species, .species_force = 1 };
    p.species[0][1] = a;
    p.species[1][0] = b;
    p.x[0] = 300;
    p.x[1] = 330;
    p.y[0] = 300;
    p.y[1] = 300;
    p.color[1] = 1;
    p.dt = 1.0 / 60.0;
    p.updateGrid();
    p.pairs();
    return .{ p.vx[0], p.vx[1] };
}

test "species pull and push by their own row of the table" {
    // 0 is drawn to 1 while 1 runs from 0: both head right
    const chase = try speciesPair(1, -1);
    try std.testing.expect(chase[0] > 0);
    try std.testing.expect(chase[1] > 0);
    try std.testing.expectApproxEqAbs(chase[0], chase[1], 1e-6);
    // neither cares: nothing happens
    const calm = try speciesPair(0, 0);
    try std.testing.expectEqual(@as(f64, 0), calm[0]);
    try std.testing.expectEqual(@as(f64, 0), calm[1]);
}

test "a press paints in dye mode, and only in dye mode" {
    const al = std.testing.allocator;
    for ([_]ColorMode{ .dye, .species }) |mode| {
        var p: Physics = .{};
        defer p.deinit(al);
        try p.resize(al, 2);
        p.settings = .{ .color_mode = mode, .dye_rate = 1 };
        p.mouse = .{ .active = true, .down = true, .x = 400, .y = 300, .radius = 250, .force = 1, .paint = 5 };
        p.x[0] = 420; // inside the paint reach
        p.x[1] = 600; // pushed, not painted
        p.y[0] = 300;
        p.y[1] = 300;
        p.dt = 1.0 / 60.0;
        p.updateGrid();
        p.mouseForce();
        try std.testing.expectEqual(@as(u8, if (mode == .dye) 5 else 0), p.color[0]);
        try std.testing.expectEqual(@as(u8, 0), p.color[1]);
    }
}

test "dye spreads between particles sliding past each other, not still ones" {
    const al = std.testing.allocator;
    for ([_]f64{ 0, 4 }) |slide| {
        var p: Physics = .{};
        defer p.deinit(al);
        try p.resize(al, 2);
        p.settings = .{ .attract = 0, .connection_opacity = 0, .color_mode = .dye, .dye_rate = 1 };
        p.x[0] = 300;
        p.x[1] = 310;
        p.y[0] = 300;
        p.y[1] = 300;
        p.vy[0] = slide;
        p.color[1] = 3;
        p.dt = 1.0 / 60.0;
        for (0..20) |_| {
            p.updateGrid();
            p.pairs();
        }
        try std.testing.expectEqual(slide == 0, p.color[0] != p.color[1]);
        try std.testing.expectEqual(slide == 0, p.dyed == 0);
    }
}
