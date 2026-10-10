//! the webgpu path. the physics runs as WGSL compute kernels (gpu/*.wgsl,
//! embedded here and handed to js as text) and the particles never leave the
//! gpu. zig still decides everything about a frame: it packs the kernels'
//! uniforms from the same settings, mouse and shapes the cpu path uses, picks
//! the substeps, sizes the grid, budgets the connection lines and decides
//! when the crowd is at rest. src/particles/gpuPhysics.ts only moves bytes
//! and records the passes.
const std = @import("std");
const Physics = @import("physics.zig");

/// the kernels' `U` (gpu/common.wgsl), field for field
pub const Uniforms = extern struct {
    n: u32 = 0,
    cols: u32 = 1,
    rows: u32 = 1,
    ncells: u32 = 1,
    cs: f32 = 50,
    inv_cs: f32 = 1.0 / 50.0,
    r: f32 = 0,
    r2: f32 = 0,
    fs: f32 = 0,
    min_dist: f32 = 0,
    opacity: f32 = 0,
    drag: f32 = 0,
    elasticity: f32 = 0,
    gravity: f32 = 0,
    w: f32 = 0,
    h: f32 = 0,
    dt: f32 = 0,
    wall_strength: f32 = 0,
    frame: u32 = 0,
    line_cap: u32 = line_cap,
    m_active: u32 = 0,
    m_vortex: u32 = 0,
    m_down: u32 = 0,
    m_spinning: u32 = 0,
    mx: f32 = 0,
    my: f32 = 0,
    m_radius: f32 = 0,
    m_force: f32 = 0,
    m_vint: f32 = 0,
    m_speed: f32 = 1,
    build_lines: u32 = 0,
    has_attr: u32 = 0,
    line_keep: u32 = std.math.maxInt(u32),
    nshapes: u32 = 0,
    /// compact: ids kept; piston: unused
    aux: u32 = 0,
    pad: u32 = 0,
};

comptime {
    std.debug.assert(@sizeOf(Uniforms) == 144);
}

/// connection lines drawn per frame, the same budget as the webgl renderer
pub const line_cap = Physics.max_conn_verts / 2;
/// the grid's cells; a canvas too big for r-sized cells gets bigger cells
pub const max_cells = 1 << 18;
pub const max_shapes = 64;
/// a slow frame is split into steps of about 1/60 s (one big euler step on
/// the stiff repulsion shakes the crowd), at most this many
pub const max_substeps = 6;

pub const Kernel = enum { count, scan, scatter, step, clamp, compact, piston, render, blit };

/// prepended (by js, to keep the wasm small) to every kernel up to `.render`
pub const common = @embedFile("gpu/common.wgsl");
pub const shaders = [_][]const u8{
    @embedFile("gpu/count.wgsl"),
    @embedFile("gpu/scan.wgsl"),
    @embedFile("gpu/scatter.wgsl"),
    @embedFile("gpu/step.wgsl"),
    @embedFile("gpu/clamp.wgsl"),
    @embedFile("gpu/compact.wgsl"),
    @embedFile("gpu/piston.wgsl"),
    @embedFile("gpu/render.wgsl"),
    @embedFile("gpu/blit.wgsl"),
};

pub fn usesCommon(k: Kernel) bool {
    return @backingInt(k) < @backingInt(Kernel.render);
}

comptime {
    std.debug.assert(shaders.len == std.enums.values(Kernel).len);
}

/// when to stop drawing. the sim never fully stops: settled, it simmers at
/// a mean speed of ~0.015 px per 60hz frame (explicit euler on a stiff
/// repulsion). once the mean stays under `calm_below` for `calm_frames`
/// checks with nobody touching, the crowd freezes until something wakes it.
pub const Rest = struct {
    calm: u32 = 0,
    resting: bool = false,

    pub const calm_below = 0.03;
    pub const calm_frames = 120;
    /// a resting crowd that's moving this fast again isn't at rest
    pub const wake_above = 0.06;

    pub fn update(r: *Rest, mean: f64, touching: bool) bool {
        if (touching or !(mean < calm_below)) r.calm = 0 else r.calm +|= 1;
        if (r.calm >= calm_frames) r.resting = true;
        if (r.resting and (touching or mean > wake_above)) r.wake();
        return r.resting;
    }

    pub fn wake(r: *Rest) void {
        r.* = .{};
    }
};

