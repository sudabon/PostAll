import type { ApiClient } from '@/api/client'
import type { PickedFile } from '@/platform/types'
import { sha256Hex } from '@/lib/attachments'

export async function uploadPickedFile(
  api: ApiClient,
  file: PickedFile,
  onProgress: (ratio: number) => void,
): Promise<string> {
  const checksum = await sha256Hex(file.data)
  const start = await api.startUpload({
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    sizeBytes: file.data.byteLength,
    checksum,
  })
  await putWithProgress(start.uploadUrl, file.data, start.headers ?? {}, file.type, onProgress)
  await api.completeUpload(start.id)
  return start.id
}

function putWithProgress(
  url: string,
  data: ArrayBuffer,
  headers: Record<string, string>,
  contentType: string,
  onProgress: (ratio: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v))
    if (contentType && !headers['Content-Type'] && !headers['content-type']) {
      xhr.setRequestHeader('Content-Type', contentType)
    }
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) onProgress(ev.loaded / ev.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1)
        resolve()
      } else reject(new Error(`upload ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('upload failed'))
    xhr.send(data)
  })
}
