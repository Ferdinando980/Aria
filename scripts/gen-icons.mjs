import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '..', 'public')
const iconsDir = path.join(publicDir, 'icons')
mkdirSync(iconsDir, { recursive: true })

// Friendly "core" mark: a soft rounded square with a glowing orbit dot,
// evoking an arc-reactor / companion AI without copying any brand.
const svg = (bg = true, pad = 0) => `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  ${bg ? `<defs>
    <radialGradient id="g" cx="35%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#8B7CF6"/>
      <stop offset="55%" stop-color="#6C5CE7"/>
      <stop offset="100%" stop-color="#4B3FBF"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="120" fill="url(#g)"/>` : ''}
  <g transform="translate(${256},${256})">
    <circle r="${150 - pad}" fill="none" stroke="#F5F3FF" stroke-width="14" opacity="0.35"/>
    <circle r="${104 - pad}" fill="none" stroke="#F5F3FF" stroke-width="14" opacity="0.6"/>
    <circle r="${52 - pad}" fill="#FDCB6E"/>
    <circle cx="${150 - pad}" cy="0" r="18" fill="#FDCB6E"/>
  </g>
</svg>`

async function run() {
  writeFileSync(path.join(publicDir, 'favicon.svg'), svg(true))

  await sharp(Buffer.from(svg(true))).resize(192, 192).png().toFile(path.join(iconsDir, 'icon-192.png'))
  await sharp(Buffer.from(svg(true))).resize(512, 512).png().toFile(path.join(iconsDir, 'icon-512.png'))
  // Maskable: keep safe-zone padding so platforms can crop to a circle
  await sharp(Buffer.from(svg(true, 40))).resize(512, 512).png().toFile(path.join(iconsDir, 'icon-512-maskable.png'))
  // Apple touch icon (no transparency, square)
  await sharp(Buffer.from(svg(true))).resize(180, 180).png().toFile(path.join(iconsDir, 'apple-touch-icon.png'))
  await sharp(Buffer.from(svg(true))).resize(64, 64).png().toFile(path.join(publicDir, 'favicon.png'))

  console.log('Icons generated in', iconsDir)
}

run()
