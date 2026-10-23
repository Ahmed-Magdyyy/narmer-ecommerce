import sharp from 'sharp';
import { AppError } from '../../errors/app-error.js';

export async function processCatalogImage(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 5 * 1024 * 1024) {
    throw new AppError(422, 'INVALID_IMAGE');
  }
  const formats = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
  const format = formats[contentType?.split(';')[0].trim().toLowerCase()];
  if (!format) throw new AppError(415, 'IMAGE_TYPE_UNSUPPORTED');
  try {
    const image = sharp(buffer, { failOn: 'warning', limitInputPixels: 20000000 });
    const metadata = await image.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) > 1) throw new Error('Invalid format or animated image.');
    // Decode and re-encode to reject corrupt input, strip metadata, and normalize browser delivery.
    const output = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    return { buffer: output.data, width: output.info.width, height: output.info.height };
  } catch { throw new AppError(422, 'INVALID_IMAGE'); }
}
