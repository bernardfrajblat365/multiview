export const PROTECTED_PLAYBACK_TIMEOUT = Symbol('protected-playback-timeout')

/**
 * Waits for the Widevine CDM. With `timeoutMs`, startup goes on after that long even if
 * the CDM is still installing (it keeps installing in the background); `onTimeout` is told.
 */
export async function prepareProtectedPlayback(
  whenReady: () => Promise<unknown>,
  onFailure: (error: unknown) => void,
  timeoutMs?: number,
  onTimeout?: () => void,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const ready = whenReady()
    if (timeoutMs === undefined) {
      await ready
      return true
    }
    const timeout = new Promise<typeof PROTECTED_PLAYBACK_TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(PROTECTED_PLAYBACK_TIMEOUT), timeoutMs)
    })
    const result = await Promise.race([ready, timeout])
    if (result === PROTECTED_PLAYBACK_TIMEOUT) {
      ready.catch(onFailure)
      onTimeout?.()
      return false
    }
    return true
  } catch (error) {
    onFailure(error)
    return false
  } finally {
    if (timer) clearTimeout(timer)
  }
}
