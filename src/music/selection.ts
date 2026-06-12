export const isBareNumericSelection = (message: string) => /^\s*[1-9]\d*\s*$/.test(message)

export const shouldDeferSelection = (message: string, hasSession: boolean) => {
  return isBareNumericSelection(message) && !hasSession
}
