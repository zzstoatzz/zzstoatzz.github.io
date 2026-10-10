// 2. cell counts -> cell starts (exclusive prefix sum) in one workgroup: each
// thread sums a contiguous chunk of cells, the 256 chunk sums get a
// hillis-steele scan in shared memory, then each thread writes its chunk.
@group(0) @binding(1) var<storage, read> counts: array<u32>;
@group(0) @binding(2) var<storage, read_write> starts: array<u32>;
var<workgroup> sums: array<u32, 256>;

@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) t: u32) {
  let nc = u.ncells;
  let k = (nc + 255u) / 256u;
  let lo = min(t * k, nc);
  let hi = min(lo + k, nc);
  var s = 0u;
  for (var c = lo; c < hi; c++) { s += counts[c]; }
  sums[t] = s;
  workgroupBarrier();
  for (var off = 1u; off < 256u; off <<= 1u) {
    var v = 0u;
    if (t >= off) { v = sums[t - off]; }
    workgroupBarrier();
    sums[t] += v;
    workgroupBarrier();
  }
  var run = sums[t] - s;
  for (var c = lo; c < hi; c++) {
    starts[c] = run;
    run += counts[c];
  }
  if (t == 255u) { starts[nc] = sums[255]; }
}
