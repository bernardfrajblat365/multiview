import { net } from 'electron'

const FETCH_TIMEOUT_MS = 8000
const MAX_IMAGE_BYTES = 200_000
const IMAGE_TYPE = /^image\/(?:png|jpeg|webp|gif)$/i
/** Escudos (~3–7 KB) e fotos de jogadores (~3 KB) dividem o mesmo cache, só em memória. */
const MAX_CACHED = 800

const images = new Map<string, Promise<string | null>>()

async function download(url: string): Promise<string | null> {
  const response = await net.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  // 404: a imagem não existe (time sem escudo, jogador sem foto). Guardado como null para não pedir de novo.
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!IMAGE_TYPE.test(type)) return null
  const body = Buffer.from(await response.arrayBuffer())
  if (body.length === 0 || body.length > MAX_IMAGE_BYTES) return null
  return `data:${type.toLowerCase()};base64,${body.toString('base64')}`
}

export function hasImage(key: string) {
  return images.has(key)
}

/** A imagem como data URL (null: não existe ou não serve). Pedidos iguais compartilham o mesmo download; o menos usado sai primeiro. */
export function loadImage(key: string, url: string): Promise<string | null> {
  const cached = images.get(key)
  if (cached) {
    // Usado agora: vai para o fim da fila de saída.
    images.delete(key)
    images.set(key, cached)
    return cached
  }
  const pending = download(url).catch(() => {
    // Erro de rede pode passar: esquece para a próxima tentativa.
    images.delete(key)
    return null
  })
  images.set(key, pending)
  if (images.size > MAX_CACHED) images.delete(images.keys().next().value as string)
  return pending
}
