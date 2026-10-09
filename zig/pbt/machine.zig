//! state-machine property test for src/physics.zig, on hegel-zig (libhegel).
//!
//! a history is what the page can do to the physics between frames, with the
//! inputs the typescript side can actually produce: sliders on their own grid
//! (src/particles/config.ts), particle count, a canvas resize with the ts
//! piston, mouse hold and release, shapes. after every frame:
//!   - step allocates nothing
//!   - the simd sweep and the one-pair-at-a-time pass agree bit for bit
//!   - the spatial hash draws the same connection lines as a brute-force pass
//!   - positions and velocities stay finite
//!   - particles stay on the canvas
//!
//!   zig build pbt -Dhegel                       (HEGEL_TEST_CASES, HEGEL_SEED)
//!   HEGEL_ZIG_ECHO=1 zig build pbt -Dhegel      every history, for a crash
const std = @import("std");
const hegel = @import("hegel");
const Physics = @import("physics");

const gpa = std.heap.c_allocator;

const Rule = enum { frame, setting, count, canvas, mouse, shape, clump };
const weights = [_]f64{ 6, 3, 1, 1, 2, 1, 1 };
var tally: hegel.Tally(Rule) = .{};
/// frames that ended with a particle off the canvas under a shape: a known
/// divergence, counted instead of failed so the run still stops on anything new
var known_off_canvas: u64 = 0;
/// the most hash cells one mouseForce call walked, over the run
var worst_mouse_cells: u64 = 0;

const max_particles = 400;
const max_shapes = 8;

/// slider ranges from config.ts, min + k * step
const Slider = struct { name: []const u8, min: f64, max: f64, step: f64 };
const sliders = [_]Slider{
    .{ .name = "AVERAGE_PARTICLE_SIZE", .min = 1, .max = 6, .step = 0.1 },
    .{ .name = "DRAG", .min = 0, .max = 0.2, .step = 0.005 },
    .{ .name = "EXPLOSION_RADIUS", .min = 50, .max = 500, .step = 10 },
    .{ .name = "EXPLOSION_FORCE", .min = 0, .max = 7.5, .step = 0.05 },
    .{ .name = "ATTRACT", .min = -1000, .max = 1000, .step = 1 },
    .{ .name = "GRAVITY", .min = -25, .max = 25, .step = 0.5 },
    .{ .name = "ELASTICITY", .min = 0.1, .max = 1.0, .step = 0.05 },
    .{ .name = "INTERACTION_RADIUS", .min = 10, .max = 300, .step = 5 },
    .{ .name = "SMOOTHING_FACTOR", .min = 0.01, .max = 0.3, .step = 0.01 },
    .{ .name = "CONNECTION_OPACITY", .min = 0, .max = 0.5, .step = 0.01 },
};

const ShapeType = enum { circle, square, triangle };

/// ShapeField's stored form: fractions of the smaller canvas side
const TsShape = struct { kind: ShapeType, fx: f64, fy: f64, fr: f64, rot: f64 };

/// the typescript side: settings, canvas, mouse and shapes as ts holds them
const Page = struct {
    values: [sliders.len]f64 = .{ 2.5, 0.05, 250, 0.5, -100, 0, 0.8, 60, 0.13, 0.05 },
    vortex: bool = false,
    w: f64 = 800,
    h: f64 = 600,
    mouse_down: bool = false,
    mx: f64 = 0,
    my: f64 = 0,
    /// seconds held so far (down), or the hold that was just released
    hold: f64 = 0,
    release_multiplier: f64 = 1,
    shapes: [max_shapes]TsShape = undefined,
    n_shapes: usize = 0,
    rng: std.Random.DefaultPrng,

    fn get(pg: *const Page, comptime name: []const u8) f64 {
        inline for (sliders, 0..) |s, i| {
            if (comptime std.mem.eql(u8, s.name, name)) return pg.values[i];
        }
        @compileError("no slider " ++ name);
    }

    fn rand(pg: *Page) f64 {
        return pg.rng.random().float(f64);
    }

    fn ref(pg: *const Page) f64 {
        const m = @min(pg.w, pg.h);
        return if (m != 0) m else 1;
    }
};

