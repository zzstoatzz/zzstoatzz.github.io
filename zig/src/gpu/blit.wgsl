// last pass: the offscreen target (straight alpha, like the webgl canvas)
// -> the transparent page canvas (premultiplied)
@group(0) @binding(0) var src: texture_2d<f32>;
@vertex fn vs_full(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  return vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs_full(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let c = textureLoad(src, vec2i(p.xy), 0);
  let a = clamp(c.a, 0.0, 1.0);
  return vec4f(clamp(c.rgb, vec3f(0.0), vec3f(1.0)) * a, a);
}