/// a Shape as the kernels read it: (x, y, r, sides; 0 = circle), then four
/// edge normals and four offsets
pub const GpuShape = extern struct {
    c: [4]f32,
    n: [8]f32,
    off: [4]f32,
};

uni: Uniforms = .{},
shapes: [max_shapes]GpuShape = undefined,
frames: u32 = 0,
/// fraction of the lines kept, so the ones wanted fit the budget
keep: f64 = 1,
rest: Rest = .{},

const Gpu = @This();

/// substeps for a frame of `delta_ms`; packs the uniforms for one of them
pub fn frame(g: *Gpu, p: *const Physics, delta_ms: f64) u32 {
    const k: u32 = @intFromFloat(std.math.clamp(@round(delta_ms / (1000.0 / 60.0)), 1, max_substeps));
    g.pack(p, delta_ms / @as(f64, @floatFromInt(k)));
    return k;
}

pub fn pack(g: *Gpu, p: *const Physics, dt_ms: f64) void {
    const s = p.settings;
    const m = p.mouse;
    const dt = dt_ms / 1000.0;
    const r = s.interaction_radius;
    const w = s.width;
    const h = s.height;

    var cs = if (r > 0) r else 50;
    if (@ceil(w / cs) * @ceil(h / cs) > max_cells) cs = @sqrt(w * h / max_cells) * 1.01;
    const cols: u32 = @intFromFloat(@max(1, @ceil(w / cs)));
    const rows: u32 = @intFromFloat(@max(1, @ceil(h / cs)));

    var total_mass: f64 = 0;
    for (p.mass[0..p.n]) |mass| total_mass += mass;

    var nshapes: u32 = 0;
    for (p.shapes.items[0..@min(p.shapes.items.len, max_shapes)]) |sh| {
        var gs: GpuShape = .{ .c = .{ @floatCast(sh.x), @floatCast(sh.y), @floatCast(sh.r), 0 }, .n = undefined, .off = undefined };
        if (!sh.circle) gs.c[3] = @floatFromInt(sh.sides);
        for (&gs.n, sh.normals) |*d, v| d.* = @floatCast(v);
        for (&gs.off, sh.offsets) |*d, v| d.* = @floatCast(v);
        g.shapes[nshapes] = gs;
        nshapes += 1;
    }

    g.frames +%= 1;
    g.uni = .{
        .n = @intCast(p.n),
        .cols = cols,
        .rows = rows,
        .ncells = cols * rows,
        .cs = @floatCast(cs),
        .inv_cs = @floatCast(1 / cs),
        .r = @floatCast(r),
        .r2 = @floatCast(r * r),
        .fs = @floatCast(s.attract * dt),
        .min_dist = @floatCast(s.smoothing_factor * r),
        .opacity = @floatCast(s.connection_opacity),
        .drag = @floatCast(s.drag),
        .elasticity = @floatCast(s.elasticity),
        .gravity = @floatCast(s.gravity),
        .w = @floatCast(w),
        .h = @floatCast(h),
        .dt = @floatCast(dt),
        .wall_strength = @floatCast(s.attract * dt * total_mass / (w * h)),
        .frame = g.frames,
        .m_active = @intFromBool(m.active),
        .m_vortex = @intFromBool(m.vortex),
        .m_down = @intFromBool(m.down),
        .m_spinning = @intFromBool(m.spinning),
        .mx = @floatCast(m.x),
        .my = @floatCast(m.y),
        .m_radius = @floatCast(m.radius),
        .m_force = @floatCast(m.force),
        .m_vint = @floatCast(m.vortex_intensity),
        .m_speed = @floatCast(m.speed_multiplier),
        .build_lines = @intFromBool(s.build_connections and s.connection_opacity > 0.001 and r > 0),
        .has_attr = @intFromBool(@abs(s.attract) >= 1e-6 and r > 0),
        .line_keep = @intFromFloat(@floor(std.math.clamp(g.keep, 0, 1) * std.math.maxInt(u32))),
        .nshapes = nshapes,
    };
}

