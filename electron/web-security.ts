/**
 * Pure rules for what remote pages and the overlay may do; kept free of `electron` so the tests run in Node.
 */

/**
 * Permissions a page may get. Electron grants every request by default (camera, microphone, location,
 * notifications, opening external protocol handlers…); players only need fullscreen, the DRM key system
 * (Widevine) and writing to the clipboard.
 */
const GRANTED_PERMISSIONS: ReadonlySet<string> = new Set([
  'fullscreen',
  'mediaKeySystem',
  'clipboard-sanitized-write',
  'storage-access',
  'top-level-storage-access',
])

export function isGrantedPermission(permission: string): boolean {
  return GRANTED_PERMISSIONS.has(permission)
}

function pageOf(value: string): string | null {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return null
  }
}

/**
 * The overlay holds the privileged `window.quadra` bridge, so it never leaves its own page: a link or file
 * dropped on the window would otherwise load there with the bridge. Reloading the same page (any query) is fine.
 */
export function isOverlayNavigationAllowed(currentUrl: string, targetUrl: string): boolean {
  const current = pageOf(currentUrl)
  return current !== null && current === pageOf(targetUrl)
}
