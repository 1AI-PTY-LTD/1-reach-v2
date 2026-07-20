import { describe, it, expect } from 'vitest'
import {
  threadPollInterval,
  conversationDisplayName,
  formatPhone,
} from '../conversation.types'
import {
  createContact,
  createInboundThreadItem,
  createOutboundThreadItem,
} from '../../test/factories'

describe('threadPollInterval', () => {
  it('polls fast while an outbound message is transient', () => {
    const items = [
      createOutboundThreadItem({ status: 'queued' }),
      createInboundThreadItem(),
    ]
    expect(threadPollInterval(items)).toBe(2000)
  })

  it('polls at 5s while awaiting a delivery receipt', () => {
    const items = [createOutboundThreadItem({ status: 'sent' })]
    expect(threadPollInterval(items)).toBe(5000)
  })

  it('never goes fully idle — replies can arrive any time', () => {
    const items = [
      createOutboundThreadItem({ status: 'delivered' }),
      createInboundThreadItem(),
    ]
    expect(threadPollInterval(items)).toBe(15000)
  })

  it('ignores inbound items when deciding cadence', () => {
    expect(threadPollInterval([createInboundThreadItem()])).toBe(15000)
  })

  it('handles an empty thread', () => {
    expect(threadPollInterval([])).toBe(15000)
  })
})

describe('conversationDisplayName', () => {
  it('uses the contact name when present', () => {
    const contact = createContact({ first_name: 'Jane', last_name: 'Smith' })
    expect(conversationDisplayName(contact)).toBe('Jane Smith')
  })

  it('falls back to the formatted phone for auto-created blank-name contacts', () => {
    const contact = createContact({
      first_name: '', last_name: '', phone: '0498888888',
    })
    expect(conversationDisplayName(contact)).toBe('0498 888 888')
  })
})

describe('formatPhone', () => {
  it('formats AU mobiles into 4-3-3 groups', () => {
    expect(formatPhone('0412345678')).toBe('0412 345 678')
  })
})
