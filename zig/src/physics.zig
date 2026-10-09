//! the homepage particle physics: spatial hash, pair attraction and the
//! connection-line buffer, soft walls, mouse force, particle update and shape
//! collisions. js (public/js/particles) keeps rendering, ui, mouse visuals and
//! shape geometry, and reads and writes the particle columns directly.
//!
//! this was ported bit-for-bit from an earlier js implementation, which is
//! why some arithmetic keeps js semantics (`|0` cell keys via toInt32,
//! NaN-propagating max, js operation order in the pair pass).
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

const Cell = struct { cx: i32, cy: i32, start: u32, len: u32 };

/// open-addressing i32 -> cell slot table. cleared every frame, sized to 2x
/// the particle count so it never fills.
const CellTable = struct {
    keys: []i32 = &.{},
    vals: []u32 = &.{},
    mask: u32 = 0,
    const empty_val = std.math.maxInt(u32);

    fn deinit(t: *CellTable, a: Allocator) void {
        a.free(t.keys);
        a.free(t.vals);
    }

    fn reset(t: *CellTable, a: Allocator, n: usize) !void {
        const want = std.math.ceilPowerOfTwo(usize, @max(16, n * 2)) catch unreachable;
        if (t.keys.len != want) {
            a.free(t.keys);
            a.free(t.vals);
            t.keys = try a.alloc(i32, want);
            t.vals = try a.alloc(u32, want);
            t.mask = @intCast(want - 1);
        }
        @memset(t.vals, empty_val);
    }

    inline fn slot(t: *const CellTable, key: i32) u32 {
        const h = @as(u32, @bitCast(key)) *% 0x9E3779B1;
        return (h ^ (h >> 15)) & t.mask;
    }

    inline fn get(t: *const CellTable, key: i32) ?u32 {
        var s = t.slot(key);
        while (true) : (s = (s + 1) & t.mask) {
            const v = t.vals[s];
            if (v == empty_val) return null;
            if (t.keys[s] == key) return v;
        }
    }

    /// returns the existing value, or stores `v` and returns null
    inline fn getOrPut(t: *CellTable, key: i32, v: u32) ?u32 {
        var s = t.slot(key);
        while (true) : (s = (s + 1) & t.mask) {
            const cur = t.vals[s];
            if (cur == empty_val) {
                t.keys[s] = key;
                t.vals[s] = v;
                return null;
            }
            if (t.keys[s] == key) return cur;
        }
    }
};

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

// spatial hash
cell_size: f64 = 50,
cells: std.ArrayList(Cell) = .empty,
lookup: CellTable = .{},
slot_of: std.ArrayList(u32) = .empty,
sorted: std.ArrayList(u32) = .empty,
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
    p.cells.deinit(a);
    p.lookup.deinit(a);
    p.slot_of.deinit(a);
    p.sorted.deinit(a);
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

    try p.lookup.reset(a, n);
    try p.slot_of.ensureTotalCapacity(a, n);
    try p.sorted.ensureTotalCapacity(a, n);
    try p.cells.ensureTotalCapacity(a, n);
    try p.scratch.fit(a, n);
}

pub fn ensureConnections(p: *Physics, a: Allocator) !void {
    if (p.conn_alpha.len == max_conn_verts) return;
    p.conn_pos = try a.alloc(f32, max_conn_verts * 3);
    p.conn_alpha = try a.alloc(f32, max_conn_verts);
    p.conn_color = try a.alloc(f32, max_conn_verts * 3);
}

/// js `v | 0`
pub fn toInt32(v: f64) i32 {
    if (!std.math.isFinite(v)) return 0;
    const t = @trunc(v);
    // reduce mod 2^32 into [0, 2^32), then reinterpret
    const m = @mod(t, 4294967296.0);
    const u: u32 = @intFromFloat(m);
    return @bitCast(u);
}

/// cell key: ((cx & 0xffff) << 16) | (cy & 0xffff), as int32
inline fn hashKey(cx: i32, cy: i32) i32 {
    const ux: u32 = @bitCast(cx);
    const uy: u32 = @bitCast(cy);
    return @bitCast(((ux & 0xffff) << 16) | (uy & 0xffff));
}

/// js Math.max(0, v): NaN-propagating
inline fn jsMax0(v: f64) f64 {
    if (std.math.isNan(v)) return v;
    return if (v > 0) v else 0;
}

