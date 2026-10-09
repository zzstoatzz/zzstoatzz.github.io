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

    const wasm = b.addExecutable(.{
        .name = "physics",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/wasm.zig"),
            .target = b.resolveTargetQuery(.{ .cpu_arch = .wasm32, .os_tag = .freestanding }),
            .optimize = .ReleaseFast,
            .strip = true,
        }),
    });
    wasm.entry = .disabled;
    wasm.rdynamic = true;
    const install = b.addInstallFile(wasm.getEmittedBin(), "../../public/js/particles/physics.wasm");
    b.getInstallStep().dependOn(&install.step);
    b.step("wasm", "build public/js/particles/physics.wasm").dependOn(&install.step);
}
