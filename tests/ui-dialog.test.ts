import assert from 'node:assert/strict'
import test from 'node:test'
import type { MessageBoxOptions } from 'electron'
import { createUiMessageBox, type UiDialogRequest } from '../electron/ui-dialog.ts'

const options: MessageBoxOptions = {
  type: 'info',
  title: 'Atualização disponível',
  message: 'A versão v1.1.10 do Quadra está disponível.',
  detail: 'Novidades:\n• Uma\n• Duas',
  buttons: ['Atualizar', 'Agora não'],
  defaultId: 0,
  cancelId: 1,
}

function boxWith(sent: UiDialogRequest[], accept = true) {
  const fallbacks: MessageBoxOptions[] = []
  const box = createUiMessageBox({
    send: (request) => {
      if (accept) sent.push(request)
      return accept
    },
    fallback: async (fallbackOptions) => {
      fallbacks.push(fallbackOptions)
      return { response: 1 } as never
    },
  })
  return { box, fallbacks }
}

test('envia o pedido ao overlay e devolve o botão escolhido', async () => {
  const sent: UiDialogRequest[] = []
  const { box } = boxWith(sent)
  const answer = box.show(options)
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], {
    id: sent[0]!.id,
    title: 'Atualização disponível',
    message: 'A versão v1.1.10 do Quadra está disponível.',
    detail: 'Novidades:\n• Uma\n• Duas',
    buttons: ['Atualizar', 'Agora não'],
    defaultId: 0,
    cancelId: 1,
  })
  assert.equal(box.respond(sent[0]!.id, 0), true)
  assert.equal((await answer).response, 0)
})

test('ignora respostas inválidas, repetidas ou de outro diálogo', async () => {
  const sent: UiDialogRequest[] = []
  const { box } = boxWith(sent)
  const answer = box.show(options)
  const id = sent[0]!.id
  assert.equal(box.respond(id + 1, 0), false)
  assert.equal(box.respond(String(id), 0), false)
  assert.equal(box.respond(id, 2), false)
  assert.equal(box.respond(id, -1), false)
  assert.equal(box.respond(id, 0.5), false)
  assert.equal(box.respond(id, '0'), false)
  assert.equal(box.respond(id, 1), true)
  assert.equal(box.respond(id, 0), false)
  assert.equal((await answer).response, 1)
})

test('usa o diálogo nativo quando o overlay não pode mostrar', async () => {
  const sent: UiDialogRequest[] = []
  const { box, fallbacks } = boxWith(sent, false)
  const result = await box.show(options)
  assert.equal(result.response, 1)
  assert.deepEqual(fallbacks, [options])
  assert.equal(box.respond(1, 0), false)
})

test('cancelAll responde Cancelar em todos os diálogos abertos', async () => {
  const sent: UiDialogRequest[] = []
  const { box } = boxWith(sent)
  const first = box.show(options)
  const second = box.show({ ...options, buttons: ['Reiniciar e instalar', 'Depois', 'Nunca'], cancelId: 2 })
  box.cancelAll()
  assert.equal((await first).response, 1)
  assert.equal((await second).response, 2)
  assert.equal(box.respond(sent[0]!.id, 0), false)
})

test('cancelId e defaultId fora dos botões voltam a valores seguros e textos são limitados', async () => {
  const sent: UiDialogRequest[] = []
  const { box } = boxWith(sent)
  void box.show({ ...options, buttons: ['Sim', '', 'Não'], defaultId: 9, cancelId: -3, detail: 'x'.repeat(9000) })
  assert.deepEqual(sent[0]!.buttons, ['Sim', 'Não'])
  assert.equal(sent[0]!.defaultId, 0)
  assert.equal(sent[0]!.cancelId, 1)
  assert.equal(sent[0]!.detail.length, 4000)
  box.cancelAll()
})

test('sem botões cai no diálogo nativo', async () => {
  const sent: UiDialogRequest[] = []
  const { box, fallbacks } = boxWith(sent)
  await box.show({ type: 'info', message: 'sem botões' })
  assert.equal(sent.length, 0)
  assert.equal(fallbacks.length, 1)
})
