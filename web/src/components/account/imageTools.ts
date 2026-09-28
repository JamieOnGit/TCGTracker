'use client'
import { fitWithin } from '@/lib/account/format'

export interface PreparedImage {
  blob: Blob
  mime: string
  width: number
  height: number
  bytes: number
}

export const MAX_EDGE = 1600
const WEBP_QUALITY = 0.85

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined }
  } finally {
    // Revoked after drawing below; keeping it until then is harmless.
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}

/**
 * Always re-encode photos in the browser: long edge at most 1600px, WebP at
 * ~0.85 quality (the site serves images unoptimised from Cloudflare, so the
 * upload is what visitors download). If the browser can't encode WebP (it
 * silently returns PNG), the original file is kept as-is.
 */
export async function prepareImage(file: File, maxEdge = MAX_EDGE): Promise<PreparedImage> {
  const img = await decode(file)
  try {
    const { width, height } = fitWithin(img.width, img.height, maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img.source, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY))
    if (blob && blob.type === 'image/webp') return { blob, mime: 'image/webp', width, height, bytes: blob.size }
    return { blob: file, mime: file.type, width: img.width, height: img.height, bytes: file.size }
  } catch {
    return { blob: file, mime: file.type, width: img.width, height: img.height, bytes: file.size }
  } finally {
    img.close()
  }
}

export function uuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
