declare global {
  var __hiraLoadStart: bigint | undefined
}

globalThis.__hiraLoadStart ??= process.hrtime.bigint()

import('./setup')

export {}
