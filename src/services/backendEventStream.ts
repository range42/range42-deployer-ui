/** Fetch-based SSE transport for gateways that require an Authorization header.
 * Reconnection and event cursors remain owned by deploymentStore.
 */
export class BackendEventStream {
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  private controller = new AbortController()
  private reader?: ReadableStreamDefaultReader<Uint8Array>
  private closed = false

  constructor(url: string, headers: Record<string, string>) {
    void this.read(url, headers)
  }

  close() {
    this.closed = true
    this.controller.abort()
    void this.reader?.cancel().catch(() => {})
  }

  private async read(url: string, headers: Record<string, string>) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/event-stream', ...headers },
        credentials: 'same-origin',
        signal: this.controller.signal,
      })
      if (this.closed) return
      if (!response.ok || !response.body
        || !response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
        throw new Error('Deployment event stream is unavailable')
      }
      this.reader = response.body.getReader()
      this.onopen?.(new Event('open'))
      const decoder = new TextDecoder()
      let buffer = ''
      let data: string[] = []
      while (!this.closed) {
        const { value, done } = await this.reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, '')
          buffer = buffer.slice(newline + 1)
          if (line === '') {
            if (data.length && !this.closed) {
              // The backend names events (event: task_start, etc.). All carry
              // the same JSON envelope, so dispatch each data frame once.
              this.onmessage?.(new MessageEvent('message', { data: data.join('\n') }))
            }
            data = []
          } else if (line === 'data' || line.startsWith('data:')) {
            data.push(line.slice(5).replace(/^ /, ''))
          }
        }
      }
      if (!this.closed) this.onerror?.(new Event('error'))
    } catch {
      if (!this.closed) this.onerror?.(new Event('error'))
    } finally {
      this.reader?.releaseLock()
    }
  }
}
