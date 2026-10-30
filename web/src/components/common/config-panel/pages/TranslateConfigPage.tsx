import type { ConfigPageProps } from './pageTypes'

const TranslateConfigPage = ({ renderers }: ConfigPageProps) => {
  const { renderPageHeader, renderSubSection, renderSwitch, renderTextField } = renderers

  return (
    <>
      {renderPageHeader('翻译', '翻中、翻英、翻日等翻译命令使用的接口配置。')}
      {renderSubSection('翻译接口', (
        <>
          {renderSwitch(['translate', 'enabled'], '启用翻译', '开启后响应翻译命令。')}
          {renderTextField(['translate', 'deeplxApi'], 'DeepLX API', '可选，留空时只用腾讯交互翻译；支持逗号分隔多个镜像，每次随机选取。')}
          {renderTextField(['translate', 'tencentApi'], '腾讯交互翻译 API', 'transmart 协议接口，默认匿名可用；DeepLX 失败或未配置时使用。')}
          {renderTextField(['translate', 'timeoutSeconds'], '翻译超时（秒）', '翻译请求的超时时间。', { type: 'number', fallback: 15, min: 3, max: 120 })}
        </>
      ))}
    </>
  )
}

export default TranslateConfigPage
