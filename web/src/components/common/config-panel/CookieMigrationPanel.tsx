import { useMemo, useState } from 'react'
import { Button, Card, Description, Label, toast } from '@heroui/react'
import { Clipboard, Download, Upload } from 'lucide-react'

import type { ConfigType } from '../../../types/config'
import type { DeviceLayout } from './types'
import {
  exportCookieMigrationPayload,
  importCookieMigrationPayload
} from './cookieMigration'

type CookieMigrationPanelProps = {
  config: ConfigType
  device: DeviceLayout
  onApplyConfig: (config: ConfigType) => void
}

const CookieMigrationPanel = ({ config, device, onApplyConfig }: CookieMigrationPanelProps) => {
  const [exportText, setExportText] = useState('')
  const [importText, setImportText] = useState('')

  const compact = device === 'mobile'
  const exportCount = useMemo(() => {
    const musicCount = Object.values(config.music.cookies).filter(value => value.trim()).length
    const resolverCount = Object.values(config.resolver.cookies).filter(value => value.trim()).length
    return musicCount + resolverCount
  }, [config])

  const handleExport = () => {
    const payload = exportCookieMigrationPayload(config)
    setExportText(payload)
    toast.success(exportCount > 0 ? `已生成 ${exportCount} 项 Cookie 迁移包` : '已生成空 Cookie 迁移包')
  }

  const handleCopy = async () => {
    if (!exportText) {
      toast.warning('请先生成迁移包')
      return
    }

    try {
      await navigator.clipboard.writeText(exportText)
      toast.success('迁移包已复制')
    } catch {
      toast.danger('复制失败，请手动选中迁移包内容')
    }
  }

  const handleImport = () => {
    const result = importCookieMigrationPayload(config, importText)
    if (!result.ok) {
      toast.danger('导入失败', { description: result.message })
      return
    }

    onApplyConfig(result.config)
    toast.success(`已代入 ${result.importedCount} 项 Cookie`, {
      description: '检查无误后点击保存写入配置。'
    })
  }

  return (
    <Card data-config-section className="mb-4">
      <Card.Header className={compact ? 'flex flex-col items-start gap-2' : 'flex items-start justify-between gap-4'}>
        <div className="min-w-0">
          <Card.Title className="text-lg font-semibold">Cookie 迁移</Card.Title>
          <Description>从本地导出 Cookie 迁移包，云端粘贴后代入当前表单，再点击保存。</Description>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size={compact ? 'sm' : 'md'} variant="secondary" onPress={handleExport}>
            <Download size={16} aria-hidden="true" />
            <span>生成</span>
          </Button>
          <Button size={compact ? 'sm' : 'md'} variant="secondary" onPress={handleCopy}>
            <Clipboard size={16} aria-hidden="true" />
            <span>复制</span>
          </Button>
        </div>
      </Card.Header>
      <Card.Content>
        <div className={compact ? 'grid gap-3' : 'grid grid-cols-2 gap-4'}>
          <div className="grid gap-2">
            <Label className="font-semibold">导出内容</Label>
            <textarea
              className="min-h-36 w-full resize-y rounded-large border border-default-200 bg-default-50 px-3 py-2 font-mono text-xs outline-none transition-colors focus:border-primary"
              placeholder="点击生成后，这里会出现可复制到云端的 JSON。"
              value={exportText}
              onChange={(event) => setExportText(event.currentTarget.value)}
            />
            <Description>只包含非空 Cookie。迁移包包含敏感登录态，请只通过可信通道传输。</Description>
          </div>
          <div className="grid gap-2">
            <Label className="font-semibold">导入内容</Label>
            <textarea
              className="min-h-36 w-full resize-y rounded-large border border-default-200 bg-default-50 px-3 py-2 font-mono text-xs outline-none transition-colors focus:border-primary"
              placeholder="在云端粘贴迁移 JSON，然后点击代入。"
              value={importText}
              onChange={(event) => setImportText(event.currentTarget.value)}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Description>导入只覆盖迁移包内出现的非空 Cookie，不会清空其它字段。</Description>
              <Button size={compact ? 'sm' : 'md'} variant="primary" onPress={handleImport}>
                <Upload size={16} aria-hidden="true" />
                <span>代入</span>
              </Button>
            </div>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

export default CookieMigrationPanel
