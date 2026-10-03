const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createWeddBetsFixture } = require('./weddbets-fixture.cjs')
const root = path.resolve(__dirname, '..')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(check, label) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (await check()) return
    await wait(50)
  }
  throw new Error(`Timeout: ${label}`)
}

// Check actual geometry and hit targets, including every edge of each button.
// Calling element.click() alone would also pass when the toolbar is covered.
function inspectToolbar() {
  const toolbar = document.querySelector('.toolbar')
  const rect = toolbar.getBoundingClientRect()
  const style = getComputedStyle(toolbar)
  const errors = []
  if (style.opacity !== '1' || style.visibility !== 'visible') errors.push('hidden toolbar')
  for (const element of [toolbar, ...toolbar.querySelectorAll('button, select')]) {
    if (element.closest('[hidden]')) continue
    const r = element.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0 || r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) {
      errors.push(`clipped ${element.id || element.className}`)
    }
    if (element === toolbar) continue
    for (const [x, y] of [[r.left + 2, r.top + r.height / 2], [r.right - 2, r.top + r.height / 2], [r.left + r.width / 2, r.top + 2], [r.left + r.width / 2, r.bottom - 2], [r.left + r.width / 2, r.top + r.height / 2]]) {
      const hit = document.elementFromPoint(x, y)
      if (!element.contains(hit)) errors.push(`covered ${element.id} by ${hit?.className}`)
    }
  }
  const panels = [...document.querySelectorAll('.panel')]
  const removeButtons = [...document.querySelectorAll('[data-remove]')]
  const panelDialogOpen = Boolean(document.querySelector('.organize-panel, .confirm, .toolbar__menu:not([hidden])'))
  const organizer = document.querySelector('.organize-panel')
  if (organizer) {
    const organizerRect = organizer.getBoundingClientRect()
    if (organizerRect.width <= 0 || organizerRect.height <= 0 || organizerRect.left < 0 || organizerRect.top < 0 ||
      organizerRect.right > innerWidth || organizerRect.bottom > innerHeight) {
      errors.push('clipped organizer')
    }
    for (const selector of ['[data-organize-apply]', '[data-organize-cancel]', '[data-organize-close]']) {
      const control = organizer.querySelector(selector)
      if (!control) {
        errors.push(`missing organizer control ${selector}`)
        continue
      }
      const controlRect = control.getBoundingClientRect()
      if (controlRect.width <= 0 || controlRect.height <= 0 || controlRect.left < 0 || controlRect.top < 0 ||
        controlRect.right > innerWidth || controlRect.bottom > innerHeight) {
        errors.push(`clipped organizer control ${selector}`)
      }
      const hit = document.elementFromPoint(controlRect.left + controlRect.width / 2, controlRect.top + controlRect.height / 2)
      if (!control.contains(hit)) errors.push(`covered organizer control ${selector}`)
    }
    const positionCards = [...organizer.querySelectorAll('.organize-position')]
    const activeCards = positionCards.filter((card) => card.getAttribute('aria-pressed') === 'true')
    if (positionCards.length > 0 && activeCards.length !== 1) errors.push(`invalid active organizer cards ${activeCards.length}`)
    if (activeCards.length === 1) {
      const previewIds = [...activeCards[0].querySelectorAll('[data-preview-panel]')].map((cell) => cell.dataset.previewPanel)
      const panelIds = panels.map((panel) => panel.dataset.panelId)
      if (previewIds.length !== panelIds.length || new Set(previewIds).size !== previewIds.length ||
        panelIds.some((id) => !previewIds.includes(id))) errors.push('organizer preview IDs do not match panels')
    }
  }
  if (removeButtons.length !== panels.length) errors.push(`missing trash buttons ${removeButtons.length}/${panels.length}`)
  for (const panel of panels) {
    const button = panel.querySelector('[data-remove]')
    if (!button) continue
    const panelRect = panel.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    if (buttonRect.left < panelRect.left || buttonRect.top < panelRect.top || buttonRect.right > panelRect.right || buttonRect.bottom > panelRect.bottom) {
      errors.push(`clipped trash in ${panel.dataset.slot}`)
    }
    if (!panelDialogOpen) {
      const x = buttonRect.left + buttonRect.width / 2
      const y = buttonRect.top + buttonRect.height / 2
      const toolbarOverlapsPanel = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      if (!toolbarOverlapsPanel) {
        const hit = document.elementFromPoint(x, y)
        if (!button.contains(hit)) errors.push(`covered trash in ${panel.dataset.slot} by ${hit?.className}`)
      }
    }
  }
  return { errors, width: innerWidth, height: innerHeight, toolbarHeight: rect.height }
}

