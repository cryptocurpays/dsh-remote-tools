import { describe, expect, it } from 'vitest'
import { hasReadySentinel, READY_SENTINEL } from '../src/session.ts'

describe('terminal-ssh readiness sentinel', () => {
  it('matches the sentinel only as its own output line', () => {
    const viewport = `date; echo ${READY_SENTINEL}\r\n\r\nTue Aug 25 23:28:23 CST 2026\r\n${READY_SENTINEL}\r\n[readuser@host ~]$ `
    expect(hasReadySentinel(viewport)).toBe(true)
  })

  it('rejects the echoed input line, which contains the marker only as a substring', () => {
    const echoed = `whoami; echo __DSH_EXIT__=$?; echo ${READY_SENTINEL}\r\nreaduser\r\n`
    expect(hasReadySentinel(echoed)).toBe(false)
  })

  it('tolerates the trailing CR the PTY writes after the marker', () => {
    expect(hasReadySentinel(`${READY_SENTINEL}\r\n`)).toBe(true)
    expect(hasReadySentinel(READY_SENTINEL)).toBe(true)
  })
})