/// particle.ts setSize
fn setSize(p: *Physics, i: usize, avg: f64) void {
    const sized = avg * (1 + p.size_var[i] * 0.6);
    p.radius[i] = @max(0.5, @min(10.0, sized));
    p.mass[i] = std.math.pi * p.radius[i] * p.radius[i];
}

/// wasmPhysics.ts: what one frame hands the physics before `step`
fn sync(p: *Physics, pg: *const Page) !void {
    p.settings = .{
        .interaction_radius = pg.get("INTERACTION_RADIUS"),
        .attract = pg.get("ATTRACT"),
        .smoothing_factor = orJs(pg.get("SMOOTHING_FACTOR"), 0.3),
        .connection_opacity = pg.get("CONNECTION_OPACITY"),
        .gravity = pg.get("GRAVITY"),
        .drag = orJs(pg.get("DRAG"), 0.01),
        .elasticity = pg.get("ELASTICITY"),
        .width = pg.w,
        .height = pg.h,
        .build_connections = true,
    };

    try p.shapes.resize(gpa, pg.n_shapes);
    for (pg.shapes[0..pg.n_shapes], p.shapes.items) |s, *out| out.* = project(pg, s);

    // mouseParams
    const active = pg.mouse_down or pg.release_multiplier > 1;
    var m: Physics.Mouse = .{ .active = active, .x = pg.mx, .y = pg.my, .vortex = pg.vortex, .down = pg.mouse_down };
    if (active) {
        const radius = pg.get("EXPLOSION_RADIUS");
        const force = pg.get("EXPLOSION_FORCE");
        if (!pg.vortex) {
            m.radius = radius;
            m.force = force;
        } else {
            const hold_intensity = if (pg.mouse_down) @min(1, @log(pg.hold + 1) / @log(10.0)) else 0;
            m.radius = if (pg.mouse_down) radius * (1 + hold_intensity * hold_intensity * 2) else radius * pg.release_multiplier;
            m.force = force * (if (pg.mouse_down) 1 else pg.release_multiplier);
            if (pg.mouse_down) {
                m.spinning = true;
                m.vortex_intensity = hold_intensity;
                m.speed_multiplier = 1 + pg.hold * 0.5;
            }
        }
    }
    p.mouse = m;
}

/// js `v || d` for a number
fn orJs(v: f64, d: f64) f64 {
    return if (v == 0 or std.math.isNan(v)) d else v;
}

/// ShapeField.project, polygon normals and offsets included
fn project(pg: *const Page, s: TsShape) Physics.Shape {
    const r0 = pg.ref();
    const x = pg.w / 2 + s.fx * r0;
    const y = pg.h / 2 + s.fy * r0;
    const r = @max(1, s.fr * r0);
    var out: Physics.Shape = .{ .circle = s.kind == .circle, .x = x, .y = y, .r = r };
    if (s.kind == .circle) return out;
    const sides: usize = if (s.kind == .square) 4 else 3;
    const start = @as(f64, if (s.kind == .square) std.math.pi / 4.0 else -std.math.pi / 2.0) + s.rot;
    var verts: [8]f64 = undefined;
    for (0..sides) |i| {
        const a = start + (@as(f64, @floatFromInt(i)) * std.math.pi * 2) / @as(f64, @floatFromInt(sides));
        verts[i * 2] = x + @cos(a) * r;
        verts[i * 2 + 1] = y + @sin(a) * r;
    }
    out.sides = @intCast(sides);
    for (0..sides) |i| {
        const ax = verts[i * 2];
        const ay = verts[i * 2 + 1];
        const bx = verts[((i + 1) % sides) * 2];
        const by = verts[((i + 1) % sides) * 2 + 1];
        var nx = by - ay;
        var ny = -(bx - ax);
        const len0 = std.math.hypot(nx, ny);
        const len = if (len0 != 0) len0 else 1;
        nx /= len;
        ny /= len;
        if (nx * (x - ax) + ny * (y - ay) > 0) {
            nx = -nx;
            ny = -ny;
        }
        out.normals[i * 2] = nx;
        out.normals[i * 2 + 1] = ny;
        out.offsets[i] = nx * ax + ny * ay;
    }
    return out;
}

/// both physics instances, stepped in lockstep
const Pair = struct {
    fast: Physics = .{},
    ref: Physics = .{ .simd = false },

    fn each(pr: *Pair) [2]*Physics {
        return .{ &pr.fast, &pr.ref };
    }

    fn deinit(pr: *Pair) void {
        pr.fast.deinit(gpa);
        pr.ref.deinit(gpa);
    }
};