async function worker() {
  const { app, BaseWindow, BrowserWindow, webContents, desktopCapturer } = require('electron')
  const fail = (error) => { console.error(error.stack || error); app.exit(1) }
  process.on('uncaughtException', fail)
  process.on('unhandledRejection', fail)
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND')
  await import(pathToFileURL(path.join(root, 'out/main/main.js')).href)
  let overlay
  await until(() => {
    overlay = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('/renderer/index.html'))
    return overlay
  }, 'overlay')
  const ui = (expression) => overlay.webContents.executeJavaScript(expression, true).catch((error) => {
    throw new Error(`UI JavaScript failed: ${expression}\n${error.stack || error}`)
  })
  await until(() => ui("Boolean(document.querySelector('.chooser'))"), 'chooser')
  const main = BaseWindow.getAllWindows().find((win) => win !== overlay)
  const pages = () => webContents.getAllWebContents().filter((page) => page.getURL().startsWith(process.env.QUADRA_TOOLBAR_URL))
  const toolbarOrigin = new URL(process.env.QUADRA_TOOLBAR_URL).origin
  const weddPages = () => webContents.getAllWebContents().filter((page) => page.getURL().startsWith(`${toolbarOrigin}/view/`))
  let checks = 0
  let compositions = 0
  async function check(label) {
    await wait(60)
    const state = await ui(`(${inspectToolbar.toString()})()`)
    assert.deepEqual(state.errors, [], `${label}: ${JSON.stringify(state)}`)
    assert.equal(overlay.isVisible(), true, label)
    assert.equal(overlay.getParentWindow(), main, 'Overlay must stay above the native video views as a child window')
    assert.deepEqual(overlay.getBounds(), main.getContentBounds(), `native bounds: ${label}`)
    const loadedPages = pages()
    if (loadedPages.length > 0) {
      const fits = await Promise.all(loadedPages.map((page) => page.executeJavaScript(`(() => {
        const video = document.querySelector('video')
        if (!video) return null
        const style = getComputedStyle(video)
        return { fit: style.objectFit, position: style.objectPosition, background: style.backgroundColor }
      })()`)))
      assert.ok(fits.every((fit) => fit?.fit === 'contain' && fit.position === '50% 50%' && fit.background === 'rgb(0, 0, 0)'),
        `${label}: videos must remain fully visible: ${JSON.stringify(fits)}`)
    }
    checks++
  }
  async function panelPlacement() {
    return ui(`(() => {
      const stage = document.querySelector('#layout-stage')?.getBoundingClientRect()
      const panel = document.querySelector('.panel.is-highlighted')?.getBoundingClientRect()
      if (!stage || !panel) return null
      return { stage: { x: stage.x, y: stage.y, width: stage.width, height: stage.height },
        panel: { x: panel.x, y: panel.y, width: panel.width, height: panel.height },
        isTop: Math.abs(panel.x - stage.x) <= 2 && Math.abs(panel.y - stage.y) <= 2 &&
          Math.abs(panel.width - stage.width) <= 2 && panel.height < stage.height - 2 }
    })()`)
  }
  async function selectTopHighlight(count) {
    await ui(`document.querySelector('[data-count="${count}"]').click()`)
    await wait(80)
    await click('#btn-organize')
    await click('[data-composition="1"]')
    await click('[data-organizer-aliases~="top"]')
    await click('[data-organize-apply]')

    const placement = await panelPlacement()
    assert.equal(
      placement?.isTop,
      true,
      `${count} WeddBets fixture must use a highlighted top panel: ${JSON.stringify(placement)}`,
    )
    return placement
  }
  async function selectHighlightPosition(index) {
    const positions = ['top', 'bottom', 'left', 'right']
    await click('#btn-organize')
    await click(`[data-organizer-aliases~="${positions[index]}"]`)
    await click('[data-organize-apply]')
  }
  async function openWeddFixtures(count, ratio, player = 'openvidu', { late = false, empty = false } = {}) {
    const fixture = empty ? 'empty' : 'weddbets'
    const urls = Array.from({ length: count }, (_, index) =>
      `${toolbarOrigin}/view/weddbets?fixture=${fixture}&ratio=${ratio}&player=${player}&late=${late ? 1 : 0}&slot=${index}`)
    await ui(`(() => {
      document.querySelectorAll('.panel input[name="url"]').forEach((input, index) => {
        input.value = ${JSON.stringify(urls)}[index]
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      document.querySelector('#btn-open-all').click()
    })()`)
    await until(async () => {
      const scenarioPages = weddPages().filter((page) =>
        page.getURL().includes(`fixture=${fixture}`) &&
        page.getURL().includes(`ratio=${ratio}`) &&
        page.getURL().includes(`player=${player}`))
      if (scenarioPages.length !== count) return false
      if (empty) return (await Promise.all(scenarioPages.map((page) => page.executeJavaScript("document.readyState === 'complete'").catch(() => false)))).every(Boolean)
      return (await Promise.all(scenarioPages.map((page) => page.executeJavaScript(`(() => {
        const video = [...document.querySelectorAll('video')].find((candidate) => candidate.videoWidth > 0)
        return document.readyState === 'complete' && Boolean(video && !video.paused && video.srcObject?.active)
      })()`).catch(() => false)))).every(Boolean)
    }, `${count} WeddBets ${player} ${ratio} pages`)
    return urls
  }
  async function closeWeddFixtures(label) {
    await click('#btn-layout')
    await click('.confirm [data-ok]')
    await until(() => ui("Boolean(document.querySelector('.chooser'))"), `${label}: chooser return`)
    await until(() => weddPages().length === 0, `${label}: WeddBets pages closed`)
    await wait(150)
  }
  async function readWeddVideo(page) {
    return page.executeJavaScript(`(() => {
      const video = [...document.querySelectorAll('video')].find((candidate) => candidate.videoWidth > 0) || document.querySelector('video')
      if (!video) return null
      const rect = video.getBoundingClientRect()
      const style = getComputedStyle(video)
      const ancestors = []
      for (let element = video; element && ancestors.length < 12; element = element.parentElement) {
        const ancestorRect = element.getBoundingClientRect()
        const ancestorStyle = getComputedStyle(element)
        ancestors.push({
          tag: element.tagName,
          id: element.id,
          className: element.className,
          rect: { x: ancestorRect.x, y: ancestorRect.y, width: ancestorRect.width, height: ancestorRect.height },
          overflow: ancestorStyle.overflow,
          overflowX: ancestorStyle.overflowX,
          overflowY: ancestorStyle.overflowY,
          width: ancestorStyle.width,
          height: ancestorStyle.height,
          maxHeight: ancestorStyle.maxHeight,
          minHeight: ancestorStyle.minHeight,
          padding: {
            top: ancestorStyle.paddingTop,
            right: ancestorStyle.paddingRight,
            bottom: ancestorStyle.paddingBottom,
            left: ancestorStyle.paddingLeft,
          },
          border: {
            top: ancestorStyle.borderTopWidth,
            right: ancestorStyle.borderRightWidth,
            bottom: ancestorStyle.borderBottomWidth,
            left: ancestorStyle.borderLeftWidth,
          },
          boxSizing: ancestorStyle.boxSizing,
          position: ancestorStyle.position,
          transform: ancestorStyle.transform,
        })
      }
      const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      const borderX = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
      const borderY = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
      const contentWidth = Math.max(0, rect.width - paddingX - borderX)
      const contentHeight = Math.max(0, rect.height - paddingY - borderY)
      const scale = Math.min(contentWidth / video.videoWidth, contentHeight / video.videoHeight)
      const rendered = {
        width: video.videoWidth * scale,
        height: video.videoHeight * scale,
        x: rect.x + (rect.width - video.videoWidth * scale) / 2,
        y: rect.y + (rect.height - video.videoHeight * scale) / 2,
      }
      return {
        viewport: { width: innerWidth, height: innerHeight },
        intrinsic: { width: video.videoWidth, height: video.videoHeight },
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        content: { width: contentWidth, height: contentHeight },
        rendered,
        fit: style.objectFit,
        position: style.objectPosition,
        background: style.backgroundColor,
        paused: video.paused,
        ancestors,
      }
    })()`)
  }
  async function assertWeddVideoFits(page, label) {
    let metrics = null
    await until(async () => {
      const next = await readWeddVideo(page)
      if (!next || next.intrinsic.width <= 0 || next.intrinsic.height <= 0 || next.paused) return false
      metrics = next
      return true
    }, `${label}: WeddBets video metadata`)
    const tolerance = 2
    assert.equal(metrics.fit, 'contain', `${label}: object-fit must preserve the complete video`)
    assert.equal(metrics.position, '50% 50%', `${label}: video must be centered`)
    assert.equal(metrics.background, 'rgb(0, 0, 0)', `${label}: video background must be black`)
    assert.equal(metrics.paused, false, `${label}: WeddBets video must keep playing`)
    assert.ok(metrics.rect.x >= -tolerance && metrics.rect.y >= -tolerance &&
      metrics.rect.x + metrics.rect.width <= metrics.viewport.width + tolerance &&
      metrics.rect.y + metrics.rect.height <= metrics.viewport.height + tolerance,
    `${label}: video element exceeds its WebContentsView: ${JSON.stringify(metrics)}`)
    const clippingAncestors = metrics.ancestors.filter((ancestor) =>
      ['hidden', 'clip', 'scroll', 'auto'].includes(ancestor.overflowX) ||
      ['hidden', 'clip', 'scroll', 'auto'].includes(ancestor.overflowY))
    for (const ancestor of clippingAncestors) {
      assert.ok(metrics.rect.x >= ancestor.rect.x - tolerance && metrics.rect.y >= ancestor.rect.y - tolerance &&
        metrics.rect.x + metrics.rect.width <= ancestor.rect.x + ancestor.rect.width + tolerance &&
        metrics.rect.y + metrics.rect.height <= ancestor.rect.y + ancestor.rect.height + tolerance,
      `${label}: vídeo excede ancestral com clipping (${ancestor.tag}#${ancestor.id}.${ancestor.className}): ${JSON.stringify(metrics)}`)
    }
    assert.ok(metrics.ancestors.every((ancestor) => ancestor.transform === 'none'),
      `${label}: ancestral não pode ampliar ou deslocar o player com transform: ${JSON.stringify(metrics)}`)
    assert.ok(Math.abs(metrics.rect.width - metrics.viewport.width) <= tolerance &&
      Math.abs(metrics.rect.height - metrics.viewport.height) <= tolerance,
    `${label}: video element must use the complete panel before object-fit contain scales the image: ${JSON.stringify(metrics)}`)
    assert.ok(metrics.rendered.width <= metrics.content.width + tolerance && metrics.rendered.height <= metrics.content.height + tolerance,
      `${label}: contain não pode cortar a imagem: ${JSON.stringify(metrics)}`)
    assert.ok(Math.abs(metrics.rendered.x - (metrics.rect.x + (metrics.rect.width - metrics.rendered.width) / 2)) <= tolerance &&
      Math.abs(metrics.rendered.y - (metrics.rect.y + (metrics.rect.height - metrics.rendered.height) / 2)) <= tolerance,
    `${label}: imagem deve ficar centralizada no player: ${JSON.stringify(metrics)}`)
    assert.ok(Math.abs(metrics.rendered.width - metrics.content.width) <= tolerance ||
      Math.abs(metrics.rendered.height - metrics.content.height) <= tolerance,
    `${label}: contain deve maximizar a imagem em pelo menos um eixo: ${JSON.stringify(metrics)}`)
  }
  async function runWeddGeometryScenarios() {
    const ratios = ['16x9', '4x3', '3x4', '16x4']
    const playerScenarios = [
      { player: 'openvidu', ratios, rotations: true },
      { player: 'ant', ratios: ['16x9', '3x4'], rotations: false },
      { player: 'flash', ratios: ['16x9', '3x4'], rotations: false },
      { player: 'ms', ratios: ['16x9', '3x4'], rotations: false },
      { player: 'frame', ratios: ['16x9', '3x4'], rotations: false },
    ]
    for (const count of [3, 4]) {
      for (const scenario of playerScenarios.filter(({ player }) => count === 3 || player === 'openvidu')) {
        for (const ratio of scenario.ratios) {
          const rotations = scenario.rotations && ratio === '16x9' ? [0, 1, 2, 3] : [0]
          for (const rotation of rotations) {
            const placement = await selectTopHighlight(count)
            await selectHighlightPosition(rotation)
            await openWeddFixtures(count, ratio, scenario.player, {
              late: scenario.player === 'openvidu' && rotation === 0,
            })
            const label = `${count} panels, ${scenario.player}, ${ratio}, position=${['top', 'bottom', 'left', 'right'][rotation]}, top=${JSON.stringify(placement)}`
            for (const page of weddPages()) await assertWeddVideoFits(page, label)

            if (count === 3 && scenario.player === 'openvidu' && ratio === '16x9' && rotation === 0) {
              const first = weddPages()[0]
              first.reload()
              await assertWeddVideoFits(first, `${label}, reload`)
              await click('#btn-organize')
              await ui("document.querySelector('.panel:not(.is-highlighted) [data-highlight]').click()")
              await click('#btn-organize')
              for (const page of weddPages()) await assertWeddVideoFits(page, `${label}, swapped highlight`)
              main.unmaximize()
              for (const [width, height] of [[960, 620], [1440, 900]]) {
                main.setSize(width, height)
                await wait(180)
                for (const page of weddPages()) await assertWeddVideoFits(page, `${label}, resized ${width}x${height}`)
              }
              await ui("document.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20, bubbles: true }))")
              await until(() => ui("document.querySelector('.grid-shell').classList.contains('is-toolbar-visible')"), `${label}: reveal toolbar`)
              await click('#btn-fullscreen')
              await until(() => main.isFullScreen(), `${label}: enter fullscreen`)
              for (const page of weddPages()) await assertWeddVideoFits(page, `${label}, fullscreen`)
              await click('#btn-fullscreen')
              await until(() => !main.isFullScreen(), `${label}: leave fullscreen`)
            }
            await closeWeddFixtures(label)
          }
        }
      }
    }

    for (const count of [3, 4]) {
      await ui(`document.querySelector('[data-count="${count}"]').click()`)
      await click('#btn-organize')
      await click('[data-composition="0"]')
      await click('[data-organize-apply]')
      await openWeddFixtures(count, '4x3', 'openvidu')
      for (const page of weddPages()) await assertWeddVideoFits(page, `${count} panels, equal, 4x3`)
      await closeWeddFixtures(`${count} panels, equal`)
    }

    await selectTopHighlight(3)
    await openWeddFixtures(3, '16x9', 'openvidu', { empty: true })
    for (const page of weddPages()) {
      assert.equal(await page.executeJavaScript('document.querySelectorAll(\'video\').length'), 0, 'Página sem player não deve criar vídeo')
    }
    await closeWeddFixtures('WeddBets sem player')
  }
  await runWeddGeometryScenarios()
  async function click(selector) {
    const result = await ui(`(() => {
      try {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20, bubbles: true }))
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return { error: 'Missing control', selector: ${JSON.stringify(selector)}, controls: [...document.querySelectorAll('[data-organizer-aliases]')].map((item) => item.getAttribute('data-organizer-aliases')) }
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (!el.contains(hit)) return { error: 'Covered control', selector: ${JSON.stringify(selector)}, hit: hit?.className ?? hit?.tagName, bounds: { x: r.x, y: r.y, width: r.width, height: r.height } }
        el.click()
        return { ok: true }
      } catch (error) {
        return { error: String(error), stack: error?.stack }
      }
    })()`)
    if (!result?.ok) throw new Error(`Toolbar control ${selector} failed: ${JSON.stringify(result)}`)
    await wait(60)
  }
  async function variants(label) {
    assert.equal(await ui("Boolean(document.querySelector('.organize-panel'))"), false, `${label}: organizer initially closed`)
    await click('#btn-organize')
    const counts = await ui("[...document.querySelectorAll('[data-composition]')].map(el => Number(el.dataset.composition))")
    const panelCount = await ui("document.querySelectorAll('.panel').length")
    assert.deepEqual(counts, panelCount < 3 ? [0] : panelCount < 5 ? [0, 1] : panelCount === 7 ? [0, 1, 2, 3] : [0, 1, 2], `${label}: all compositions available`)
    await click('#btn-organize')
    for (const count of counts) {
      const aliases = count === 0
        ? ['none']
        : panelCount === 13 && count === 1
          ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
          : panelCount === 10 && count === 2
            ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
            : panelCount === 7 && count === 3
              ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
              : ['left', 'right', 'top', 'bottom']

      for (const alias of aliases) {
        await click('#btn-organize')
        await click(`[data-composition="${count}"]`)
        await click(`[data-organizer-aliases~="${alias}"]`)
        await check(`${label}, highlights=${count}, position=${alias}, editor`)
        if (label.endsWith(' empty')) {
          const captureNames = {
            '4:1:right': 'organizer-4-one-right',
            '7:3:top-left': 'organizer-7-three',
            '10:2:top-left': 'organizer-10-two',
            '13:1:bottom-right': 'organizer-13-corner',
            '16:2:left': 'organizer-16-two',
          }
          const captureName = captureNames[`${panelCount}:${count}:${alias}`]
          if (captureName) await capture(captureName)
        }
        await click('[data-organize-apply]')
        await check(`${label}, highlights=${count}, position=${alias}, applied`)
        compositions++
      }
    }
    assert.equal(await ui("Boolean(document.querySelector('.organize-panel'))"), false, `${label}: organizer closed by toolbar click`)
    await check(`${label}, panel trash buttons`)
  }
  async function capture(name) {
    fs.mkdirSync(path.join(root, 'artifacts/toolbar-checks'), { recursive: true })
    fs.writeFileSync(path.join(root, `artifacts/toolbar-checks/${name}-overlay.png`), (await overlay.webContents.capturePage()).toPNG())
    const screens = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })
    if (screens[0]) fs.writeFileSync(path.join(root, `artifacts/toolbar-checks/${name}-desktop.png`), screens[0].thumbnail.toPNG())
  }
  for (let count = 1; count <= 16; count++) {
    await ui(`document.querySelector('[data-count="${count}"]').click()`)
    await variants(`${count} empty`)
    await ui(`(() => {
      document.querySelectorAll('.panel input[name="url"]').forEach((input, i) => input.value = ${JSON.stringify(process.env.QUADRA_TOOLBAR_URL)} + '?slot=' + i)
      document.querySelector('#btn-open-all').click()
    })()`)
    await until(async () => {
      const all = pages()
      if (all.length !== count) return false
      return (await Promise.all(all.map((page) => page.executeJavaScript("Boolean(document.querySelector('video') && !document.querySelector('video').paused && document.querySelector('video').srcObject?.active)").catch(() => false)))).every(Boolean)
    }, `${count} playing videos`)
    const ids = pages().map((page) => page.id).sort()
    pages()[0].focus()
    pages()[0].sendInputEvent({ type: 'mouseDown', x: 100, y: 100, button: 'left', clickCount: 1 })
    pages()[0].sendInputEvent({ type: 'mouseUp', x: 100, y: 100, button: 'left', clickCount: 1 })
    await check(`${count} video focus`)
    await click('#btn-mute-all')
    await until(() => pages().every((page) => page.isAudioMuted()), 'mute from toolbar')
    await check(`${count} longer unmute label`)
    await click('#btn-mute-all')
    await until(() => pages().every((page) => !page.isAudioMuted()), 'unmute from toolbar')
    await variants(`${count} playing`)
    main.unmaximize()
    for (const [width, height] of [[960, 620], [1440, 900]]) {
      main.setSize(width, height)
      await variants(`${count} playing ${width}x${height}`)
    }
    await click('#btn-fullscreen')
    await until(() => main.isFullScreen(), 'enter fullscreen')
    await variants(`${count} playing fullscreen`)
    if (count === 1 || count === 16) {
      await ui('document.activeElement?.blur()')
      pages()[0].focus()
      await ui("document.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20, bubbles: true }))")
      await wait(11000)
      assert.equal(await ui(`(() => {
        const toolbar = document.querySelector('.toolbar')
        const style = getComputedStyle(toolbar)
        return !document.querySelector('.grid-shell').classList.contains('is-toolbar-visible') &&
          style.opacity === '0' && style.visibility === 'hidden' && style.pointerEvents === 'none'
      })()`), true, `${count}: toolbar should hide after idle timeout`)
      await until(async () => (await Promise.all(pages().map((page) => page.executeJavaScript(
        "getComputedStyle(document.body).cursor === 'none'",
      )))).every(Boolean), 'cursor hidden in every video panel')
      assert.equal(await ui("getComputedStyle(document.body).cursor"), 'none', `${count}: overlay cursor should be hidden`)
      await ui(`document.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20, bubbles: true }))`)
      await until(() => ui("document.querySelector('.grid-shell').classList.contains('is-toolbar-visible')"), 'toolbar reveal after mouse move')
      await until(async () => (await Promise.all(pages().map((page) => page.executeJavaScript(
        "getComputedStyle(document.body).cursor !== 'none'",
      )))).every(Boolean), 'cursor restored in every video panel')
      await wait(250)
      await check(`${count} revealed after mouse movement`)
      await capture(`playing-${count}`)
    }
    await click('#btn-more')
    await check(`${count} more menu`)
    assert.equal(await ui("document.querySelector('#toolbar-more-menu').hidden"), false)
    await click('#btn-more')
    await click('#btn-fullscreen')
    await until(() => !main.isFullScreen(), 'leave fullscreen')
    await check(`${count} after fullscreen`)
    assert.deepEqual(pages().map((page) => page.id).sort(), ids, 'Layouts must not recreate playing videos')
    const playingAfterLayouts = await Promise.all(pages().map((page) => page.executeJavaScript("Boolean(!document.querySelector('video').paused && document.querySelector('video').srcObject?.active)")))
    assert.ok(playingAfterLayouts.every(Boolean), 'Every video must keep playing')
    await click('#btn-layout')
    await click('.confirm [data-ok]')
    await until(() => ui("Boolean(document.querySelector('.chooser'))"), 'back to chooser')
    console.log(`PASS ${count} panels: empty, playing, every composition/position, resize, fullscreen, focus, controls`)
  }
  console.log(JSON.stringify({ checks, compositions, videoCounts: 16 }))
  assert.equal(compositions, 620, '124 composition/position combinations in five scenarios')
  app.quit()
}

