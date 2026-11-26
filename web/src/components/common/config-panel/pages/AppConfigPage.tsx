import type { ConfigPageProps } from './pageTypes'

const AppConfigPage = ({ renderers }: ConfigPageProps) => {
  const { renderPageHeader, renderSubSection, renderSwitch, renderTextField } = renderers

  return (
    <>
      {renderPageHeader('基础', '插件总开关、帮助命令、状态命令、普通回复前缀和上游更新推送。')}
      {renderSubSection('插件行为', (
        <>
          {renderSwitch(['app', 'enabled'], '启用插件', '关闭后 Hira 不再响应自身功能命令。')}
          {renderTextField(['app', 'replyPrefix'], '回复前缀', '普通命令回复使用；多平台解析结果不会额外追加该前缀。')}
          {renderTextField(['app', 'helpCommand'], '帮助命令', '用于展示 Hira 帮助面板。')}
          {renderTextField(['app', 'statusCommand'], '状态命令', '用于查看 Hira 运行状态。')}
        </>
      ))}
      {renderSubSection('更新推送', (
        <>
          {renderSwitch(['app', 'updateNotify', 'enabled'], '定时检测上游更新', '开启后按间隔检测上游 Git/npm 新版本并推送更新卡片。')}
          {renderSwitch(['app', 'updateNotify', 'notifyMasters'], '私聊推送给主人', '自动私聊通知已加好友的主人，支持引用回复“更新”一键升级。')}
          {renderTextField(['app', 'updateNotify', 'intervalHours'], '检测间隔（小时）', '定时检查上游更新的最小间隔（1-168 小时），保存后立即生效。', { type: 'number', min: 1, max: 168, fallback: 6 })}
          {renderTextField(['app', 'updateNotify', 'groupIds'], '额外推送群号', '可选，多个群号用逗号或空格分隔；留空则仅推送给主人。', { placeholder: '例如 123456789, 987654321' })}
        </>
      ))}
    </>
  )
}

export default AppConfigPage
