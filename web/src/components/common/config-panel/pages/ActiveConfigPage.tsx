import type { ConfigFileKey } from '../types'
import type { ConfigPageProps } from './pageTypes'
import AiConfigPage from './AiConfigPage'
import AppConfigPage from './AppConfigPage'
import LightConfigPage from './LightConfigPage'
import MusicConfigPage from './MusicConfigPage'
import ResolverConfigPage from './ResolverConfigPage'
import RuntimeConfigPage from './RuntimeConfigPage'
import TranslateConfigPage from './TranslateConfigPage'

interface ActiveConfigPageProps extends ConfigPageProps {
  activeFile: ConfigFileKey
}

const ActiveConfigPage = (props: ActiveConfigPageProps) => {
  switch (props.activeFile) {
    case 'app':
      return <AppConfigPage {...props} />
    case 'music':
      return <MusicConfigPage {...props} />
    case 'resolver':
      return <ResolverConfigPage {...props} />
    case 'runtime':
      return <RuntimeConfigPage {...props} />
    case 'light':
      return <LightConfigPage {...props} />
    case 'translate':
      return <TranslateConfigPage {...props} />
    case 'ai':
      return <AiConfigPage {...props} />
  }
}

export default ActiveConfigPage