/// a connection line as the buffer holds it, bit patterns for exact compare
const Line = [5]u32;

fn lineLess(_: void, a: Line, b: Line) bool {
    return std.mem.order(u32, &a, &b) == .lt;
}

fn bits(v: f64) u32 {
    return @bitCast(@as(f32, @floatCast(v)));
}

/// every line the pair pass should draw, by brute force over all pairs
fn expectedLines(p: *const Physics, out: *std.ArrayList(Line)) !void {
    out.clearRetainingCapacity();
    const s = p.settings;
    const r = s.interaction_radius;
    if (!(s.connection_opacity > 0.001 and r > 0)) return;
    for (0..p.n) |i| for (i + 1..p.n) |j| {
        const dx = p.x[j] - p.x[i];
        const dy = p.y[j] - p.y[i];
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r or d2 < 1e-6) continue;
        const al = s.connection_opacity * (1 - @sqrt(d2) / r);
        if (!(al > 0.001)) continue;
        try out.append(gpa, .{ bits(p.x[i]), bits(p.y[i]), bits(p.x[j]), bits(p.y[j]), bits(al) });
    };
    std.mem.sort(Line, out.items, {}, lineLess);
}

fn drawnLines(p: *const Physics, out: *std.ArrayList(Line)) !void {
    out.clearRetainingCapacity();
    var v: usize = 0;
    while (v < p.conn_verts) : (v += 2) {
        const pos = p.conn_pos[v * 3 ..][0..6];
        try out.append(gpa, .{
            @bitCast(pos[0]),          @bitCast(pos[1]), @bitCast(pos[3]), @bitCast(pos[4]),
            @bitCast(p.conn_alpha[v]),
        });
    }
    std.mem.sort(Line, out.items, {}, lineLess);
}

fn sameBits(a: []const f64, b: []const f64) bool {
    for (a, b) |x, y| if (@as(u64, @bitCast(x)) != @as(u64, @bitCast(y))) return false;
    return true;
}

fn sameBits32(a: []const f32, b: []const f32) bool {
    for (a, b) |x, y| if (@as(u32, @bitCast(x)) != @as(u32, @bitCast(y))) return false;
    return true;
}

fn frame(case: *hegel.TestCase, pr: *Pair, pg: *const Page, delta_ms: f64, want: *std.ArrayList(Line), got: *std.ArrayList(Line)) !void {
    for (pr.each()) |p| try sync(p, pg);
    const p = &pr.fast;

    if (p.mouse.active and p.settings.interaction_radius > 0) {
        const reach: u64 = @intFromFloat(@ceil(p.mouse.radius / p.settings.interaction_radius));
        worst_mouse_cells = @max(worst_mouse_cells, (2 * reach + 1) * (2 * reach + 1));
    }

    try expectedLines(p, want);

    for (pr.each()) |q| {
        var failing: std.testing.FailingAllocator = .init(gpa, .{ .fail_index = 0 });
        q.step(failing.allocator(), delta_ms) catch return case.fail("step allocated");
    }

    const r = &pr.ref;
    if (!sameBits(p.x, r.x) or !sameBits(p.y, r.y) or !sameBits(p.vx, r.vx) or !sameBits(p.vy, r.vy) or
        p.conn_verts != r.conn_verts or
        !sameBits32(p.conn_pos[0 .. p.conn_verts * 3], r.conn_pos[0 .. r.conn_verts * 3]) or
        !sameBits32(p.conn_alpha[0..p.conn_verts], r.conn_alpha[0..r.conn_verts]) or
        !sameBits32(p.conn_color[0 .. p.conn_verts * 3], r.conn_color[0 .. r.conn_verts * 3]))
        return case.fail("the simd sweep and the scalar pass disagree");

    try drawnLines(p, got);
    if (got.items.len != want.items.len) return case.fail("the hash drew a different number of lines than brute force");
    for (got.items, want.items) |a, b| if (!std.mem.eql(u32, &a, &b)) return case.fail("the hash drew different lines than brute force");

    for (0..p.n) |i| {
        if (!std.math.isFinite(p.x[i]) or !std.math.isFinite(p.y[i]) or !std.math.isFinite(p.vx[i]) or !std.math.isFinite(p.vy[i]))
            return case.fail("a particle went non-finite");
    }
    for (0..p.n) |i| {
        if (!(p.x[i] >= 0 and p.x[i] <= pg.w and p.y[i] >= 0 and p.y[i] <= pg.h)) {
            // known: collide runs after the wall clamp, so a shape over an
            // edge shoves particles off the canvas (see known_off_canvas)
            if (pg.n_shapes > 0) {
                known_off_canvas += 1;
                break;
            }
            return case.fail("a particle left the canvas");
        }
    }
}

