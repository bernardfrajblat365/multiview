import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'

/** What the overlay needs to draw one of Quadra's own dialogs. */
export type UiDialogRequest = {
  id: number
  title: string
  message: string
  detail: string
  buttons: string[]
  defaultId: number
  cancelId: number
}

type UiDialogOptions = {
  /** Sends a request to the overlay; false when the overlay cannot show it right now. */
  send: (request: UiDialogRequest) => boolean
  /** Used when the overlay is not there (closed, still loading). */
  fallback: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>
}

export type UiMessageBox = {
  show: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>
  /** Overlay answer; false when it matches no open dialog or is not one of the buttons. */
  respond: (id: unknown, response: unknown) => boolean
  /** Overlay gone or reloaded: every open dialog counts as cancelled. */
  cancelAll: () => void
}

const MAX_TEXT = 4000

function clampText(value: unknown) {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT) : ''
}

/** Same contract as `dialog.showMessageBox`, drawn by the overlay in Quadra's own style. */
export function createUiMessageBox({ send, fallback }: UiDialogOptions): UiMessageBox {
  let nextId = 1
  const pending = new Map<number, { cancelId: number; buttons: number; resolve: (value: MessageBoxReturnValue) => void }>()

  const show = (options: MessageBoxOptions): Promise<MessageBoxReturnValue> => {
    const buttons = (options.buttons ?? []).map(clampText).filter((label) => label.length > 0).slice(0, 4)
    if (buttons.length === 0) return fallback(options)
    const defaultId = options.defaultId !== undefined && options.defaultId >= 0 && options.defaultId < buttons.length ? options.defaultId : 0
    const cancelId = options.cancelId !== undefined && options.cancelId >= 0 && options.cancelId < buttons.length ? options.cancelId : buttons.length - 1
    const id = nextId++
    return new Promise((resolve) => {
      pending.set(id, { cancelId, buttons: buttons.length, resolve: (value) => resolve(value) })
      const sent = send({
        id,
        title: clampText(options.title),
        message: clampText(options.message),
        detail: clampText(options.detail),
        buttons,
        defaultId,
        cancelId,
      })
      if (!sent) {
        pending.delete(id)
        void fallback(options).then(resolve)
      }
    })
  }

  const respond = (id: unknown, response: unknown) => {
    if (typeof id !== 'number' || typeof response !== 'number') return false
    const entry = pending.get(id)
    if (!entry || !Number.isInteger(response) || response < 0 || response >= entry.buttons) return false
    pending.delete(id)
    entry.resolve({ response } as MessageBoxReturnValue)
    return true
  }

  const cancelAll = () => {
    for (const [id, entry] of [...pending]) {
      pending.delete(id)
      entry.resolve({ response: entry.cancelId } as MessageBoxReturnValue)
    }
  }

  return { show, respond, cancelAll }
}
