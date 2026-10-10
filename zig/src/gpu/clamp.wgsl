// 5. the line counter ran past the buffer when over budget; cap it so the
// indirect draw reads only lines that were written
@group(0) @binding(1) var<storage, read_write> args: array<u32>;

@compute @workgroup_size(1) fn main() {
  args[1] = min(args[1], u.line_cap);
}