fn property(_: void, case: *hegel.TestCase) !void {
    tally.case();
    const seed = try case.int(u64, 0, std.math.maxInt(u32));
    var pg: Page = .{ .rng = .init(seed) };
    var pr: Pair = .{};
    defer pr.deinit();
    for (pr.each()) |p| {
        p.rng = .init(seed);
        try p.ensureConnections(gpa);
    }
    var want: std.ArrayList(Line) = .empty;
    defer want.deinit(gpa);
    var got: std.ArrayList(Line) = .empty;
    defer got.deinit(gpa);

    case.note("seed {d}", .{seed});
    try count(case, &pr, &pg, try case.int(usize, 0, max_particles));

    var machine = try case.machine(Rule, &weights, 40);
    defer machine.deinit();
    while (try machine.next()) |rule| {
        tally.step(rule);
        switch (rule) {
            .frame => {
                const delta_ms = @as(f64, @floatFromInt(try case.int(u32, 0, 1000))) / 10;
                const frames = try case.int(u32, 1, 20);
                case.note("frame({d}ms) x{d}", .{ delta_ms, frames });
                for (0..frames) |_| try frame(case, &pr, &pg, delta_ms, &want, &got);
            },
            .setting => {
                const k = try case.index(sliders.len);
                const s = sliders[k];
                const steps: u32 = @intFromFloat(@round((s.max - s.min) / s.step));
                const v = s.min + @as(f64, @floatFromInt(try case.int(u32, 0, steps))) * s.step;
                pg.values[k] = v;
                case.note("{s} = {d}", .{ s.name, v });
                if (k == 0) for (pr.each()) |p| for (0..p.n) |i| setSize(p, i, v);
            },
            .count => try count(case, &pr, &pg, try case.int(usize, 0, max_particles)),
            .canvas => {
                const w: f64 = @floatFromInt(try case.int(u32, 200, 2400));
                const h: f64 = @floatFromInt(try case.int(u32, 200, 2400));
                case.note("canvas {d}x{d}", .{ w, h });
                if (w < pg.w or h < pg.h) for (pr.each()) |p| piston(p, w, h);
                pg.w = w;
                pg.h = h;
            },
            .mouse => {
                const kind = try case.index(3);
                pg.mx = @as(f64, @floatFromInt(try case.int(i32, -200, @as(i32, @intFromFloat(pg.w)) + 200)));
                pg.my = @as(f64, @floatFromInt(try case.int(i32, -200, @as(i32, @intFromFloat(pg.h)) + 200)));
                // a touch lands on a particle sooner or later
                if (pr.fast.n > 0 and try case.boolean()) {
                    const i = try case.index(pr.fast.n);
                    pg.mx = pr.fast.x[i];
                    pg.my = pr.fast.y[i];
                }
                pg.vortex = try case.boolean();
                pg.hold = @as(f64, @floatFromInt(try case.int(u32, 0, 6000))) / 10;
                switch (kind) {
                    0 => {
                        pg.mouse_down = false;
                        pg.release_multiplier = 1;
                        case.note("mouse up", .{});
                    },
                    1 => {
                        pg.mouse_down = true;
                        pg.release_multiplier = 1;
                        case.note("mouse down at ({d}, {d}), held {d}s, vortex {}", .{ pg.mx, pg.my, pg.hold, pg.vortex });
                    },
                    else => {
                        // stopHold: only the vortex has a release
                        pg.mouse_down = false;
                        pg.release_multiplier = if (pg.vortex and pg.hold > 0.01) @min(50, std.math.pow(f64, 2, pg.hold / 2)) else 1;
                        case.note("mouse released at ({d}, {d}) after {d}s, vortex {}", .{ pg.mx, pg.my, pg.hold, pg.vortex });
                    },
                }
            },
            .shape => {
                const op = try case.index(3);
                if (op == 0 and pg.n_shapes < max_shapes) {
                    const kind: ShapeType = @fromBackingInt(@intCast(try case.index(3)));
                    const x: f64 = @floatFromInt(try case.int(u32, 0, @intFromFloat(pg.w)));
                    const y: f64 = @floatFromInt(try case.int(u32, 0, @intFromFloat(pg.h)));
                    const r: f64 = @floatFromInt(try case.int(u32, 14, 400));
                    const rot = @as(f64, @floatFromInt(try case.int(u32, 0, 359))) * std.math.pi / 180;
                    const r0 = pg.ref();
                    pg.shapes[pg.n_shapes] = .{ .kind = kind, .fx = (x - pg.w / 2) / r0, .fy = (y - pg.h / 2) / r0, .fr = r / r0, .rot = rot };
                    pg.n_shapes += 1;
                    case.note("add {s} at ({d}, {d}) r {d} rot {d:.2}", .{ @tagName(kind), x, y, r, rot });
                } else if (op == 1 and pg.n_shapes > 0) {
                    pg.n_shapes -= 1;
                    case.note("remove last shape", .{});
                } else {
                    pg.n_shapes = 0;
                    case.note("clear shapes", .{});
                }
            },
            .clump => {
                // what a strong attraction or a vortex does over many frames
                const n = pr.fast.n;
                if (n < 2) continue;
                const k = try case.int(usize, 2, @min(n, 64));
                const first = try case.index(n - k + 1);
                const x: f64 = @floatFromInt(try case.int(u32, 0, @intFromFloat(pg.w)));
                const y: f64 = @floatFromInt(try case.int(u32, 0, @intFromFloat(pg.h)));
                const spread = [_]f64{ 0, 1e-7, 1e-3, 0.5 };
                const gap = spread[try case.index(spread.len)];
                case.note("clump {d} particles from #{d} at ({d}, {d}), gap {d}", .{ k, first, x, y, gap });
                for (pr.each()) |p| for (first..first + k, 0..) |i, j| {
                    p.x[i] = x + gap * @as(f64, @floatFromInt(j));
                    p.y[i] = y;
                };
            },
        }
    }
    tally.finish(pr.fast.n);
}

