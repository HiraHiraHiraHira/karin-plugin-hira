import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { defineConfig } from 'vitest/config'

const projectRoot = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const isolatedConfigDir = path.join(os.tmpdir(), 'karin-plugin-hira-vitest-config')

// 测试必须从空配置目录读默认值，否则开发机 @karinjs 下的真实 YAML 会让断言随环境漂移。
fs.rmSync(isolatedConfigDir, { recursive: true, force: true })
process.env.HIRA_CONFIG_ROOT = isolatedConfigDir

export default defineConfig({
  root: projectRoot,
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    pool: 'forks'
  },
  resolve: {
    // `@/config` 与 `@/config/index` 等写法必须解析到同一个模块实例，否则测试里改到的
    // 配置副本和被测代码读到的那份会分叉。
    alias: [
      { find: /^@\/(.*)$/, replacement: `${path.join(projectRoot, 'src')}/$1` },
      { find: 'node-karin/root', replacement: path.join(projectRoot, 'node_modules/node-karin/dist/root.mjs') },
      { find: 'node-karin', replacement: path.join(projectRoot, 'node_modules/node-karin/dist/index.mjs') }
    ]
  }
})
