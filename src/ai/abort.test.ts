import { expect, it } from 'vitest'
import { abortable, pause } from './abort'

it('releases the UI immediately without waiting for an uncooperative transport', async () => {
  const controller = new AbortController()
  const result = abortable(new Promise(() => {}), controller.signal)
  controller.abort(new Error('stop'))
  await expect(result).rejects.toThrow('stop')
})
it('interrupts the ComfyUI polling delay', async () => {
  const controller = new AbortController()
  const result = pause(30000, controller.signal)
  controller.abort(new Error('stop'))
  await expect(result).rejects.toThrow('stop')
})
