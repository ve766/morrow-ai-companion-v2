export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

// Values recorded under these keys are never written to logs even when a
// caller accidentally passes them; keys are matched case-insensitively.
const REDACTED_KEYS = new Set([
  'apikey', 'api_key', 'authorization', 'token', 'secret', 'password', 'credential',
  'requestpayload', 'exactpayload', 'prompt', 'content', 'body', 'context'
])

const REDACTED_PLACEHOLDER = '[redacted]'

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return REDACTED_PLACEHOLDER
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1))
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(record)) {
      output[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED_PLACEHOLDER : redact(item, depth + 1)
    }
    return output
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 200)}…[truncated ${value.length - 200} chars]`
  return value
}

export interface Logger {
  debug(source: string, message: string, fields?: Record<string, unknown>): void
  info(source: string, message: string, fields?: Record<string, unknown>): void
  warn(source: string, message: string, fields?: Record<string, unknown>): void
  error(source: string, message: string, fields?: Record<string, unknown>): void
}

export interface LoggerOptions {
  minimumLevel?: LogLevel
  sink?: (line: string) => void
  clock?: () => string
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const minimum = LEVEL_WEIGHT[options.minimumLevel ?? 'info']
  const sink = options.sink ?? ((line: string) => {
    process.stderr.write(`${line}\n`)
  })
  const clock = options.clock ?? (() => new Date().toISOString())
  const emit = (level: LogLevel, source: string, message: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_WEIGHT[level] < minimum) return
    const entry = {
      ts: clock(),
      level,
      source: source.slice(0, 64),
      msg: message.slice(0, 300),
      ...(fields && Object.keys(fields).length > 0 ? { fields: redact(fields) as Record<string, unknown> } : {})
    }
    try {
      sink(JSON.stringify(entry))
    } catch {
      // Logging must never take the application down.
    }
  }
  return {
    debug: (source, message, fields) => emit('debug', source, message, fields),
    info: (source, message, fields) => emit('info', source, message, fields),
    warn: (source, message, fields) => emit('warn', source, message, fields),
    error: (source, message, fields) => emit('error', source, message, fields)
  }
}

export const silentLogger: Logger = createLogger({ minimumLevel: 'error', sink: () => {} })