/// a frame's readback from the step kernel: the mean speed decides rest, the
/// lines wanted set the next frames' share. returns whether it's resting.
pub fn stats(g: *Gpu, p: *const Physics, speed_sum: u32, wanted: u32) bool {
    const n: f64 = @floatFromInt(@max(p.n, 1));
    const mean = @as(f64, @floatFromInt(speed_sum)) / 256 / n;
    const target: f64 = if (wanted > 0) @min(1, 0.9 * line_cap / @as(f64, @floatFromInt(wanted))) else 1;
    // drop at once when over budget, recover slowly so it doesn't oscillate
    g.keep = if (target < g.keep) target else g.keep * 0.9 + target * 0.1;
    return g.rest.update(mean, p.mouse.active);
}

test "uniforms line up with common.wgsl" {
    // the wgsl struct lists the fields in this order; spot-check offsets
    try std.testing.expectEqual(@as(usize, 16), @offsetOf(Uniforms, "cs"));
    try std.testing.expectEqual(@as(usize, 64), @offsetOf(Uniforms, "dt"));
    try std.testing.expectEqual(@as(usize, 80), @offsetOf(Uniforms, "m_active"));
    try std.testing.expectEqual(@as(usize, 128), @offsetOf(Uniforms, "line_keep"));
    try std.testing.expect(std.mem.indexOf(u8, common, "line_keep: u32, nshapes: u32, aux: u32, pad: u32") != null);
}

test "slow frames take 60hz substeps" {
    var p: Physics = .{};
    var g: Gpu = .{};
    try std.testing.expectEqual(@as(u32, 1), g.frame(&p, 16.7));
    try std.testing.expectEqual(@as(u32, 1), g.frame(&p, 8.3));
    try std.testing.expectEqual(@as(u32, 2), g.frame(&p, 33.3));
    try std.testing.expectApproxEqAbs(@as(f32, 0.01665), g.uni.dt, 1e-5);
    try std.testing.expectEqual(@as(u32, max_substeps), g.frame(&p, 100));
}

test "the grid never has cells smaller than r or more than max_cells" {
    var p: Physics = .{};
    var g: Gpu = .{};
    p.settings = .{ .interaction_radius = 10, .width = 7680, .height = 4320 };
    g.pack(&p, 16.7);
    try std.testing.expect(g.uni.ncells <= max_cells);
    try std.testing.expect(g.uni.cs >= 10);
    p.settings = .{ .interaction_radius = 60, .width = 1440, .height = 900 };
    g.pack(&p, 16.7);
    try std.testing.expectEqual(@as(u32, 24 * 15), g.uni.ncells);
}

test "rest waits for a calm streak and wakes on touch" {
    var r: Rest = .{};
    for (0..Rest.calm_frames - 1) |_| try std.testing.expect(!r.update(0.01, false));
    try std.testing.expect(!r.update(0.05, false)); // streak broken
    for (0..Rest.calm_frames) |_| _ = r.update(0.01, false);
    try std.testing.expect(r.resting);
    try std.testing.expect(!r.update(0.01, true));
}

test "the line share drops at once and recovers slowly" {
    var p: Physics = .{};
    var g: Gpu = .{};
    _ = g.stats(&p, 0, line_cap * 9);
    try std.testing.expectApproxEqAbs(@as(f64, 0.1), g.keep, 1e-9);
    _ = g.stats(&p, 0, 10);
    try std.testing.expect(g.keep > 0.1 and g.keep < 0.3);
}
