import type { ConfigPageProps } from './pageTypes'

const AiConfigPage = ({ renderers }: ConfigPageProps) => {
  const { renderListField, renderPageHeader, renderSubSection, renderSwitch, renderTextField } = renderers

  return (
    <>
      {renderPageHeader('AI', '兼容 OpenAI 接口格式的网页总结配置。')}
      {renderSubSection('网页总结', (
        <>
          {renderSwitch(['ai', 'summaryEnabled'], '启用网页总结', '开启后可使用网页总结命令。')}
          {renderTextField(['ai', 'apiBaseUrl'], 'AI API 地址', '兼容 OpenAI 接口格式的 API 地址。')}
          {renderTextField(['ai', 'model'], '总结模型', '用于网页总结的模型名称。')}
          {renderTextField(['ai', 'apiKey'], 'AI API Key', '可选；启用网页总结时通常需要填写。已配置值显示为掩码，直接保存会保留原值，清空后才会删除。', { type: 'password' })}
          {renderTextField(['ai', 'maxInputChars'], '最大输入字符数', '发送给模型前保留的网页正文最大长度。', { type: 'number', fallback: 12000, min: 1000, max: 200000 })}
          {renderListField(['ai', 'autoSummaryDomains'], '自动总结域名', '消息里出现这些域名的链接时自动总结（需开启网页总结），每行一个域名，子域名同样命中。')}
        </>
      ))}
    </>
  )
}

export default AiConfigPage
