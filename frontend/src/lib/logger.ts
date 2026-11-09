// Thin wrapper around console so call sites are consistent and a single
// place exists to redirect output (e.g. to a remote sink) later, without
// touching every call site.
type Level = 'info' | 'warn' | 'error'

function emit(level: Level, message: string, context?: unknown) {
  const line = `[${new Date().toISOString()}] ${message}`
  if (context !== undefined) {
    console[level](line, context)
  } else {
    console[level](line)
  }
}

export const logger = {
  info: (message: string, context?: unknown) => emit('info', message, context),
  warn: (message: string, context?: unknown) => emit('warn', message, context),
  error: (message: string, context?: unknown) => emit('error', message, context),
}
