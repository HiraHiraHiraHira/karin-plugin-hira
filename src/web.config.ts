import { defineConfig } from 'node-karin'

import { readAllConfig, saveAllConfig } from '@/config'
import { Root } from '@/root'
import { createWebConfigComponents } from '@/web/components'
import { flattenConfig, mergeConfigPatch } from '@/web/configAdapter'

export const webConfig = defineConfig({
  info: {
    id: Root.pluginName,
    name: 'Hira',
    description: `Hira 自用 Karin 插件：点歌、多平台解析、轻量工具与 AI 扩展。v${Root.pluginVersion}`,
    icon: {
      name: 'auto_awesome',
      color: '#14B8A6'
    },
    version: Root.pluginVersion,
    author: {
      name: 'Hira'
    }
  },
  components: () => createWebConfigComponents(),
  save: async (patch: Record<string, unknown>) => {
    const current = readAllConfig()
    const next = mergeConfigPatch(current, patch)
    saveAllConfig(next)
    return {
      success: true,
      message: 'Hira 配置已保存',
      data: flattenConfig(next)
    }
  }
})

export default webConfig
