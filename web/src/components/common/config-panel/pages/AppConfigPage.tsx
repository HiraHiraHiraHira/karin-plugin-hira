import type { ConfigPageProps } from './pageTypes'

const AppConfigPage = ({ renderers }: ConfigPageProps) => {
  const { renderPageHeader, renderSubSection, renderSwitch, renderTextField } = renderers

  return (
    <>
      {renderPageHeader('基础', '插件总开关、帮助命令、状态命令和普通回复前缀。')}
      {renderSubSection('插件行为', (
        <>
          {renderSwitch(['app', 'enabled'], '启用插件', '关闭后 Hira 不再响应自身功能命令。')}
          {renderTextField(['app', 'replyPrefix'], '回复前缀', '普通命令回复使用；多平台解析结果不会额外追加该前缀。')}
          {renderTextField(['app', 'helpCommand'], '帮助命令', '用于展示 Hira 帮助面板。')}
          {renderTextField(['app', 'statusCommand'], '状态命令', '用于查看 Hira 运行状态。')}
        </>
      ))}
    </>
  )
}

export default AppConfigPage
