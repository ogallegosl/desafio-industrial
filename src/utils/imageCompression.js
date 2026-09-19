function extensionName(name = 'evidencia') {
  return String(name).replace(/\.[^.]+$/, '').slice(0, 80) || 'evidencia'
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')) }
    image.src = url
  })
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Reduces camera/photo evidence before upload. It intentionally converts photos
 * to JPEG because screenshots/transparency are not required for evidentiary photos
 * and JPEG is substantially lighter on classroom networks.
 */
export async function compressEvidenceImage(file, options = {}) {
  if (!file?.type?.startsWith('image/')) return file
  const maxDimension = Number(options.maxDimension || 1600)
  const targetBytes = Number(options.targetBytes || 650 * 1024)
  const image = await loadImage(file)
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height))
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale))
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: false })
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)

  let quality = 0.78
  let blob = await canvasBlob(canvas, 'image/jpeg', quality)
  while (blob && blob.size > targetBytes && quality > 0.46) {
    quality -= 0.08
    blob = await canvasBlob(canvas, 'image/jpeg', quality)
  }
  if (!blob) return file
  return new File([blob], `${extensionName(file.name)}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
}

export async function videoFrameToFile(video, name = 'foto-evidencia.jpg') {
  const width = Number(video?.videoWidth || 1280)
  const height = Number(video?.videoHeight || 720)
  const scale = Math.min(1, 1600 / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d', { alpha: false })
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  let blob = await canvasBlob(canvas, 'image/jpeg', 0.78)
  if (!blob) throw new Error('No se pudo capturar la fotografía.')
  let file = new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
  if (file.size > 650 * 1024) file = await compressEvidenceImage(file, { maxDimension: 1400, targetBytes: 650 * 1024 })
  return file
}
