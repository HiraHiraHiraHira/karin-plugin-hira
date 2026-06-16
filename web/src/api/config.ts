import { authClient } from '../auth/request'
import type { ApiResponse } from '../types/api'
import type { ConfigType } from '../types/config'

const API_BASE_URL = '/api/hira/v1'

export const getConfig = async (): Promise<ConfigType> => {
  const response = await authClient.get<ApiResponse<ConfigType>>(`${API_BASE_URL}/config`)
  if (response.data.success && response.data.data) return response.data.data
  throw new Error(response.data.message || '获取配置失败')
}

export const saveConfig = async (config: ConfigType): Promise<void> => {
  const response = await authClient.post<ApiResponse>(`${API_BASE_URL}/config`, config)
  if (!response.data.success) {
    throw new Error(response.data.message || '保存配置失败')
  }
}
