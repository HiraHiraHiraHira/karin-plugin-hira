import fs from 'node:fs'
import path from 'node:path'

import { app as karinApp, authMiddleware, logger } from 'node-karin'
import express from 'node-karin/express'

import { readAllConfig, saveAllConfig, saveConfigModule } from '@/config'
import { validateHiraConfig } from '@/config/validation'
import { Root } from '@/root'
import type { HiraConfig } from '@/types/config'
import { mergeConfigPatch } from '@/web/configAdapter'

type ConfigModule = keyof HiraConfig

const webDistPath = path.join(Root.pluginPath, 'resources', 'web')
const webIndexPath = path.join(webDistPath, 'index.html')
const configModules: ConfigModule[] = ['app', 'music', 'resolver', 'runtime', 'light', 'translate', 'ai']

const isConfigModule = (value: string): value is ConfigModule => {
  return configModules.includes(value as ConfigModule)
}

const sendWebIndex = (res: express.Response) => {
  try {
    const html = fs.readFileSync(webIndexPath, 'utf8')
    res.setHeader('Cache-Control', 'no-cache')
    res.type('html').send(html)
  } catch (error) {
    const message = `[karin-plugin-hira] Failed to read Web UI entry: ${webIndexPath}`
    logger.error(error instanceof Error ? `${message}\n${error.stack ?? error.message}` : `${message}\n${String(error)}`)
    res.status(500).type('text/plain').send(message)
  }
}

const apiRouter = express.Router()
apiRouter.use(express.json({ limit: '2mb' }))
apiRouter.use(express.urlencoded({ extended: true, limit: '2mb' }))

const saveFullConfig = (req: express.Request, res: express.Response) => {
  const nextConfig = req.body?.config ?? req.body
  if (!nextConfig || typeof nextConfig !== 'object' || Array.isArray(nextConfig)) {
    res.status(400).json({
      success: false,
      message: '请求体必须是有效的配置对象',
      data: null
    })
    return
  }

  const merged = mergeConfigPatch(readAllConfig(), nextConfig as Partial<HiraConfig>)
  const errors = validateHiraConfig(merged)
  if (errors.length > 0) {
    res.status(400).json({
      success: false,
      message: errors.join('；'),
      data: null
    })
    return
  }

  saveAllConfig(merged)
  res.json({
    success: true,
    message: 'Hira 配置已保存',
    data: readAllConfig()
  })
}

apiRouter.get('/v1/config', authMiddleware, (_req: express.Request, res: express.Response) => {
  res.json({
    success: true,
    message: '获取配置成功',
    data: readAllConfig()
  })
})

apiRouter.get('/v1/config/:module', authMiddleware, (req: express.Request, res: express.Response) => {
  const moduleName = req.params.module
  if (!isConfigModule(moduleName)) {
    res.status(400).json({
      success: false,
      message: `配置模块 "${moduleName}" 不存在`,
      data: null
    })
    return
  }

  res.json({
    success: true,
    message: '获取配置成功',
    data: readAllConfig()[moduleName]
  })
})

apiRouter.post('/v1/config', authMiddleware, saveFullConfig)
apiRouter.put('/v1/config', authMiddleware, saveFullConfig)

apiRouter.post('/v1/config/:module', authMiddleware, (req: express.Request, res: express.Response) => {
  const moduleName = req.params.module
  if (!isConfigModule(moduleName)) {
    res.status(400).json({
      success: false,
      message: `配置模块 "${moduleName}" 不存在`,
      data: null
    })
    return
  }

  const nextConfig = req.body?.config ?? req.body
  if (!nextConfig || typeof nextConfig !== 'object' || Array.isArray(nextConfig)) {
    res.status(400).json({
      success: false,
      message: '请求体必须是有效的配置对象',
      data: null
    })
    return
  }

  const merged = mergeConfigPatch(readAllConfig(), { [moduleName]: nextConfig } as Partial<HiraConfig>)
  const errors = validateHiraConfig(merged)
  if (errors.length > 0) {
    res.status(400).json({
      success: false,
      message: errors.join('；'),
      data: null
    })
    return
  }

  saveConfigModule(moduleName, merged[moduleName])
  res.json({
    success: true,
    message: '配置更新成功',
    data: readAllConfig()[moduleName]
  })
})

const staticRouter = express.Router()
staticRouter.use(express.static(webDistPath, {
  redirect: false,
  setHeaders: (res: express.Response, filePath: string) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache')
      return
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  }
}))
staticRouter.use((_req: express.Request, res: express.Response) => {
  sendWebIndex(res)
})

karinApp.use('/hira', staticRouter)
karinApp.use('/api/hira', apiRouter)
