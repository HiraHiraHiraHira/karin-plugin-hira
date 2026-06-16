import type { ConfigPanelLayoutClasses } from '../../../../styles/desktopConfigPanel'
import type { ConfigType } from '../../../../types/config'
import type { ConfigFieldRenderers, ConfigPath, DeviceLayout } from '../types'

export interface ConfigPageProps {
  classes: ConfigPanelLayoutClasses
  config: ConfigType
  device: DeviceLayout
  renderers: ConfigFieldRenderers
  updateConfigValue: (path: ConfigPath, value: unknown) => void
}
