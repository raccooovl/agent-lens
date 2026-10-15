// Builds extension/data/kernel.wasm from tools/kernel.wat (needs: npm install --no-save wabt).
const fs = require('fs'), path = require('path');
require('wabt')().then(wabt => {
  const src = fs.readFileSync(path.join(__dirname, 'kernel.wat'), 'utf8');
  const mod = wabt.parseWat('kernel.wat', src, { simd: true });
  mod.validate();
  const { buffer } = mod.toBinary({});
  const out = path.join(__dirname, '../extension/data/kernel.wasm');
  fs.writeFileSync(out, Buffer.from(buffer));
  console.log(out, buffer.length, 'bytes');
});
