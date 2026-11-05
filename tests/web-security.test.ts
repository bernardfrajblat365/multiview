import assert from 'node:assert/strict'
import test from 'node:test'
import { isGrantedPermission, isOverlayNavigationAllowed } from '../electron/web-security.ts'

test('players keep fullscreen, DRM and clipboard write', () => {
  for (const permission of ['fullscreen', 'mediaKeySystem', 'clipboard-sanitized-write']) {
    assert.equal(isGrantedPermission(permission), true, permission)
  }
})

test('remote pages never get devices, location, notifications or external protocols', () => {
  for (const permission of ['media', 'geolocation', 'notifications', 'openExternal', 'midi', 'midiSysex', 'hid', 'serial', 'usb', 'clipboard-read', 'display-capture', 'idle-detection', 'window-management', 'pointerLock', 'keyboardLock', 'unknown', '']) {
    assert.equal(isGrantedPermission(permission), false, permission)
  }
})

test('the overlay may reload its own page', () => {
  assert.equal(isOverlayNavigationAllowed('file:///C:/app/out/renderer/index.html?release-notes=off', 'file:///C:/app/out/renderer/index.html'), true)
  assert.equal(isOverlayNavigationAllowed('http://localhost:43123/', 'http://localhost:43123/?first-steps=off'), true)
})

test('the overlay never loads a dropped link, a local file or another page', () => {
  assert.equal(isOverlayNavigationAllowed('file:///C:/app/out/renderer/index.html', 'https://evil.example/'), false)
  assert.equal(isOverlayNavigationAllowed('file:///C:/app/out/renderer/index.html', 'file:///C:/Users/me/Downloads/page.html'), false)
  assert.equal(isOverlayNavigationAllowed('http://localhost:43123/', 'http://localhost:43124/'), false)
  assert.equal(isOverlayNavigationAllowed('http://localhost:43123/', 'http://localhost:43123/pip.html'), false)
  assert.equal(isOverlayNavigationAllowed('', 'https://evil.example/'), false)
  assert.equal(isOverlayNavigationAllowed('http://localhost:43123/', 'not a url'), false)
})