/// SpatialHash.update
fn updateHash(p: *Physics, a: Allocator) !void {
    const s = p.settings;
    p.cell_size = if (s.interaction_radius > 0) s.interaction_radius else 50;
    const inv = 1 / p.cell_size;
    p.cells.clearRetainingCapacity();
    try p.lookup.reset(a, p.n);
    try p.slot_of.resize(a, p.n);
    try p.sorted.resize(a, p.n);
    for (0..p.n) |i| {
        const cx = toInt32(p.x[i] * inv);
        const cy = toInt32(p.y[i] * inv);
        const fresh: u32 = @intCast(p.cells.items.len);
        const slot = p.lookup.getOrPut(hashKey(cx, cy), fresh) orelse blk: {
            try p.cells.append(a, .{ .cx = cx, .cy = cy, .start = 0, .len = 0 });
            break :blk fresh;
        };
        p.slot_of.items[i] = slot;
        p.cells.items[slot].len += 1;
    }
    var off: u32 = 0;
    for (p.cells.items) |*c| {
        c.start = off;
        off += c.len;
        c.len = 0;
    }
    for (0..p.n) |i| {
        const c = &p.cells.items[p.slot_of.items[i]];
        p.sorted.items[c.start + c.len] = @intCast(i);
        c.len += 1;
    }
}

inline fn cellItems(p: *const Physics, key: i32) ?[]const u32 {
    const slot = p.lookup.get(key) orelse return null;
    const c = p.cells.items[slot];
    return p.sorted.items[c.start..][0..c.len];
}

const forward = [_][2]i32{ .{ 1, -1 }, .{ 1, 0 }, .{ 1, 1 }, .{ 0, 1 } };

const PairCtx = struct {
    has_attraction: bool,
    has_connections: bool,
    r2: f64,
    r: f64,
    force_scale: f64,
    min_dist: f64,
    opacity: f64,
};

/// applyAttractionAndBuildConnections / applyAttraction pair body. a and b are
/// positions in the cell-sorted scratch arrays (contiguous per cell, much
/// friendlier to the cache than chasing particle indices); the float ops are
/// the same ones js does on particles[i], particles[j], in the same order.
inline fn pair(p: *Physics, ctx: *const PairCtx, a: u32, b: u32) void {
    const g = &p.scratch;
    const dx = g.x[b] - g.x[a];
    const dy = g.y[b] - g.y[a];
    const d2 = dx * dx + dy * dy;
    if (d2 >= ctx.r2 or d2 < 1e-6) return;
    const dist = @sqrt(d2);
    if (ctx.has_attraction) {
        const sd = if (dist > ctx.min_dist) dist else ctx.min_dist;
        if (sd >= 1e-6) {
            const fm = (ctx.force_scale * (g.mass[a] * g.mass[b])) / (sd * sd);
            const gg = fm / dist;
            const fx = gg * dx;
            const fy = gg * dy;
            if (!std.math.isNan(fx) and !std.math.isNan(fy)) {
                g.vx[a] += fx / g.mass[a];
                g.vy[a] += fy / g.mass[a];
                g.vx[b] += -fx / g.mass[b];
                g.vy[b] += -fy / g.mass[b];
            }
        }
    }
    if (ctx.has_connections and p.conn_verts < max_conn_verts) {
        const al = ctx.opacity * (1 - dist / ctx.r);
        if (al > 0.001) {
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
            const c1 = p.palette[p.color[g.idx[a]]];
            const c2 = p.palette[p.color[g.idx[b]]];
            inline for (0..3) |k| {
                p.conn_color[o + k] = @floatCast(c1[k]);
                p.conn_color[o + 3 + k] = @floatCast(c2[k]);
            }
            p.conn_verts = vi + 2;
        }
    }
}

/// js calls callback(min(i, j), max(i, j)) in particle-index terms
inline fn orderedPair(p: *Physics, ctx: *const PairCtx, a: u32, b: u32) void {
    if (p.scratch.idx[a] < p.scratch.idx[b]) p.pair(ctx, a, b) else p.pair(ctx, b, a);
}

const lanes = 4;
const V = @Vector(lanes, f64);

