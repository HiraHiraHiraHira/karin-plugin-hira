declare global {
  var __hiraLoadStart: bigint | undefined
}

globalThis.__hiraLoadStart ??= process.hrtime.bigint()

import('./setup').catch((error) => {
  console.error('[karin-plugin-hira] 插件初始化失败:', error)
})

export {}
