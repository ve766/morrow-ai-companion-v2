/**
 * Bounded response-body reading for provider responses.
 *
 * `response.text()` reads the whole body before any length check, so a relay
 * can exhaust memory or keep the socket busy past the intended limit. This
 * reader counts real bytes as they arrive, cancels the stream at the limit,
 * and decodes UTF-8 incrementally so a multi-byte character split across
 * chunks is not corrupted.
 */
export class ProviderBodyLimitError extends Error {
  constructor(readonly limitBytes: number) {
    super('Provider response body exceeded the configured limit.')
    this.name = 'ProviderBodyLimitError'
  }
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // A failed cancel must not turn a limit violation into a different error.
  }
}

export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new ProviderBodyLimitError(maxBytes)
  const declared = response.headers.get('content-length')
  if (declared !== null && declared.trim() !== '') {
    const length = Number(declared)
    if (Number.isFinite(length) && length > maxBytes) {
      await cancelBody(response)
      throw new ProviderBodyLimitError(maxBytes)
    }
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      total += value.byteLength
      if (total > maxBytes) {
        try { await reader.cancel() } catch {}
        throw new ProviderBodyLimitError(maxBytes)
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } catch (error) {
    if (error instanceof ProviderBodyLimitError) throw error
    try { await reader.cancel() } catch {}
    throw error
  } finally {
    try { reader.releaseLock() } catch {}
  }
}
