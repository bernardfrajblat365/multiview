export async function prepareProtectedPlayback(
  whenReady: () => Promise<unknown>,
  onFailure: (error: unknown) => void,
): Promise<boolean> {
  try {
    await whenReady()
    return true
  } catch (error) {
    onFailure(error)
    return false
  }
}
