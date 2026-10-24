import { app } from 'electron'
import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/** Who the line is about: the William Hill scoreboard feed or the 365Scores web API. */
export type ScannerSource = 'wh' | '365'
export type ScannerLogLine = { time: string; text: string; source?: ScannerSource }

const SOURCE_NAMES: Record<ScannerSource, string> = { wh: 'William Hill', '365': '365Scores API' }

const MAX_LINES = 500
const RETAIN_DAYS = 7
const lines: ScannerLogLine[] = []
const listeners = new Set<(line: ScannerLogLine) => void>()
let logDir: string | null = null
let pruned = false

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function stamp(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function dayName(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

async function prune(dir: string) {
  const cutoff = Date.now() - RETAIN_DAYS * 86_400_000
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const match = /^scanner-(\d{4})-(\d{2})-(\d{2})\.log$/.exec(name)
    if (match && new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() < cutoff) {
      await unlink(join(dir, name)).catch(() => {})
    }
  }
}

/** Never pass cookies, tokens or session ids here: only high-level engine events. */
export function logScanner(text: string, source?: ScannerSource) {
  const now = new Date()
  const line: ScannerLogLine = source ? { time: stamp(now), text, source } : { time: stamp(now), text }
  const tag = source ? `[${SOURCE_NAMES[source]}] ` : ''
  lines.push(line)
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES)
  for (const listener of listeners) listener(line)
  if (!app.isPackaged) console.warn(`[scanner] ${line.time} ${tag}${text}`)
  void (async () => {
    logDir ??= join(app.getPath('userData'), 'logs')
    await mkdir(logDir, { recursive: true }).catch(() => {})
    if (!pruned) {
      pruned = true
      void prune(logDir)
    }
    await appendFile(join(logDir, `scanner-${dayName(now)}.log`), `${line.time} ${tag}${text}\n`).catch(() => {})
  })()
}

export function getScannerLogBacklog() {
  return [...lines]
}

export function onScannerLog(listener: (line: ScannerLogLine) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