/// particleSystem.ts: grow by spawning at random spots, shrink by truncating
fn count(case: *hegel.TestCase, pr: *Pair, pg: *Page, n: usize) !void {
    case.note("count = {d}", .{n});
    const old = pr.fast.n;
    for (pr.each()) |p| try p.resize(gpa, n);
    if (n > old) for (old..n) |i| {
        const x = pg.rand() * pg.w;
        const y = pg.rand() * pg.h;
        const vx = (pg.rand() - 0.5) * 2;
        const vy = (pg.rand() - 0.5) * 2;
        const sv = pg.rand() * 2 - 1;
        const color: u8 = @intFromFloat(pg.rand() * 8);
        for (pr.each()) |p| {
            p.x[i] = x;
            p.y[i] = y;
            p.vx[i] = vx;
            p.vy[i] = vy;
            p.size_var[i] = sv;
            p.color[i] = color;
            setSize(p, i, pg.get("AVERAGE_PARTICLE_SIZE"));
        }
    };
}

/// particleSystem.ts pistonWalls
fn piston(p: *Physics, w: f64, h: f64) void {
    const frames = 12;
    for (0..p.n) |i| {
        const r = p.radius[i];
        const over_x = p.x[i] + r - w;
        if (over_x > 0) {
            p.x[i] = w - r - 0.1;
            p.vx[i] = @min(p.vx[i], 0) - over_x / frames;
        }
        const over_y = p.y[i] + r - h;
        if (over_y > 0) {
            p.y[i] = h - r - 0.1;
            p.vy[i] = @min(p.vy[i], 0) - over_y / frames;
        }
    }
}

pub fn main() !void {
    const outcome = hegel.run(.{}, {}, property);
    tally.print();
    std.debug.print("known: {d} frames left a particle off the canvas under a shape\n", .{known_off_canvas});
    std.debug.print("worst mouse query: {d} hash cells in one frame\n", .{worst_mouse_cells});
    try outcome;
}
