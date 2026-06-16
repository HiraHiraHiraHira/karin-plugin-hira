import type { ConfigPageProps } from './pageTypes'

const TranslateConfigPage = ({ renderers }: ConfigPageProps) => {
  const { renderPageHeader, renderSubSection, renderSwitch, renderTextField } = renderers

  return (
    <>
      {renderPageHeader('翻译', '翻中、翻英、翻日等翻译命令使用的接口配置。')}
      {renderSubSection('翻译接口', (
        <>
          {renderSwitch(['translate', 'enabled'], '启用翻译', '开启后响应翻译命令。')}
          {renderTextField(['translate', 'deeplxApi'], 'DeepLX API', '可选，留空时不使用 DeepLX。')}
          {renderTextField(['translate', 'tencentApi'], '腾讯/彩云翻译 API', '翻译备用接口地址。')}
          {renderTextField(['translate', 'timeoutSeconds'], '翻译超时（秒）', '翻译请求的超时时间。', { type: 'number', fallback: 15, min: 3, max: 120 })}
        </>
      ))}
    </>
  )
}

export default TranslateConfigPage
