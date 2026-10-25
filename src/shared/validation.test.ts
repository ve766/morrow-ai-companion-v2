import { describe, expect, it } from 'vitest'
import {
  InputValidationError,
  parseEmptyObject,
  parseMemoryCorrectRequest,
  parseMemoryCreateRequest,
  parseMemoryIdRequest,
  parseMemorySearchRequest,
  parseReminderIdRequest,
  parseReminderRescheduleRequest,
  parseReminderScheduleRequest,
  parseReminderSettingsRequest,
  parseObject
} from './validation'

describe('strict IPC payload validation', () => {
  it('accepts plain objects with only explicitly allowed fields', () => {
    expect(parseObject({ title: 'hello' }, ['title'])).toEqual({ title: 'hello' })
    expect(parseMemoryCreateRequest({ content: '我明确输入的内容。' })).toEqual({ content: '我明确输入的内容。', sensitivity: 'personal' })
  })

  it('rejects null, arrays, primitives, and objects with unsupported prototypes', () => {
    for (const value of [null, [], 'text', 42, true, new Date(), Object.create({ content: 'inherited' })]) {
      expect(() => parseObject(value, ['content'])).toThrow(InputValidationError)
    }
  })

  it('rejects unknown, symbol, non-enumerable, and accessor properties without invoking getters', () => {
    expect(() => parseObject({ title: 'hello', extra: 'not allowed' }, ['title']))
      .toThrow(InputValidationError)
    const symbolPayload = { title: 'hello', [Symbol('extra')]: 'not allowed' }
    expect(() => parseObject(symbolPayload, ['title'])).toThrow(InputValidationError)
    const hiddenPayload = { title: 'hello' }
    Object.defineProperty(hiddenPayload, 'hidden', { value: 'not allowed' })
    expect(() => parseObject(hiddenPayload, ['title'])).toThrow(InputValidationError)
    let getterCalled = false
    const accessorPayload = Object.defineProperty({}, 'content', {
      enumerable: true,
      get() {
        getterCalled = true
        return 'do not evaluate'
      }
    })
    expect(() => parseMemoryCreateRequest(accessorPayload)).toThrow(InputValidationError)
    expect(getterCalled).toBe(false)
  })

  it('allows an empty list request but rejects added fields', () => {
    expect(() => parseEmptyObject(undefined)).not.toThrow()
    expect(() => parseEmptyObject({})).not.toThrow()
    expect(() => parseEmptyObject({ unexpected: 1 })).toThrow(InputValidationError)
    expect(() => parseEmptyObject(null)).toThrow(InputValidationError)
  })

  it('accepts Unicode input and rejects empty, oversized, null-byte, and control-character content', () => {
    expect(parseMemoryCreateRequest({ content: '  你好，世界 🌱\n第二行  ' })).toEqual({ content: '  你好，世界 🌱\n第二行  ', sensitivity: 'personal' })
    for (const content of ['', '   ', 'x'.repeat(4001), 'a\u0000b', 'a\u0007b', null, [], { text: 'x' }]) {
      expect(() => parseMemoryCreateRequest({ content })).toThrow(InputValidationError)
    }
    expect(() => parseMemoryCreateRequest({ content: 'content', sourceCategory: 'model' }))
      .toThrow(InputValidationError)
    expect(() => parseMemoryCorrectRequest({ id: '06d9f3b8-941d-49c6-8214-3b2324c40791', content: ' ' }))
      .toThrow(InputValidationError)
  })

  it('validates query lengths, content, and exact UUID-shaped IDs', () => {
    expect(parseMemorySearchRequest({ query: '  local memory  ' })).toEqual({ query: 'local memory' })
    for (const query of ['', '   ', 'x'.repeat(257), 'x\u0000y', null, ['not a string']]) {
      expect(() => parseMemorySearchRequest({ query })).toThrow(InputValidationError)
    }
    expect(parseMemoryIdRequest({ id: '06d9f3b8-941d-49c6-8214-3b2324c40791' }))
      .toEqual({ id: '06d9f3b8-941d-49c6-8214-3b2324c40791' })
    for (const id of ['', '../../../private.sqlite', '00000000-0000-0000-0000-000000000000', null, 42]) {
      expect(() => parseMemoryIdRequest({ id })).toThrow(InputValidationError)
    }
    expect(() => parseMemoryIdRequest({ id: '06d9f3b8-941d-49c6-8214-3b2324c40791', path: 'private' }))
      .toThrow(InputValidationError)
  })

  it('validates bounded reminder consent, timezone, quiet-hours and local-time payloads', () => {
    const settings = {
      enabled: true,
      goalReviewEnabled: true,
      acceptConsent: true,
      maxPer24Hours: 2,
      cooldownMinutes: 90,
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      timeZone: 'Asia/Shanghai'
    }
    expect(parseReminderSettingsRequest(settings)).toEqual(settings)
    expect(parseReminderScheduleRequest({
      goalId: '06d9f3b8-941d-49c6-8214-3b2324c40791',
      localDateTime: '2026-11-05T09:30'
    })).toEqual({ goalId: '06d9f3b8-941d-49c6-8214-3b2324c40791', localDateTime: '2026-11-05T09:30' })
    expect(parseReminderRescheduleRequest({
      reminderId: '06d9f3b8-941d-49c6-8214-3b2324c40791',
      localDateTime: '2026-11-05T09:30'
    })).toEqual({ reminderId: '06d9f3b8-941d-49c6-8214-3b2324c40791', localDateTime: '2026-11-05T09:30' })
    expect(parseReminderIdRequest({ reminderId: '06d9f3b8-941d-49c6-8214-3b2324c40791' }))
      .toEqual({ reminderId: '06d9f3b8-941d-49c6-8214-3b2324c40791' })
    for (const invalid of [
      { ...settings, enabled: 'true' },
      { ...settings, maxPer24Hours: 4 },
      { ...settings, cooldownMinutes: 29 },
      { ...settings, quietHoursStart: '25:00' },
      { ...settings, quietHoursEnd: '22:00' },
      { ...settings, timeZone: 'Not/A_Zone' },
      { ...settings, unexpected: true }
    ]) expect(() => parseReminderSettingsRequest(invalid)).toThrow(InputValidationError)
    for (const localDateTime of ['2026-02-30T12:00', '2026-11-05T24:00', '2026-11-05']) {
      expect(() => parseReminderScheduleRequest({
        goalId: '06d9f3b8-941d-49c6-8214-3b2324c40791',
        localDateTime
      })).toThrow(InputValidationError)
    }
    expect(() => parseReminderScheduleRequest({
      goalId: '06d9f3b8-941d-49c6-8214-3b2324c40791',
      localDateTime: '2026-11-05T09:30',
      arbitrary: 'ignored fields must be rejected'
    })).toThrow(InputValidationError)
  })
})
