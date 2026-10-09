const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const tests = b.addTest(.{ .root_module = b.createModule(.{
        .root_source_file = b.path("src/physics.zig"),
        .target = target,
        .optimize = optimize,
    }) });
    b.step("test", "run unit tests").dependOn(&b.addRunArtifact(tests).step);

    // physics.wasm: current browsers, with simd128 (safari 16.4+, chrome and
    // firefox 91+). physics-nosimd.wasm: the same code for the baseline wasm
    // every browser since 2017 runs.
    const step = b.step("wasm", "build public/js/particles/physics{,-nosimd}.wasm");
    addWasm(b, step, "physics", &std.Target.wasm.cpu.generic, &.{.simd128});
    addWasm(b, step, "physics-nosimd", &std.Target.wasm.cpu.mvp, &.{});
    b.getInstallStep().dependOn(step);
}

fn addWasm(
    b: *std.Build,
    step: *std.Build.Step,
    name: []const u8,
    model: *const std.Target.Cpu.Model,
    features: []const std.Target.wasm.Feature,
) void {
    const wasm = b.addExecutable(.{
        .name = name,
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/wasm.zig"),
            .target = b.resolveTargetQuery(.{
                .cpu_arch = .wasm32,
                .os_tag = .freestanding,
                .cpu_model = .{ .explicit = model },
                .cpu_features_add = std.Target.wasm.featureSet(features),
            }),
            .optimize = .ReleaseFast,
            .strip = true,
        }),
    });
    wasm.entry = .disabled;
    wasm.rdynamic = true;
    const install = b.addInstallFile(wasm.getEmittedBin(), b.fmt("../../public/js/particles/{s}.wasm", .{name}));
    step.dependOn(&install.step);
}
