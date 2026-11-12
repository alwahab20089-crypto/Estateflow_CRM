import { randomUUID } from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import type { RequestHandler } from 'express';
import { AppError } from '../../utils/app-error';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 10;

const ALLOWED: Record<string, { extensions: string[]; canonical: string }> = {
  'image/jpeg': { extensions: ['jpg', 'jpeg'], canonical: 'jpg' },
  'image/png': { extensions: ['png'], canonical: 'png' },
  'image/webp': { extensions: ['webp'], canonical: 'webp' },
};

/** Never trust the declared MIME type: check the real file signature. */
function sniff(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export interface ValidatedImage {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  size: number;
  originalName: string;
}

export function validateImage(file: { buffer: Buffer; mimetype: string; originalname: string; size: number }, index: number): ValidatedImage {
  const path_ = `images.${index}`;
  const rule = ALLOWED[file.mimetype];
  if (!rule) throw AppError.validation([{ path: path_, message: 'Only JPEG, PNG and WebP images are allowed' }]);
  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  if (!rule.extensions.includes(ext)) throw AppError.validation([{ path: path_, message: 'File extension does not match the image type' }]);
  if (file.size > MAX_IMAGE_BYTES) throw AppError.validation([{ path: path_, message: 'Image is larger than 5 MB' }]);
  if (sniff(file.buffer) !== file.mimetype) throw AppError.validation([{ path: path_, message: 'File content is not a valid image' }]);
  const originalName = path.basename(file.originalname).replace(/[^\w .-]/g, '_').slice(0, 120);
  return { buffer: file.buffer, mimeType: file.mimetype, extension: rule.canonical, size: file.size, originalName };
}

/** Safe unique key. User-supplied filenames are never used in it. */
export const imageKey = (organizationId: string, propertyId: string, extension: string) =>
  `${organizationId}/properties/${propertyId}/${randomUUID()}.${extension}`;

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_FILES_PER_REQUEST, fields: 0 },
}).array('images', MAX_FILES_PER_REQUEST);

/** Runs multer and converts its errors into the API's standard 422. */
export const parseImageUpload: RequestHandler = (req, res, next) =>
  uploader(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? 'Image is larger than 5 MB'
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `Upload at most ${MAX_FILES_PER_REQUEST} images using the "images" field`
        : 'Invalid upload';
      return next(AppError.validation([{ path: 'images', message }]));
    }
    next(err);
  });