import { describe, expect, it, vi } from 'vitest'
import { ProviderBodyLimitError, readBoundedText } from './bounded-body'

function responseOf(chunks: Uint8Array[], options: { cancel?: () => void; error?: Error; contentLength?: string } = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (options.error) {
        controller.error(options.error)
        return
      }
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
    cancel() {
      options.cancel?.()
    }
  })
  const headers = options.contentLength === undefined ? undefined : { 'content-length': options.contentLength }
  return new Response(stream, headers ? { headers } : undefined)
}

function openResponse(chunks: Uint8Array[], cancel: () => void): Response {
  let index = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]!)
    },
    cancel
  })
  return new Response(stream)
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('bounded provider body reader', () => {
  it('accepts a body exactly at the limit', async () => {
    await expect(readBoundedText(responseOf([bytes('abcd')]), 4)).resolves.toBe('abcd')
  })

  it('rejects one byte over the limit and cancels the reader', async () => {
    const cancel = vi.fn()
    await expect(readBoundedText(openResponse([bytes('abcde')], cancel), 4)).rejects.toBeInstanceOf(ProviderBodyLimitError)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('enforces the real byte count when Content-Length is missing', async () => {
    await expect(readBoundedText(responseOf([bytes('abc'), bytes('def')]), 4)).rejects.toBeInstanceOf(ProviderBodyLimitError)
  })

  it('enforces the real byte count when Content-Length understates it', async () => {
    await expect(readBoundedText(responseOf([bytes('abcdef')], { contentLength: '1' }), 4)).rejects.toBeInstanceOf(ProviderBodyLimitError)
  })

  it('rejects early when Content-Length overstates the limit without reading the body', async () => {
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(bytes('a'))
      },
      cancel() {}
    })
    const response = new Response(stream, { headers: { 'content-length': '999' } })
    await expect(readBoundedText(response, 4)).rejects.toBeInstanceOf(ProviderBodyLimitError)
    expect(pulls).toBe(0)
  })

  it('decodes a multi-byte character split across chunks', async () => {
    const encoded = bytes('你')
    await expect(readBoundedText(responseOf([encoded.slice(0, 1), encoded.slice(1)]), 3)).resolves.toBe('你')
  })

  it('propagates a read error', async () => {
    await expect(readBoundedText(responseOf([], { error: new Error('boom') }), 4)).rejects.toThrow('boom')
  })

  it('keeps the limit error even when cancel throws', async () => {
    const response = responseOf([bytes('abcde')], { cancel: () => { throw new Error('cancel failed') } })
    await expect(readBoundedText(response, 4)).rejects.toBeInstanceOf(ProviderBodyLimitError)
  })

  it('returns an empty string when the response has no body', async () => {
    await expect(readBoundedText(new Response(null), 4)).resolves.toBe('')
  })

  it('enforces the 4 KiB error-hint limit as bytes, not characters', async () => {
    await expect(readBoundedText(responseOf([bytes('x'.repeat(4_097))]), 4_096)).rejects.toBeInstanceOf(ProviderBodyLimitError)
  })
})
