// MAP-2 — side by side, on meadow grass: what works and what is scenery.
// Top row: the props a player can work (a zone's tree, pine and rock, with
// their marks). Bottom row: the same kinds outside the zones, as backdrop.
//
//   npx vite-node scripts/map/backdrop-contrast.ts -- docs/design/map-2/backdrop-contrast.png
//
// DESIGN TOOL. Reads the art modules, writes one PNG.

import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { backdropRockArt, backdropTreeArt } from '../../src/features/skills/scene/art/backdropArt'
import { loggingTreeArt } from '../../src/features/skills/scene/art/loggingTrees'
import { miningNodeArt } from '../../src/features/skills/scene/art/miningNodes'
import type { PixelArt } from '../../src/features/skills/scene/art/pixelArt'

const OUT = process.argv.slice(2).find(arg => arg !== '--') ?? 'docs/design/map-2/backdrop-contrast.png'
const SCALE = 5
const CELL = 52
const row1 = [loggingTreeArt('common_tree', 'tree', 'ready'), loggingTreeArt('pine_tree', 'pine', 'ready'), miningNodeArt('stone_outcrop', 'rock', 'ready')]
const row2 = [backdropTreeArt('tree'), backdropTreeArt('pine'), backdropRockArt('rock')]
const W = CELL * 3, H = CELL * 2
const px = new Uint8Array(W * H * 3)
for (let i = 0; i < W * H; i++) { px[i * 3] = 150; px[i * 3 + 1] = 196; px[i * 3 + 2] = 110 }
function stamp(art: PixelArt, cx: number, baseY: number) {
  for (let y = 0; y < art.h; y++) for (let x = 0; x < art.w; x++) {
    const v = art.pixels[y * art.w + x]
    const a = (v >>> 24) / 255
    if (!a) continue
    const tx = Math.round(cx - art.ax + x), ty = Math.round(baseY - art.ay + y)
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
    const i = (ty * W + tx) * 3
    px[i] = px[i] * (1 - a) + (v & 255) * a
    px[i + 1] = px[i + 1] * (1 - a) + ((v >>> 8) & 255) * a
    px[i + 2] = px[i + 2] * (1 - a) + ((v >>> 16) & 255) * a
  }
}
row1.forEach((art, i) => stamp(art, CELL * i + CELL / 2, CELL - 4))
row2.forEach((art, i) => stamp(art, CELL * i + CELL / 2, CELL * 2 - 4))
const w = W * SCALE, h = H * SCALE
const raw = Buffer.alloc((w * 3 + 1) * h)
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const s = (Math.floor(y / SCALE) * W + Math.floor(x / SCALE)) * 3
  const d = y * (w * 3 + 1) + 1 + x * 3
  raw[d] = px[s]; raw[d + 1] = px[s + 1]; raw[d + 2] = px[s + 2]
}
const table = Array.from({ length: 256 }, (_, n) => { let v = n; for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1; return v >>> 0 })
const crc = (buf: Buffer) => { let v = 0xffffffff; for (const b of buf) v = table[(v ^ b) & 0xff] ^ (v >>> 8); return (v ^ 0xffffffff) >>> 0 }
const chunk = (type: string, body: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const tb = Buffer.concat([Buffer.from(type), body]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(tb)); return Buffer.concat([len, tb, c]) }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
writeFileSync(OUT, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
process.stdout.write(`wrote ${OUT}\n`)
