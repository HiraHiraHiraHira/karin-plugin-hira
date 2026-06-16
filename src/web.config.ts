import { defineConfig } from 'node-karin'

import { Root } from '@/root'

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
  page: {
    url: process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:5177/hira/karin-config' : '/hira/karin-config',
    title: 'Hira 配置管理',
    description: '使用 Hira 插件自带的配置管理页面'
  }
})

export default webConfig
