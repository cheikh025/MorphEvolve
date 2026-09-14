import { describe, expect, it } from 'vitest'
import { normalizeAbs, resolveInside } from '../src/path.ts'

const ROOT = String.raw`C:\Users\cheikh\Desktop\dshexp\tasks\ahc001`

describe('normalizeAbs', () => {
  it('lowercases the full Windows key, not just the drive', () => {
    expect(normalizeAbs(ROOT)).toBe('c:/users/cheikh/desktop/dshexp/tasks/ahc001')
  })

  it('collapses dot segments and separators', () => {
    expect(normalizeAbs(String.raw`C:\a\.\b\..\c`)).toBe('c:/a/c')
    expect(normalizeAbs(String.raw`C:/a//b///c`)).toBe('c:/a/b/c')
  })

  it('returns null for relative input', () => {
    expect(normalizeAbs('a/b')).toBeNull()
    expect(normalizeAbs('..\\x')).toBeNull()
    expect(normalizeAbs('')).toBeNull()
  })

  it('normalizes UNC shares', () => {
    expect(normalizeAbs(String.raw`\\SRV\Share\Dir`)).toBe('//srv/share/dir')
  })
})

describe('resolveInside', () => {
  const rootKey = normalizeAbs(ROOT)!

  it('admits absolute paths inside the root', () => {
    expect(resolveInside(rootKey, String.raw`C:\Users\cheikh\Desktop\dshexp\tasks\ahc001\a.txt`))
      .toBe('c:/users/cheikh/desktop/dshexp/tasks/ahc001/a.txt')
    expect(resolveInside(rootKey, String.raw`C:\Users\cheikh\Desktop\dshexp\tasks\ahc001`))
      .toBe('c:/users/cheikh/desktop/dshexp/tasks/ahc001')
  })

  it('admits relative paths inside the root', () => {
    expect(resolveInside(rootKey, 'a.txt')).toBe('c:/users/cheikh/desktop/dshexp/tasks/ahc001/a.txt')
    expect(resolveInside(rootKey, './sub/../ok.txt')).toBe('c:/users/cheikh/desktop/dshexp/tasks/ahc001/ok.txt')
    expect(resolveInside(rootKey, 'sub/ok.txt')).toBe('c:/users/cheikh/desktop/dshexp/tasks/ahc001/sub/ok.txt')
  })

  it('rejects absolute paths outside the root', () => {
    expect(resolveInside(rootKey, String.raw`C:\Users\cheikh\Desktop\deepseek-harness\package.json`)).toBeNull()
    expect(resolveInside(rootKey, String.raw`C:\Windows\win.ini`)).toBeNull()
    expect(resolveInside(rootKey, String.raw`D:\other\file.txt`)).toBeNull()
    expect(resolveInside(rootKey, String.raw`C:\Users\cheikh\Desktop\dshexp\tasks\ahc001-evil\x`)).toBeNull()
  })

  it('rejects relative escapes above the root', () => {
    expect(resolveInside(rootKey, '..\\outside.txt')).toBeNull()
    expect(resolveInside(rootKey, '../outside.txt')).toBeNull()
    expect(resolveInside(rootKey, '../../..\\x')).toBeNull()
  })

  it('is case-insensitive on Windows keys', () => {
    expect(resolveInside(rootKey, String.raw`C:\USERS\CHEIKH\DESKTOP\dshexp\tasks\ahc001\Up.txt`))
      .toBe('c:/users/cheikh/desktop/dshexp/tasks/ahc001/up.txt')
  })
})

describe('resolveInside on POSIX paths', () => {
  it('preserves case for relative and absolute paths within the root', () => {
    const rootKey = normalizeAbs('/work/CandidateA')!
    expect(resolveInside(rootKey, 'Solution.py')).toBe('/work/CandidateA/Solution.py')
    expect(resolveInside(rootKey, '/work/CandidateA/Solution.py')).toBe('/work/CandidateA/Solution.py')
  })

  it('rejects a different directory whose name differs only by case', () => {
    const rootKey = normalizeAbs('/work/candidate')!
    expect(resolveInside(rootKey, '/work/CANDIDATE/secret')).toBeNull()
    expect(resolveInside(rootKey, '../CANDIDATE/secret')).toBeNull()
  })
})
