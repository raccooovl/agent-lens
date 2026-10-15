;; Agent Lens matching kernel: correlation of one image patch with many icon templates, four values at a time.
;; update(patch, n4, tpl, norms, idx, T, sd, out):
;;   for j in 0..T-1: t = idx[j]; dot = sum_i patch[i] * tpl[t*n4 + i]  (f32, i in 0..n4-1, zero padded)
;;                    out[j] = max(out[j], dot / (sd * norms[t]))      (out and norms are f64)
(module
  (memory (export "memory") 2)
  (func (export "update")
    (param $patch i32) (param $n4 i32) (param $tpl i32) (param $norms i32) (param $idx i32) (param $T i32) (param $sd f64) (param $out i32)
    (local $j i32) (local $t i32) (local $p i32) (local $q i32) (local $end i32) (local $acc v128) (local $dot f64) (local $ncc f64) (local $o i32)
    (local.set $j (i32.const 0))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $j) (local.get $T)))
        (local.set $t (i32.load (i32.add (local.get $idx) (i32.shl (local.get $j) (i32.const 2)))))
        ;; q: start of template t; p: patch; end: patch + n4*4
        (local.set $q (i32.add (local.get $tpl) (i32.shl (i32.mul (local.get $t) (local.get $n4)) (i32.const 2))))
        (local.set $p (local.get $patch))
        (local.set $end (i32.add (local.get $patch) (i32.shl (local.get $n4) (i32.const 2))))
        (local.set $acc (f32x4.splat (f32.const 0)))
        (block $sumd
          (loop $sum
            (br_if $sumd (i32.ge_u (local.get $p) (local.get $end)))
            (local.set $acc (f32x4.add (local.get $acc) (f32x4.mul (v128.load (local.get $p)) (v128.load (local.get $q)))))
            (local.set $p (i32.add (local.get $p) (i32.const 16)))
            (local.set $q (i32.add (local.get $q) (i32.const 16)))
            (br $sum)))
        (local.set $dot (f64.add
          (f64.add (f64.promote_f32 (f32x4.extract_lane 0 (local.get $acc))) (f64.promote_f32 (f32x4.extract_lane 1 (local.get $acc))))
          (f64.add (f64.promote_f32 (f32x4.extract_lane 2 (local.get $acc))) (f64.promote_f32 (f32x4.extract_lane 3 (local.get $acc))))))
        (local.set $ncc (f64.div (local.get $dot)
          (f64.mul (local.get $sd) (f64.load (i32.add (local.get $norms) (i32.shl (local.get $t) (i32.const 3)))))))
        (local.set $o (i32.add (local.get $out) (i32.shl (local.get $j) (i32.const 3))))
        (if (f64.gt (local.get $ncc) (f64.load (local.get $o))) (then (f64.store (local.get $o) (local.get $ncc))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $each)))))
