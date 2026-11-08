import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
const base = new URL('../apps/mobile/assets/', import.meta.url);
const logo = await sharp(fileURLToPath(new URL('brand/magic-book.png', base))).resize(1024, 1024).png().toBuffer();
await writeFile(new URL('icon.png', base), logo);
await writeFile(new URL('android-icon-foreground.png', base), logo);
await writeFile(
  new URL('splash-icon.png', base),
  await sharp(logo).resize(512, 512).png().toBuffer(),
);
await writeFile(new URL('favicon.png', base), await sharp(logo).resize(64, 64).png().toBuffer());
for (const name of ['starkeeper', 'teahouse', 'ink']) {
  const path = new URL(`covers/${name}.png`, base);
  await writeFile(
    path,
    await sharp(fileURLToPath(path)).resize(720, 1080).png({ compressionLevel: 9 }).toBuffer(),
  );
}
console.log('Prepared magical book branding and three original cover assets.');
