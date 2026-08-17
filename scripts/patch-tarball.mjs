// scripts/patch-tarball.mjs
//
// npm pack on Windows writes bin/cli.js into the tarball with mode 000644,
// because NTFS has no Unix executable bit. npm publish then strips the bin
// entry ("invalid and removed"), leaving the published package with no
// `preflight` command. This script patches the tar header mode to 000755 and
// recomputes the header checksum, so the tarball can be published as-is.

import fs from 'node:fs';
import zlib from 'node:zlib';

const fn = process.argv[2];
if (!fn) {
  console.error('usage: node scripts/patch-tarball.mjs <file.tgz>');
  process.exit(1);
}

const tgz = fs.readFileSync(fn);
const tar = zlib.gunzipSync(tgz);

// Walk the tar headers to find package/bin/cli.js.
let off = 0;
let target = null;
while (off < tar.length) {
  const name = tar.slice(off, off + 100).toString('latin1').replace(/\0.*$/, '');
  const size = parseInt(
    tar.slice(off + 124, off + 136).toString('latin1').trim().replace(/\0.*$/, '') || '0',
    8
  );
  if (name === 'package/bin/cli.js') {
    target = { off, size };
    break;
  }
  const block = Math.ceil(size / 512);
  off += 512 + block * 512;
  if (!name) break;
}

if (!target) {
  console.error('package/bin/cli.js not found in tarball');
  process.exit(1);
}

// Patch the mode field (bytes 100-107) to 000755.
tar.write('000755 ', target.off + 100, 'latin1');

// Recompute the header checksum: sum all 512 header bytes with the checksum
// field (bytes 148-155) treated as spaces, then write the octal sum.
const chkOff = target.off + 148;
tar.fill(0x20, chkOff, chkOff + 8);
let sum = 0;
for (let i = 0; i < 512; i += 1) sum += tar[target.off + i];
const chk = sum.toString(8).padStart(6, '0') + '\0 ';
tar.write(chk, chkOff, 'latin1');

fs.writeFileSync(fn, zlib.gzipSync(tar));
console.log(`patched ${fn}: package/bin/cli.js mode -> 000755, checksum ${chk.trim()}`);