import { describe, expect, it } from 'vitest'
import { estimateSmsSegments } from '../sms'

// Mirrors backend/tests/utils/test_segments.py — the two implementations
// must agree (the backend bills on its count).
describe('estimateSmsSegments', () => {
  it('counts GSM-7 text at 160/153', () => {
    expect(estimateSmsSegments('')).toBe(1)
    expect(estimateSmsSegments('a'.repeat(160))).toBe(1)
    expect(estimateSmsSegments('a'.repeat(161))).toBe(2)
    expect(estimateSmsSegments('a'.repeat(306))).toBe(2)
    expect(estimateSmsSegments('a'.repeat(307))).toBe(3)
  })

  it('charges GSM extension characters two septets', () => {
    expect(estimateSmsSegments('€'.repeat(80))).toBe(1)
    expect(estimateSmsSegments('€'.repeat(81))).toBe(2)
  })

  it('switches to UCS-2 (70/67) when any char is non-GSM', () => {
    expect(estimateSmsSegments('a'.repeat(68) + '🎉')).toBe(1) // 70 UTF-16 units
    expect(estimateSmsSegments('a'.repeat(69) + '🎉')).toBe(2) // 71 units
    expect(estimateSmsSegments('☃'.repeat(70))).toBe(1)
    expect(estimateSmsSegments('☃'.repeat(71))).toBe(2)
    expect(estimateSmsSegments('☃'.repeat(135))).toBe(3)
  })

  it('a 306-char unicode message is five segments, not two', () => {
    expect(estimateSmsSegments('猫'.repeat(306))).toBe(5)
  })
})
