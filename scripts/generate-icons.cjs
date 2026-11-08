/**
 * AtomBook Icon Generator
 *
 * Input 1: PNG with background
 * Input 2: Transparent PNG (symbol only)
 *
 * Usage:
 * node scripts/generate-icons.cjs ./brand/atombook-bg.png ./brand/atombook-transparent.png
 */

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const pngToIcoModule = require('png-to-ico');

const pngToIco =
  typeof pngToIcoModule === 'function'
    ? pngToIcoModule
    : pngToIcoModule.default;

const ROOT = process.cwd();
const bgInput = process.argv[2];
const fgInput = process.argv[3];

const ANDROID_BG = '#101B3A';

if (!bgInput || !fgInput) {
  console.log(`
AtomBook Icon Generator

Usage:
node scripts/generate-icons.cjs <background.png> <transparent.png>

Example:
node scripts/generate-icons.cjs ./brand/atombook-bg.png ./brand/atombook-transparent.png
`);
  process.exit(1);
}

const bgPath = path.resolve(bgInput);
const fgPath = path.resolve(fgInput);

for (const file of [bgPath, fgPath]) {
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }
}

const densities = [
  { name: 'mdpi', size: 48 },
  { name: 'hdpi', size: 72 },
  { name: 'xhdpi', size: 96 },
  { name: 'xxhdpi', size: 144 },
  { name: 'xxxhdpi', size: 192 },
];

async function save(buffer, destination) {
  await fs.promises.mkdir(path.dirname(destination), {
    recursive: true,
  });

  await fs.promises.writeFile(destination, buffer);

  console.log('✓', path.relative(ROOT, destination));
}

// Complete logo with background
async function makeBackgroundIcon(size) {
  return sharp(bgPath)
    .rotate()
    .resize(size, size, {
      fit: 'contain',
      background: ANDROID_BG,
    })
    .png()
    .toBuffer();
}

// Transparent foreground for Android adaptive icons
async function makeForegroundIcon(size) {
  const safeSize = Math.round(size * 0.66);

  const logo = await sharp(fgPath)
    .rotate()
    .resize(safeSize, safeSize, {
      fit: 'contain',
      background: {
        r: 0,
        g: 0,
        b: 0,
        alpha: 0,
      },
    })
    .png()
    .toBuffer();

  const padding = Math.floor((size - safeSize) / 2);

  return sharp(logo)
    .extend({
      top: padding,
      bottom: size - safeSize - padding,
      left: padding,
      right: size - safeSize - padding,
      background: {
        r: 0,
        g: 0,
        b: 0,
        alpha: 0,
      },
    })
    .png()
    .toBuffer();
}

async function main() {
  console.log('\nGenerating AtomBook icons...\n');

  // Windows and Linux
  await save(
    await makeBackgroundIcon(512),
    path.join(ROOT, 'build/icon.png')
  );

  await save(
    await makeBackgroundIcon(512),
    path.join(ROOT, 'electron/icon.png')
  );

  // Windows ICO
  const icoImages = [];

  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    icoImages.push(await makeBackgroundIcon(size));
  }

  await fs.promises.mkdir(path.join(ROOT, 'build'), {
    recursive: true,
  });

  await fs.promises.writeFile(
    path.join(ROOT, 'build/icon.ico'),
    await pngToIco(icoImages)
  );

  console.log('✓ build/icon.ico');

  // Web and PWA
  await save(
    await makeBackgroundIcon(512),
    path.join(ROOT, 'public/icon-512.png')
  );

  await save(
    await makeBackgroundIcon(192),
    path.join(ROOT, 'public/icon-192.png')
  );

  await save(
    await makeBackgroundIcon(64),
    path.join(ROOT, 'public/favicon-64.png')
  );

  await save(
    await makeBackgroundIcon(32),
    path.join(ROOT, 'public/favicon.png')
  );

  // Android launcher icons
  for (const { name, size } of densities) {
    const dir = path.join(
      ROOT,
      'android/app/src/main/res',
      `mipmap-${name}`
    );

    await save(
      await makeBackgroundIcon(size),
      path.join(dir, 'ic_launcher.png')
    );

    await save(
      await makeBackgroundIcon(size),
      path.join(dir, 'ic_launcher_round.png')
    );

    await save(
      await makeForegroundIcon(Math.round(size * 2.25)),
      path.join(dir, 'ic_launcher_foreground.png')
    );
  }

  // Android splash screens: preserve their existing dimensions
  const androidRes = path.join(
    ROOT,
    'android/app/src/main/res'
  );

  function findSplashFiles(directory) {
    const results = [];

    for (const entry of fs.readdirSync(directory, {
      withFileTypes: true,
    })) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        results.push(...findSplashFiles(fullPath));
      } else if (
        entry.name === 'splash.png' &&
        path.basename(path.dirname(fullPath)).startsWith('drawable')
      ) {
        results.push(fullPath);
      }
    }

    return results;
  }

  for (const file of findSplashFiles(androidRes)) {
    const meta = await sharp(file).metadata();

    const buffer = await sharp(bgPath)
      .rotate()
      .resize(meta.width, meta.height, {
        fit: 'contain',
        background: ANDROID_BG,
      })
      .png()
      .toBuffer();

    await save(buffer, file);
  }

  // Keep Android adaptive icon background colour
  const colorFile = path.join(
    androidRes,
    'values/ic_launcher_background.xml'
  );

  if (fs.existsSync(path.dirname(colorFile))) {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${ANDROID_BG}</color>
</resources>`;

    await fs.promises.writeFile(colorFile, xml);
    console.log('✓ Android adaptive icon background');
  }

  console.log('\nAtomBook icon generation completed!\n');
  console.log('Next steps:');
  console.log('1. Check your Electron build configuration.');
  console.log('2. Run npx cap sync android.');
  console.log('3. Rebuild Windows, Linux and Android packages.');
}

main().catch(error => {
  console.error('\nGeneration failed:', error);
  process.exit(1);
});
