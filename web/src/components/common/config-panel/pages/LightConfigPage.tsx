import type { ConfigPageProps } from './pageTypes'

const LightConfigPage = ({ renderers }: ConfigPageProps) => {
  const { renderListField, renderPageHeader, renderSubSection, renderSwitch, renderTextField } = renderers

  return (
    <>
      {renderPageHeader('轻量', '随机猫图、买家秀、累了、医药查询和推荐软件。')}
      {renderSubSection('轻量命令', (
        <>
          {renderSwitch(['light', 'enabled'], '启用轻量命令', '开启后响应猫图、买家秀、医药查询等轻量命令。')}
          {renderListField(['light', 'catApis'], '猫图 API', '每行一个接口，按顺序尝试。')}
          {renderListField(['light', 'buyerShowApis'], '买家秀 API', '每行一个接口，按顺序尝试。')}
          {renderListField(['light', 'tiredApis'], '累了 API', '每行一个接口，支持 {imgurls: []} 多图响应，多源结果合并后合并转发。')}
          {renderTextField(['light', 'medicineApi'], '医药查询 API', '使用 {keyword} 作为查询关键词占位符。')}
          {renderTextField(['light', 'softwareApi'], '推荐软件 API', '使用 {keyword} 作为查询关键词占位符；留空时使用内置 ghxi 榜单。')}
        </>
      ))}
    </>
  )
}

export default LightConfigPage
