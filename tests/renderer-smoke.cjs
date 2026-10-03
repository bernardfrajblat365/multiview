const electronModule = require('electron')

// The harness used for Node scripts exports ELECTRON_RUN_AS_NODE. Re-launch
// this same file through the Electron binary so require('electron') exposes
// the real app APIs in every environment.
if (typeof electronModule === 'string') {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(electronModule, [__filename], { stdio: 'inherit', env, windowsHide: true })
  process.exit(result.status ?? 1)
}

const assert = require('node:assert/strict')
const { app, BrowserWindow } = electronModule
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
app.commandLine.appendSwitch('disable-gpu')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'quadra-renderer-smoke-'))
app.setPath('userData', userData)

function waitFrame() {
  return new Promise((resolve) => setTimeout(resolve, 40))
}

async function run() {
  app.disableHardwareAcceleration()
  await app.whenReady()
  const window = new BrowserWindow({
    show: false,
    width: 1920,
    height: 1080,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  window.webContents.setBackgroundThrottling(false)

  let failed = false
  try {
    await window.loadFile(path.join(projectRoot, 'out', 'renderer', 'index.html'))
    const result = await window.webContents.executeJavaScript(`
      (async () => {
        try {
        const waitFrame = () => new Promise((resolve) => setTimeout(resolve, 40))
        const waitFor = async (selector, timeout = 2000) => {
          const start = Date.now()
          while (!document.querySelector(selector)) {
            if (Date.now() - start > timeout) throw new Error('timeout aguardando ' + selector + ' :: ' + document.body.innerHTML.slice(0, 2500))
            await new Promise((resolve) => setTimeout(resolve, 25))
          }
        }
        const readLayout = () => {
          const stage = document.querySelector('.layout-stage')
          const stageRect = stage.getBoundingClientRect()
          const panels = [...document.querySelectorAll('.panel')]
          const rects = panels.map((panel) => {
            const rect = panel.getBoundingClientRect()
            return { id: panel.dataset.panelId, x: rect.left - stageRect.left, y: rect.top - stageRect.top, width: rect.width, height: rect.height }
          })
          let noOverlap = true
          for (let index = 0; index < rects.length; index += 1) {
            for (let other = index + 1; other < rects.length; other += 1) {
              const a = rects[index]
              const b = rects[other]
              const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
              const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
              if (width > 0.5 && height > 0.5) noOverlap = false
            }
          }
          return {
            count: panels.length,
            mode: stage.dataset.layoutMode,
            toolbarHasNoLayoutDescription: !document.querySelector('.toolbar__status'),
            allHaveArea: panels.every((panel) => panel.getBoundingClientRect().width > 0 && panel.getBoundingClientRect().height > 0),
            forms: panels.every((panel) => Boolean(panel.querySelector('input[name="url"]'))),
            noOverlap,
            rects,
          }
        }
        const result = { version: document.querySelector('.app-version')?.textContent ?? '', layouts: [], interactions: {} }
        result.interactions.chooserHasNoCurrentHighlight = document.querySelectorAll('.chooser__card.is-current').length === 0
        const updateButton = document.querySelector('#btn-check-updates')
        const updateStatus = document.querySelector('#update-status')
        result.interactions.updateButtonIsAccessible = updateButton?.getAttribute('aria-describedby') === 'update-status' &&
          updateStatus?.getAttribute('role') === 'status' && updateStatus?.getAttribute('aria-live') === 'polite'
        updateButton.click()
        await waitFrame()
        result.interactions.updateButtonReportsUnavailableInDev = updateStatus.textContent.includes('instalador Windows')

        document.querySelector('#btn-start-one').click()
        await waitFrame()
        result.interactions.startsWithOne = document.querySelectorAll('.panel').length === 1 &&
          document.querySelector('.panel[data-slot="0"] input[name="url"]') === document.activeElement
        result.interactions.singlePanelTrashDisabled = document.querySelector('.panel[data-slot="0"] [data-remove]').disabled
        result.interactions.toolbarRemoveDisabledAtOne = document.querySelector('#btn-remove-panel').disabled
        const firstDraft = document.querySelector('.panel[data-slot="0"] input[name="url"]')
        firstDraft.value = 'https://example.com/draft'
        firstDraft.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector('#btn-add-panel').click()
        await waitFrame()
        const addedPanel = document.querySelector('.panel[data-slot="1"]')
        result.interactions.addsPanel = document.querySelectorAll('.panel').length === 2
        result.interactions.preservesDraft = document.querySelector('.panel[data-slot="0"] input[name="url"]').value === 'https://example.com/draft'
        result.interactions.focusesNewPanel = addedPanel?.querySelector('input[name="url"]') === document.activeElement
        const muteButtons = () => [...document.querySelectorAll('[data-mute]')]
        const isMuted = (button) => button.getAttribute('aria-pressed') === 'true'
        muteButtons()[0].click()
        result.interactions.individualMute = isMuted(muteButtons()[0]) && !isMuted(muteButtons()[1])
        document.querySelector('#btn-mute-all').click()
        result.interactions.globalMute = muteButtons().every(isMuted) && isMuted(document.querySelector('#btn-mute-all'))
        document.querySelector('#btn-add-panel').click()
        await waitFrame()
        result.interactions.newPanelInheritsMute = muteButtons().length === 3 && muteButtons().every(isMuted)
        muteButtons()[1].click()
        result.interactions.individualUnmute = isMuted(muteButtons()[0]) && !isMuted(muteButtons()[1]) &&
          isMuted(muteButtons()[2]) && !isMuted(document.querySelector('#btn-mute-all'))
        document.querySelector('#btn-mute-all').click()
        document.querySelector('#btn-mute-all').click()
        result.interactions.globalUnmute = muteButtons().every((button) => !isMuted(button))
        muteButtons()[0].click()
        document.querySelector('#btn-organize').click()
        document.querySelector('.panel[data-slot="0"] [data-highlight]').click()
        await waitFrame()
        result.interactions.muteSurvivesRender = isMuted(muteButtons()[0]) && !isMuted(muteButtons()[1])
        document.querySelector('.panel[data-slot="0"] [data-highlight]').click()
        document.querySelector('#btn-organize').click()
        muteButtons()[0].click()
        while (document.querySelectorAll('.panel').length < 16) {
          document.querySelector('#btn-add-panel').click()
          await waitFrame()
        }
        result.interactions.addsUntilSixteen = document.querySelectorAll('.panel').length === 16
        result.interactions.disablesAtLimit = document.querySelector('#btn-add-panel').disabled
        const toolbarRemovedId = document.querySelector('.panel[data-slot="15"]').dataset.panelId
        document.querySelector('#btn-remove-panel').click()
        await waitFrame()
        result.interactions.removesLastPanelFromToolbar = document.querySelectorAll('.panel').length === 15 &&
          !document.querySelector('[data-panel-id="' + toolbarRemovedId + '"]') &&
          document.querySelector('#btn-remove-panel').disabled === false
        document.querySelector('#btn-add-panel').click()
        await waitFrame()
        const idsBeforeRemove = [...document.querySelectorAll('.panel')].map((panel) => panel.dataset.panelId)
        const removedId = document.querySelector('.panel[data-slot="7"]').dataset.panelId
        document.querySelector('.panel[data-slot="7"] [data-remove]').click()
        await waitFrame()
        const afterRemove = readLayout()
        const idsAfterRemove = [...document.querySelectorAll('.panel')].map((panel) => panel.dataset.panelId)
        result.interactions.removesChosenPanel = afterRemove.count === 15 && !idsAfterRemove.includes(removedId) &&
          idsAfterRemove.every((id) => idsBeforeRemove.includes(id))
        result.interactions.removeRestoresAutomaticLayout = afterRemove.mode === 'auto' && afterRemove.noOverlap &&
          document.querySelectorAll('.panel.is-highlighted').length === 0
        document.querySelector('#btn-more').click()
        document.querySelector('#btn-undo').click()
        await waitFrame()
        result.interactions.undoRestoresRemovedPanel = document.querySelectorAll('.panel').length === 16 &&
          Boolean(document.querySelector('[data-panel-id="' + removedId + '"]'))
        document.querySelector('#btn-layout').click()
        await waitFrame()
        document.querySelector('.confirm [data-ok]').click()
        await waitFrame()

        for (let count = 1; count <= 16; count += 1) {
          document.querySelector('[data-count="' + count + '"]').click()
          await waitFrame()
          const layout = readLayout()
          layout.expectedCount = count
          layout.className = document.querySelector('.grid')?.className ?? ''
          result.layouts.push(layout)
          document.querySelector('#btn-layout').click()
          await waitFrame()
          document.querySelector('.confirm [data-ok]').click()
          await waitFrame()
        }

        document.querySelector('[data-count="6"]').click()
        await waitFrame()
        const swapSelector = '[data-swap-panel], [data-move], [data-move-to], [data-move-cancel], .move-picker'
        const swapControlCount = () => document.querySelectorAll(swapSelector).length
        const first = document.querySelector('.panel[data-slot="0"]')
        first.querySelector('[data-highlight]').click()
        document.querySelector('.panel[data-slot="1"] [data-highlight]').click()
        await waitFrame()
        const focused = readLayout()
        const highlightedIds = [...document.querySelectorAll('.panel.is-highlighted')].map((panel) => panel.dataset.panelId)
        const largeAreas = focused.rects.filter((rect) => highlightedIds.includes(rect.id)).map((rect) => rect.width * rect.height)
        const smallAreas = focused.rects.filter((rect) => !highlightedIds.includes(rect.id)).map((rect) => rect.width * rect.height)
        result.interactions.twoHighlightsHaveMoreArea = Math.min(...largeAreas) > Math.max(...smallAreas)

        const readPanelState = () => [...document.querySelectorAll('.panel')].map((panel) => ({
          id: panel.dataset.panelId,
          left: parseFloat(panel.style.left || '0'),
          top: parseFloat(panel.style.top || '0'),
          width: parseFloat(panel.style.width || '0'),
          height: parseFloat(panel.style.height || '0'),
          highlighted: panel.classList.contains('is-highlighted'),
        }))
        const samePanelState = (before, after) => before.length === after.length && before.every((item, index) => {
          const next = after[index]
          return item.id === next.id &&
            Math.abs(item.left - next.left) <= 1e-8 &&
            Math.abs(item.top - next.top) <= 1e-8 &&
            Math.abs(item.width - next.width) <= 1e-8 &&
            Math.abs(item.height - next.height) <= 1e-8 &&
            item.highlighted === next.highlighted
        })
        const clickOrganizerPosition = (alias) => {
          const button = document.querySelector('.organize-position[data-organizer-aliases~="' + alias + '"]')
          if (!button) throw new Error('Missing organizer position: ' + alias)
          button.click()
        }
        const selectedOrganizerPosition = () => document.querySelector('.organize-position[aria-pressed="true"]')
        const organizerPanelNodes = () => [...document.querySelectorAll('.panel')]

        document.querySelector('#btn-organize').click()
        await waitFrame()
        result.interactions.swapControlsWhileOrganizeOpen = swapControlCount()
        result.interactions.organizePanelShowsComposition = document.querySelector('.organize-panel') !== null &&
          document.querySelector('[data-composition="2"]').getAttribute('aria-pressed') === 'true'
        result.interactions.noSplitHandles = document.querySelectorAll('.split-handle').length === 0
        const mapSlots = [...document.querySelectorAll('[data-map-panel]')]
        result.interactions.organizeMapMatchesPanels = mapSlots.length === 6
        const mapTarget = mapSlots.find((button) => button.getAttribute('aria-pressed') === 'true')
        const mapTargetId = mapTarget.dataset.mapPanel
        mapTarget.click()
        await waitFrame()
        const realHighlightsAfterMapRemoval = [...document.querySelectorAll('.panel.is-highlighted')].map((panel) => panel.dataset.panelId)
        const removedMapSelection = document.querySelector('[data-map-panel="' + mapTargetId + '"]').getAttribute('aria-pressed') === 'false' &&
          document.querySelector('[data-organize-apply]').disabled &&
          realHighlightsAfterMapRemoval.length === highlightedIds.length &&
          realHighlightsAfterMapRemoval.every((id) => highlightedIds.includes(id))
        document.querySelector('[data-map-panel="' + mapTargetId + '"]').click()
        await waitFrame()
        const restoredMapSelection = document.querySelector('[data-map-panel="' + mapTargetId + '"]').getAttribute('aria-pressed') === 'true' &&
          !document.querySelector('[data-organize-apply]').disabled
        result.interactions.organizeMapSelects = removedMapSelection && restoredMapSelection
        const panelNodesBeforePreview = organizerPanelNodes()
        clickOrganizerPosition('left')
        await waitFrame()
        const previewState = [...document.querySelectorAll('.organize-position[aria-pressed="true"] [data-preview-panel]')].map((cell) => ({
          id: cell.dataset.previewPanel,
          left: parseFloat(cell.style.left || '0'),
          top: parseFloat(cell.style.top || '0'),
          width: parseFloat(cell.style.width || '0'),
          height: parseFloat(cell.style.height || '0'),
        }))
        result.interactions.organizerPreviewPreservesPanelNodes = panelNodesBeforePreview.every((panel, index) => organizerPanelNodes()[index] === panel)
        document.querySelector('[data-organize-apply]').click()
        await waitFrame()
        const appliedLeft = readPanelState()
        result.interactions.organizerPreviewMatchesApplied = previewState.length === appliedLeft.length && previewState.every((preview) => {
          const panel = appliedLeft.find((item) => item.id === preview.id)
          return panel && Math.abs(panel.left - preview.left) <= 1e-8 && Math.abs(panel.top - preview.top) <= 1e-8 &&
            Math.abs(panel.width - preview.width) <= 1e-8 && Math.abs(panel.height - preview.height) <= 1e-8
        })

        document.querySelector('#btn-organize').click()
        await waitFrame()
        clickOrganizerPosition('right')
        await waitFrame()
        const pendingRight = readPanelState()
        const pendingPreservesApplied = samePanelState(appliedLeft, pendingRight)
        document.querySelector('[data-organize-apply]').click()
        await waitFrame()
        const appliedRight = readPanelState()
        result.interactions.positionChoiceMovesHighlight = pendingPreservesApplied && !samePanelState(appliedLeft, appliedRight)

        const organizerStateBeforeCancel = readPanelState()
        document.querySelector('#btn-organize').click()
        await waitFrame()
        clickOrganizerPosition('bottom')
        await waitFrame()
        document.querySelector('[data-organize-cancel]').click()
        await waitFrame()
        result.interactions.organizerCancelPreservesLayout = samePanelState(organizerStateBeforeCancel, readPanelState())

        const organizerStateBeforeEscape = readPanelState()
        document.querySelector('#btn-organize').click()
        await waitFrame()
        document.querySelector('[data-composition="0"]').click()
        await waitFrame()
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await waitFrame()
        result.interactions.organizerEscapeCancels = !document.querySelector('.organize-panel') &&
          samePanelState(organizerStateBeforeEscape, readPanelState())

        const organizerStateBeforeToolbarCancel = readPanelState()
        document.querySelector('#btn-organize').click()
        await waitFrame()
        document.querySelector('[data-composition="0"]').click()
        await waitFrame()
        document.querySelector('#btn-organize').click()
        await waitFrame()
        result.interactions.organizerToolbarCancels = !document.querySelector('.organize-panel') &&
          samePanelState(organizerStateBeforeToolbarCancel, readPanelState())

        const organizerStateBeforeClose = readPanelState()
        document.querySelector('#btn-organize').click()
        await waitFrame()
        document.querySelector('[data-composition="0"]').click()
        await waitFrame()
        document.querySelector('[data-organize-close]').click()
        await waitFrame()
        result.interactions.organizerCloseCancels = !document.querySelector('.organize-panel') &&
          samePanelState(organizerStateBeforeClose, readPanelState())

        document.querySelector('#btn-organize').click()
        await waitFrame()
        document.querySelector('[data-composition="1"]').click()
        await waitFrame()
        document.querySelector('.panel[data-slot="5"] [data-highlight]').click()
        await waitFrame()
        const realHighlightIds = [...document.querySelectorAll('.panel.is-highlighted')].map((panel) => panel.dataset.panelId)
        const draftHighlightIds = [...document.querySelectorAll('[data-map-panel][aria-pressed="true"]')].map((button) => button.dataset.mapPanel)
        result.interactions.organizerExternalChangeResetsDraft = document.querySelector('.organize-panel__notice').textContent.includes('A organização mudou') &&
          realHighlightIds.length === draftHighlightIds.length && realHighlightIds.every((id) => draftHighlightIds.includes(id))

        clickOrganizerPosition('bottom')
        await waitFrame()
        const positionBeforeUrl = selectedOrganizerPosition().dataset.organizerAliases
        const urlPanel = document.querySelector('.panel[data-slot="5"]')
        const urlInput = urlPanel.querySelector('input[name="url"]')
        urlInput.value = 'https://example.com/organizer-draft'
        urlPanel.querySelector('.panel__bar').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await waitFrame()
        result.interactions.organizerUrlPreservesDraft = selectedOrganizerPosition().dataset.organizerAliases === positionBeforeUrl

        const audioButton = document.querySelector('.panel[data-slot="0"] [data-mute]')
        audioButton.click()
        const mutedAfterToggle = audioButton.getAttribute('aria-pressed') === 'true'
        document.querySelector('[data-organize-apply]').click()
        await waitFrame()
        result.interactions.organizerApplyPreservesAudio = mutedAfterToggle &&
          document.querySelector('.panel[data-slot="0"] [data-mute]').getAttribute('aria-pressed') === 'true'

        const stateBeforeChangeA = readPanelState()
        document.querySelector('#btn-organize').click()
        await waitFrame()
        clickOrganizerPosition('top')
        await waitFrame()
        document.querySelector('[data-organize-apply]').click()
        await waitFrame()
        document.querySelector('#btn-organize').click()
        await waitFrame()
        document.querySelector('[data-organize-apply]').click()
        await waitFrame()
        document.querySelector('#btn-more').click()
        document.querySelector('#btn-undo').click()
        await waitFrame()
        result.interactions.organizerNoopDoesNotAddHistory = samePanelState(stateBeforeChangeA, readPanelState())

        document.querySelector('#btn-organize').click()
        await waitFrame()
        result.interactions.swapControlsAfterHighlight = swapControlCount()
        document.querySelector('[data-composition="0"]').click()
        await waitFrame()
        document.querySelector('[data-organize-apply]').click()
        await waitFrame()
        result.interactions.equalMode = document.querySelector('.layout-stage').dataset.layoutMode === 'equal'

        document.querySelector('#btn-more').click()
        await waitFrame()
        document.querySelector('#btn-undo').click()
        await waitFrame()
        result.interactions.undoRestoresOrganize = document.querySelector('.panel.is-highlighted') !== null

        let openPanel = document.querySelector('.panel[data-slot="0"]')
        const input = openPanel.querySelector('input[name="url"]')
        input.value = 'https://example.com/video'
        openPanel.querySelector('.panel__bar').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await waitFrame()
        openPanel = document.querySelector('.panel[data-slot="0"]')
        result.interactions.urlOpens = openPanel.classList.contains('panel--loaded') && Boolean(openPanel.querySelector('.panel__stage'))
        openPanel.querySelector('[data-edit]').click()
        await waitFrame()
        result.interactions.editOpens = openPanel.classList.contains('is-editing')
        openPanel.querySelector('[data-clear]').click()
        await waitFrame()
        result.interactions.clearRestoresEmpty = document.querySelector('.panel[data-slot="0"]').classList.contains('panel--empty')

        document.querySelector('#btn-more').click()
        await waitFrame()
        result.interactions.moreMenuOpens = !document.querySelector('#toolbar-more-menu').hidden
        document.querySelector('#btn-equal').click()
        await waitFrame()
        result.interactions.equalMode = document.querySelector('.layout-stage').dataset.layoutMode === 'equal'

        const countSelect = document.querySelector('#panel-count')
        countSelect.value = '13'
        countSelect.dispatchEvent(new Event('change', { bubbles: true }))
        await waitFrame()
        const heroPanel = document.querySelector('.panel[data-slot="0"]')
        const heroId = heroPanel.dataset.panelId
        heroPanel.querySelector('[data-highlight]').click()
        await waitFrame()
        const thirteen = readLayout()
        const heroRect = thirteen.rects.find((rect) => rect.id === heroId)
        const otherAreas = thirteen.rects.filter((rect) => rect.id !== heroId).map((rect) => rect.width * rect.height)
        result.interactions.thirteenHasHeroQuadrant = Boolean(heroRect) && heroRect.width * heroRect.height > Math.max(...otherAreas) * 3

        const nextCountSelect = document.querySelector('#panel-count')
        nextCountSelect.value = '6'
        nextCountSelect.dispatchEvent(new Event('change', { bubbles: true }))
        await waitFrame()
        const removedFromSix = document.querySelector('.panel[data-slot="3"]').dataset.panelId
        document.querySelector('.panel[data-slot="3"] [data-remove]').click()
        await waitFrame()
        const five = readLayout()
        result.interactions.removeChoosesOptimalPreviousCount = five.count === 5 && five.mode === 'auto' &&
          five.noOverlap && document.querySelectorAll('.panel.is-highlighted').length === 1 &&
          !document.querySelector('[data-panel-id="' + removedFromSix + '"]')

        return result
        } catch (error) { return { version: 'ERROR', error: String(error && error.stack || error) } }
      })()
    `)
    if (result.error) throw new Error(result.error)

    assert.equal(result.version, 'v' + require('../package.json').version)
    assert.equal(result.layouts.length, 16)
    for (const layout of result.layouts) {
      assert.equal(layout.count, layout.expectedCount)
      assert.equal(layout.allHaveArea, true, JSON.stringify(layout))
      assert.equal(layout.toolbarHasNoLayoutDescription, true, JSON.stringify(layout))
      assert.equal(layout.forms, true, JSON.stringify(layout))
      assert.equal(layout.noOverlap, true, JSON.stringify(layout))
      assert.match(layout.className, new RegExp('grid--' + layout.count + '(?: |$)'))
    }
    assert.equal(result.interactions.twoHighlightsHaveMoreArea, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.startsWithOne, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.chooserHasNoCurrentHighlight, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.updateButtonIsAccessible, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.updateButtonReportsUnavailableInDev, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.singlePanelTrashDisabled, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.toolbarRemoveDisabledAtOne, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.addsPanel, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.preservesDraft, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.focusesNewPanel, true, JSON.stringify(result.interactions))
    for (const name of ['individualMute', 'globalMute', 'newPanelInheritsMute', 'individualUnmute', 'globalUnmute', 'muteSurvivesRender']) {
      assert.equal(result.interactions[name], true, name)
    }
    assert.equal(result.interactions.addsUntilSixteen, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.disablesAtLimit, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.removesLastPanelFromToolbar, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.removesChosenPanel, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.removeRestoresAutomaticLayout, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.undoRestoresRemovedPanel, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.organizePanelShowsComposition, true)
    assert.equal(result.interactions.noSplitHandles, true)
    assert.equal(result.interactions.organizeMapMatchesPanels, true)
    assert.equal(result.interactions.organizeMapSelects, true)
    assert.equal(result.interactions.swapControlsWhileOrganizeOpen, 0,
      'A funcionalidade de troca não deve estar disponível com Organizar aberto.')
    assert.equal(result.interactions.organizerPreviewPreservesPanelNodes, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.organizerPreviewMatchesApplied, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.positionChoiceMovesHighlight, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.organizerCancelPreservesLayout, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.organizerEscapeCancels, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.organizerToolbarCancels, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.organizerCloseCancels, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.organizerExternalChangeResetsDraft, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.organizerUrlPreservesDraft, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.organizerApplyPreservesAudio, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.organizerNoopDoesNotAddHistory, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.undoRestoresOrganize, true)
    assert.equal(result.interactions.swapControlsAfterHighlight, 0,
      'A funcionalidade de troca não deve reaparecer após uma nova renderização.')
    assert.equal(result.interactions.urlOpens, true)
    assert.equal(result.interactions.editOpens, true)
    assert.equal(result.interactions.clearRestoresEmpty, true)
    assert.equal(result.interactions.moreMenuOpens, true)
    assert.equal(result.interactions.equalMode, true)
    assert.equal(result.interactions.thirteenHasHeroQuadrant, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.removeChoosesOptimalPreviousCount, true, JSON.stringify(result.interactions))
    console.log(JSON.stringify(result))
  } catch (error) {
    failed = true
    console.error(error)
  } finally {
    window.destroy()
    setTimeout(() => app.exit(failed ? 1 : 0), 50)
    for (let attempt = 0; attempt < 20 && fs.existsSync(userData); attempt += 1) {
      try { fs.rmSync(userData, { recursive: true, force: true }) } catch { await new Promise((resolve) => setTimeout(resolve, 100)) }
    }
  }
}

run().catch((error) => {
  console.error(error)
  setTimeout(() => app.exit(1), 50)
})
