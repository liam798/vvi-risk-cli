export class CliError extends Error {
  code?: string
  status?: number

  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'CliError'
    this.code = options.code
    this.status = options.status
  }
}

export function printResult(jsonMode: boolean, command: string, data: unknown): void {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify({ ok: true, command, data }, null, 2)}\n`)
    return
  }
  process.stdout.write(`${formatHuman(data)}\n`)
}

export function printError(jsonMode: boolean, error: unknown): never {
  const normalized = normalizeError(error)
  if (jsonMode) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: normalized }, null, 2)}\n`)
  } else {
    process.stderr.write(`${normalized.message}\n`)
  }
  process.exit(1)
}

export function formatHuman(data: unknown): string {
  if (typeof data === 'string') return data
  return JSON.stringify(data, null, 2)
}

function normalizeError(error: unknown): { message: string; code?: string; status?: number } {
  if (error instanceof CliError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  if (error instanceof Error) {
    return { message: error.message }
  }
  return { message: String(error) }
}
