//! wasm exports for public/js/particles/wasmPhysics.js
const std = @import("std");
const Physics = @import("physics.zig");

const gpa = std.heap.wasm_allocator;
var p: Physics = .{};

/// resize to n particles, keeping existing ones; returns false on oom. the
/// column pointers below move only here: `step` never grows memory.
export fn setCount(n: u32) bool {
    p.resize(gpa, n) catch return false;
    p.ensureConnections(gpa) catch return false;
    return true;
}

export fn xPtr() [*]f64 {
    return p.x.ptr;
}
export fn yPtr() [*]f64 {
    return p.y.ptr;
}
export fn vxPtr() [*]f64 {
    return p.vx.ptr;
}
export fn vyPtr() [*]f64 {
    return p.vy.ptr;
}
export fn radiusPtr() [*]f64 {
    return p.radius.ptr;
}
export fn massPtr() [*]f64 {
    return p.mass.ptr;
}
export fn sizeVarPtr() [*]f64 {
    return p.size_var.ptr;
}
export fn colorPtr() [*]u8 {
    return p.color.ptr;
}
export fn palettePtr() [*]f64 {
    return @ptrCast(&p.palette);
}
export fn connPosPtr() [*]f32 {
    return p.conn_pos.ptr;
}
export fn connAlphaPtr() [*]f32 {
    return p.conn_alpha.ptr;
}
export fn connColorPtr() [*]f32 {
    return p.conn_color.ptr;
}
export fn connVerts() u32 {
    return p.conn_verts;
}

export fn setSettings(
    interaction_radius: f64,
    attract: f64,
    smoothing_factor: f64,
    connection_opacity: f64,
    gravity: f64,
    drag: f64,
    elasticity: f64,
    width: f64,
    height: f64,
    build_connections: bool,
) void {
    p.settings = .{
        .interaction_radius = interaction_radius,
        .attract = attract,
        .smoothing_factor = smoothing_factor,
        .connection_opacity = connection_opacity,
        .gravity = gravity,
        .drag = drag,
        .elasticity = elasticity,
        .width = width,
        .height = height,
        .build_connections = build_connections,
    };
}

export fn setMouse(
    active: bool,
    x: f64,
    y: f64,
    radius: f64,
    force: f64,
    vortex: bool,
    down: bool,
    spinning: bool,
    vortex_intensity: f64,
    speed_multiplier: f64,
) void {
    p.mouse = .{
        .active = active,
        .x = x,
        .y = y,
        .radius = radius,
        .force = force,
        .vortex = vortex,
        .down = down,
        .spinning = spinning,
        .vortex_intensity = vortex_intensity,
        .speed_multiplier = speed_multiplier,
    };
}

export fn setShapeCount(n: u32) bool {
    p.shapes.resize(gpa, n) catch return false;
    return true;
}

export fn setShape(
    i: u32,
    circle: bool,
    x: f64,
    y: f64,
    r: f64,
    sides: u32,
    n0: f64,
    n1: f64,
    n2: f64,
    n3: f64,
    n4: f64,
    n5: f64,
    n6: f64,
    n7: f64,
    o0: f64,
    o1: f64,
    o2: f64,
    o3: f64,
) void {
    p.shapes.items[i] = .{
        .circle = circle,
        .x = x,
        .y = y,
        .r = r,
        .sides = @min(sides, 4),
        .normals = .{ n0, n1, n2, n3, n4, n5, n6, n7 },
        .offsets = .{ o0, o1, o2, o3 },
    };
}

export fn seed(s: u32) void {
    p.rng = .init(s);
}

export fn step(delta_ms: f64) bool {
    p.step(gpa, delta_ms) catch return false;
    return true;
}
