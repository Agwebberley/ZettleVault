import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { fail } from './http.ts'

const PHOTOS = path.resolve(process.env.PHOTOS_DIR ?? './data/photos')
const MAX_UPLOAD = 12 * 1024 * 1024
const NAME = /^[0-9a-f-]{36}\.jpg$/

// Ownership by construction: a user's photos live under their own directory, and names are validated.
export const photoPath = (userId: string, name: string) => (NAME.test(name) ? path.join(PHOTOS, userId, name) : fail(404, 'not found'))

// Re-encode everything: proves it's an image, applies the camera's rotation, drops EXIF (GPS), bounds the size.
export async function storePhoto(userId: string, file: unknown): Promise<string> {
  if (!(file instanceof File)) fail(400, 'expected an image file')
  if (file.size > MAX_UPLOAD) fail(400, 'that photo is too large')
  const jpeg = await sharp(Buffer.from(await file.arrayBuffer()))
    .rotate()
    .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
    .catch(() => fail(400, 'that file is not an image we can read'))
  const name = `${randomUUID()}.jpg`
  await mkdir(path.join(PHOTOS, userId), { recursive: true })
  await writeFile(path.join(PHOTOS, userId, name), jpeg)
  return name
}

export const removePhotos = (userId: string, names: (string | null)[]) =>
  Promise.all(names.filter((n): n is string => !!n && NAME.test(n)).map((n) => unlink(path.join(PHOTOS, userId, n)).catch(() => {})))
