/**
 * Case-normalized path containment for the candidate-builder confinement guard.
 *
 * Windows/UNC keys are fully lowercased (NTFS is case-insensitive); POSIX keys
 * keep their case. The functions are pure string logic and safe to run on any
 * platform, including inside the sandbox realms where Node path APIs are
 * unavailable.
 * @module dsh-candidate-builder/path
 */

/**
 * Canonicalize an absolute path into a comparable key: separators normalized,
 * `.` dropped, `..` collapsed (a pop below the root clamps to the root, which
 * is correct for the CONFINED ROOT itself — escape detection belongs to
 * {@link resolveInside}).
 * @param p - the path to canonicalize.
 * @returns the normalized key, or `null` when `p` is not absolute.
 */
export function normalizeAbs(p: string): string | null {
  if (typeof p !== 'string' || p.length === 0) return null
  const s = p.replace(/\\/g, '/')
  let prefix = ''
  let rest = s
  const drive = /^([a-zA-Z]):\//.exec(s)
  const unc = /^\/\/([^/]+)\/([^/]+)\//.exec(s)
  const windows = drive !== null || unc !== null
  if (drive !== null) {
    prefix = s.slice(0, 2).toLowerCase() + '/'
    rest = s.slice(3)
  } else if (unc !== null) {
    const host = unc[1]
    const share = unc[2]
    if (host === undefined || share === undefined) return null
    prefix = '//' + host.toLowerCase() + '/' + share.toLowerCase() + '/'
    rest = s.slice(unc[0].length)
  } else if (s.startsWith('/')) {
    prefix = '/'
    rest = s.slice(1)
  } else {
    return null
  }
  const parts: string[] = []
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') { parts.pop(); continue }
    parts.push(part)
  }
  const key = parts.length === 0 ? prefix : prefix + parts.join('/')
  return windows ? key.toLowerCase() : key
}

/**
 * Resolve `p` (absolute or relative) against the confined root and return the
 * normalized key when it stays inside, or `null` when it escapes — including
 * a relative `..` that climbs past the root and an absolute path on another
 * drive or share.
 * @param rootKey - the normalized confined root from {@link normalizeAbs}.
 * @param p - the candidate path argument.
 * @returns the contained normalized key, or `null` when `p` escapes.
 */
export function resolveInside(rootKey: string, p: string): string | null {
  if (typeof p !== 'string' || p.length === 0) return null
  const s = p.replace(/\\/g, '/')
  const drive = /^([a-zA-Z]):\//.exec(s)
  const unc = /^\/\/([^/]+)\/([^/]+)\//.exec(s)
  let base: string[]
  let rest: string
  if (drive !== null) { base = [s.slice(0, 2).toLowerCase()]; rest = s.slice(3) }
  else if (unc !== null) {
    const host = unc[1]
    const share = unc[2]
    if (host === undefined || share === undefined) return null
    base = ['//' + host.toLowerCase() + '/' + share.toLowerCase()]
    rest = s.slice(unc[0].length)
  }
  else if (s.startsWith('/')) { base = ['']; rest = s.slice(1) }
  else { base = rootKey.split('/'); rest = s }
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (base.length === 0) return null
      base.pop()
      continue
    }
    base.push(part)
  }
  const resolved = base.join('/')
  const windows = /^[a-zA-Z]:\//.test(rootKey) || rootKey.startsWith('//')
  const joined = windows ? resolved.toLowerCase() : resolved
  const rk = rootKey.endsWith('/') ? rootKey.slice(0, -1) : rootKey
  if (joined === rk || joined.startsWith(rk + '/')) return joined
  return null
}
