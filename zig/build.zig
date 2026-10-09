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

    if (b.option(bool, "hegel", "build the property tests (builds libhegel once, needs cargo)") orelse false) {
        if (b.lazyDependency("hegel", .{ .target = target, .optimize = optimize })) |hegel| {
            const pbt = b.addExecutable(.{
                .name = "pbt",
                .root_module = b.createModule(.{
                    .root_source_file = b.path("pbt/machine.zig"),
                    .target = target,
                    .optimize = optimize,
                    .imports = &.{
                        .{ .name = "hegel", .module = hegel.module("hegel") },
                        .{ .name = "physics", .module = b.createModule(.{
                            .root_source_file = b.path("src/physics.zig"),
                            .target = target,
                            .optimize = optimize,
                        }) },
                    },
                }),
            });
            // libhegel is rust; its std unwinds through libgcc_s on linux
            if (target.result.os.tag == .linux) pbt.root_module.linkSystemLibrary("gcc_s", .{});
            const run = b.addRunArtifact(pbt);
            run.addPassthruArgs();
            b.step("pbt", "run the physics state-machine property test").dependOn(&run.step);
        }
    }

    // physics.wasm: current browsers, with simd128 (safari 16.4+, chrome and
    // firefox 91+). physics-nosimd.wasm: the same code for the baseline wasm
    // every browser since 2017 runs.
    const step = b.step("wasm", "build src/particles/physics{,-nosimd}.wasm");
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
    const install = b.addInstallFile(wasm.getEmittedBin(), b.fmt("../../src/particles/{s}.wasm", .{name}));
    step.dependOn(&install.step);
}
