export const isSemverGreater = (remote: string, local: string): boolean => {
  if (!remote || !local) return false

  const parse = (value: string) => {
    const normalized = value.trim().replace(/^[vV]/, '')
    const [withoutBuild] = normalized.split('+', 2)
    const [core, prereleaseText] = withoutBuild.split('-', 2)
    const [major = '0', minor = '0', patch = '0'] = core.split('.')

    return {
      major: Number.parseInt(major, 10) || 0,
      minor: Number.parseInt(minor, 10) || 0,
      patch: Number.parseInt(patch, 10) || 0,
      prerelease: prereleaseText ? prereleaseText.split('.') : []
    }
  }

  const compareIdentifier = (left: string, right: string) => {
    const leftNumeric = /^\d+$/.test(left)
    const rightNumeric = /^\d+$/.test(right)

    if (leftNumeric && rightNumeric) {
      const leftNumber = Number.parseInt(left, 10)
      const rightNumber = Number.parseInt(right, 10)
      if (leftNumber === rightNumber) return 0
      return leftNumber > rightNumber ? 1 : -1
    }

    if (leftNumeric) return -1
    if (rightNumeric) return 1
    if (left === right) return 0
    return left > right ? 1 : -1
  }

  const remoteVersion = parse(remote)
  const localVersion = parse(local)

  if (remoteVersion.major !== localVersion.major) return remoteVersion.major > localVersion.major
  if (remoteVersion.minor !== localVersion.minor) return remoteVersion.minor > localVersion.minor
  if (remoteVersion.patch !== localVersion.patch) return remoteVersion.patch > localVersion.patch

  const remotePrerelease = remoteVersion.prerelease
  const localPrerelease = localVersion.prerelease
  if (remotePrerelease.length === 0 && localPrerelease.length === 0) return false
  if (remotePrerelease.length === 0) return true
  if (localPrerelease.length === 0) return false

  const length = Math.min(remotePrerelease.length, localPrerelease.length)
  for (let index = 0; index < length; index += 1) {
    const result = compareIdentifier(remotePrerelease[index], localPrerelease[index])
    if (result !== 0) return result > 0
  }

  return remotePrerelease.length > localPrerelease.length
}