/// orderedPair(a, b) for b in [lo, hi), in order, `lanes` candidates at a
/// time. the pair math (sqrt, the divisions) runs as simd; the results are
/// then applied lane by lane in js order, so the output is bit-identical:
///   - (-dx)^2 == dx^2 and g*(-dx) == -(g*dx) exactly, so a swapped pair
///     (js passes min index first) yields the same velocity deltas
///   - every lane's deltas depend only on positions and masses, which pairs
///     never change, so computing them ahead of applying them is safe
///   - the adds into particle a happen in the same sequence as in js
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
    const rv: V = @splat(ctx.r);
    const one: V = @splat(1);
    const zero: V = @splat(0);
    var b = lo;
    while (b + lanes <= hi) : (b += lanes) {
        const bx: V = g.x[b..][0..lanes].*;
        const by: V = g.y[b..][0..lanes].*;
        const dx = bx - ax;
        const dy = by - ay;
        const d2 = dx * dx + dy * dy;
        const in_range = d2 < r2;
        if (!@reduce(.Or, in_range)) continue;
        const not_tiny = d2 >= eps;
        const dist = @sqrt(d2);

        var tax: V = zero;
        var tay: V = zero;
        var tbx: V = zero;
        var tby: V = zero;
        var att_ok: @Vector(lanes, bool) = @splat(false);
        if (ctx.has_attraction) {
            const mb: V = g.mass[b..][0..lanes].*;
            const sd = @select(f64, dist > min_dist, dist, min_dist);
            const fm = (force_scale * (ma * mb)) / (sd * sd);
            const gg = fm / dist;
            const fx = gg * dx;
            const fy = gg * dy;
            tax = fx / ma;
            tay = fy / ma;
            tbx = -fx / mb;
            tby = -fy / mb;
            const sd_ok = sd >= eps;
            const fx_ok = fx == fx;
            const fy_ok = fy == fy;
            att_ok = @select(bool, sd_ok, @select(bool, fx_ok, fy_ok, fx_ok), sd_ok);
        }
        const al = opacity * (one - dist / rv);

        // walk the hit lanes with a bitmask instead of a branch per lane;
        // hits are ~random so per-lane branches mispredict constantly
        const Mask = std.meta.Int(.unsigned, lanes);
        const valid = @select(bool, in_range, not_tiny, in_range);
        var m: Mask = @bitCast(valid);
        const att_m: Mask = @bitCast(att_ok);
        const tax_a: [lanes]f64 = tax;
        const tay_a: [lanes]f64 = tay;
        const tbx_a: [lanes]f64 = tbx;
        const tby_a: [lanes]f64 = tby;
        const al_a: [lanes]f64 = al;
        while (m != 0) : (m &= m - 1) {
            const k: u32 = @ctz(m);
            const bk = b + k;
            if (ctx.has_attraction and (att_m >> @intCast(k)) & 1 != 0) {
                g.vx[a] += tax_a[k];
                g.vy[a] += tay_a[k];
                g.vx[bk] += tbx_a[k];
                g.vy[bk] += tby_a[k];
            }
            if (ctx.has_connections and p.conn_verts < max_conn_verts and al_a[k] > 0.001) {
                const swap = g.idx[a] > g.idx[bk];
                p.connect(if (swap) bk else a, if (swap) a else bk, al_a[k]);
            }
        }
    }
    while (b < hi) : (b += 1) p.orderedPair(ctx, a, b);
}

inline fn connect(p: *Physics, a: u32, b: u32, al: f64) void {
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
    const c1 = p.palette[p.color[g.idx[a]]];
    const c2 = p.palette[p.color[g.idx[b]]];
    inline for (0..3) |k| {
        p.conn_color[o + k] = @floatCast(c1[k]);
        p.conn_color[o + 3 + k] = @floatCast(c2[k]);
    }
    p.conn_verts = vi + 2;
}

const Scratch = struct {
    x: []f64 = &.{},
    y: []f64 = &.{},
    vx: []f64 = &.{},
    vy: []f64 = &.{},
    mass: []f64 = &.{},
    idx: []u32 = &.{},

    fn deinit(g: *Scratch, a: Allocator) void {
        for ([_][]f64{ g.x, g.y, g.vx, g.vy, g.mass }) |s| a.free(s);
        a.free(g.idx);
    }

    fn fit(g: *Scratch, a: Allocator, n: usize) !void {
        if (g.idx.len >= n) return;
        g.deinit(a);
        const cap = @max(n, 64);
        g.x = try a.alloc(f64, cap);
        g.y = try a.alloc(f64, cap);
        g.vx = try a.alloc(f64, cap);
        g.vy = try a.alloc(f64, cap);
        g.mass = try a.alloc(f64, cap);
        g.idx = try a.alloc(u32, cap);
    }
};