async function parent() {
  const http = require('node:http')
  const { spawn } = require('node:child_process')
  const server = http.createServer((request, res) => {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host}`)
    if (requestUrl.pathname.startsWith('/view/')) {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(createWeddBetsFixture(requestUrl))
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<!doctype html><title>Toolbar video fixture</title>
      <style>body{margin:0;background:#103cb0}video{width:100vw;height:100vh;object-fit:cover!important;object-position:left bottom!important;background:#103cb0!important}</style>
      <video autoplay muted playsinline></video><canvas hidden width="320" height="180"></canvas>
      <script>
        const canvas = document.querySelector('canvas'), context = canvas.getContext('2d');
        function draw() { context.fillStyle='#103cb0'; context.fillRect(0,0,320,180); context.fillStyle='#fff'; context.font='24px sans-serif'; context.fillText('PLAYING '+Date.now(),10,90); }
        draw(); setInterval(draw,100);
        document.querySelector('video').srcObject=canvas.captureStream(10);
        document.querySelector('video').play();
      </script>`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'quadra-toolbar-'))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const env = { ...process.env, QUADRA_TEST_USER_DATA: userData, QUADRA_TOOLBAR_URL: `${baseUrl}/video`, QUADRA_WEDDBETS_URL: `${baseUrl}/wedd/` }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [__filename, '--worker'], { env, windowsHide: true, stdio: 'inherit' })
  const timer = setTimeout(() => child.kill(), 600000)
  try {
    const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
    assert.equal(code, 0, 'Toolbar integration failed')
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null) child.kill()
    await new Promise((resolve) => server.close(resolve))
    for (let attempt = 0; attempt < 20 && fs.existsSync(userData); attempt++) {
      try { fs.rmSync(userData, { recursive: true, force: true }) } catch { await wait(250) }
    }
  }
}

if (process.argv.includes('--worker')) worker().catch((error) => { console.error(error); require('electron').app.exit(1) })
else parent().catch((error) => { console.error(error); process.exitCode = 1 })