fn pairs(p: *Physics, a: Allocator) !void {
    const s = p.settings;
    const r = s.interaction_radius;
    const has_attraction = @abs(s.attract) >= 1e-6 and r > 0;
    const has_connections = s.build_connections and s.connection_opacity > 0.001 and r > 0 and p.conn_alpha.len > 0;
    p.conn_verts = 0;
    if (!has_attraction and !has_connections) return;
    const ctx: PairCtx = .{
        .has_attraction = has_attraction,
        .has_connections = has_connections,
        .r2 = r * r,
        .r = r,
        .force_scale = s.attract * p.dt,
        .min_dist = s.smoothing_factor * r,
        .opacity = s.connection_opacity,
    };

    // gather into cell order
    try p.scratch.fit(a, p.n);
    const g = &p.scratch;
    for (p.sorted.items, 0..) |i, k| {
        g.x[k] = p.x[i];
        g.y[k] = p.y[i];
        g.vx[k] = p.vx[i];
        g.vy[k] = p.vy[i];
        g.mass[k] = p.mass[i];
        g.idx[k] = i;
    }

    for (p.cells.items) |c| {
        const lo = c.start;
        const hi = c.start + c.len;
        var ai = lo;
        while (ai < hi) : (ai += 1) p.sweep(&ctx, ai, ai + 1, hi);
        for (forward) |d| {
            const ns = p.lookup.get(hashKey(c.cx +% d[0], c.cy +% d[1])) orelse continue;
            const nc = p.cells.items[ns];
            ai = lo;
            while (ai < hi) : (ai += 1) p.sweep(&ctx, ai, nc.start, nc.start + nc.len);
        }
    }

    // scatter velocities back (pairs never move positions)
    for (g.idx[0..p.n], 0..) |i, k| {
        p.vx[i] = g.vx[k];
        p.vy[i] = g.vy[k];
    }
}

/// push (or spin) the particles within the mouse radius
fn mouseForce(p: *Physics) void {
    const m = p.mouse;
    if (!m.active) return;
    const inv = 1 / p.cell_size;
    const ccx: i64 = toInt32(m.x * inv);
    const ccy: i64 = toInt32(m.y * inv);
    const reach: i64 = @intFromFloat(@ceil(m.radius / p.cell_size));
    const r2 = m.radius * m.radius;
    const frames = p.dt * 60;
    var nx = ccx - reach;
    while (nx <= ccx + reach) : (nx += 1) {
        var ny = ccy - reach;
        while (ny <= ccy + reach) : (ny += 1) {
            const key = hashKey(@truncate(nx), @truncate(ny));
            const items = p.cellItems(key) orelse continue;
            for (items) |i| {
                // query filter
                const qx = p.x[i] - m.x;
                const qy = p.y[i] - m.y;
                if (!(qx * qx + qy * qy < r2)) continue;
                const dx = p.x[i] - m.x;
                const dy = p.y[i] - m.y;
                const d2 = dx * dx + dy * dy;
                if (!(d2 < r2 and d2 > 1e-6)) continue;
                const dist = @sqrt(d2);
                const strength = m.force * (1 - dist / m.radius) * frames;
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

/// one frame of physics; delta_ms is the frame time in milliseconds
pub fn step(p: *Physics, a: Allocator, delta_ms: f64) !void {
    p.dt = delta_ms / 1000.0;
    try p.updateHash(a);
    try p.pairs(a);
    p.wallForce();
    p.mouseForce();
    const has_shapes = p.shapes.items.len > 0;
    for (0..p.n) |i| {
        p.updateParticle(i);
        if (has_shapes) p.collide(i);
    }
}

test "step never allocates after resize" {
    const a = std.testing.allocator;
    var p: Physics = .{};
    defer p.deinit(a);
    try p.resize(a, 500);
    try p.ensureConnections(a);
    var prng = std.Random.DefaultPrng.init(7);
    const r = prng.random();
    for (0..500) |i| {
        p.x[i] = r.float(f64) * 800;
        p.y[i] = r.float(f64) * 600;
        p.radius[i] = 2.5;
        p.mass[i] = std.math.pi * 2.5 * 2.5;
    }
    // js reads and writes the columns through raw pointers between resizes,
    // so a step that reallocated anything would leave js on freed memory.
    var failing: std.testing.FailingAllocator = .init(a, .{ .fail_index = 0 });
    for (0..50) |_| try p.step(failing.allocator(), 16.6);
    try std.testing.expectEqual(@as(usize, 0), failing.allocations);
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

test "toInt32 matches js" {
    try std.testing.expectEqual(@as(i32, 3), toInt32(3.9));
    try std.testing.expectEqual(@as(i32, -3), toInt32(-3.9));
    try std.testing.expectEqual(@as(i32, 0), toInt32(std.math.nan(f64)));
    try std.testing.expectEqual(@as(i32, -2147483648), toInt32(2147483648.0));
    try std.testing.expectEqual(@as(i32, 0), toInt32(4294967296.0));
}

test "hash packs like js" {
    try std.testing.expectEqual(@as(i32, (1 << 16) | 2), hashKey(1, 2));
    try std.testing.expectEqual(@as(i32, @bitCast(@as(u32, 0xffffffff))), hashKey(-1, -1));
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
    for (0..300) |_| try p.step(a, 16.6);
    for (p.x[0..p.n], p.y[0..p.n]) |x, y| {
        try std.testing.expect(x >= 0 and x <= 800);
        try std.testing.expect(y >= 0 and y <= 600);
    }
}
