import { describe, it, expect } from 'vitest'
import { sendSms, sendMms, sendSmsToGroup, uploadImageFile } from '../smsApi'
import { createMockApiClient } from '../../test/test-utils'

describe('smsApi', () => {
  const client = createMockApiClient()

  describe('sendSms', () => {
    it('sends SMS and returns success response', async () => {
      const result = await sendSms(client, {
        message: 'Hello world',
        recipient: '0412345678',
        contact_id: 1,
      })

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('message')
    })
  })

  describe('sendMms', () => {
    it('sends MMS and returns success response', async () => {
      const result = await sendMms(client, {
        message: 'Hello with image',
        recipient: '0412345678',
        contact_id: 1,
        media_url: 'https://storage.example.com/image.jpg',
      })

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('message')
    })
  })

  describe('sendSmsToGroup', () => {
    it('sends SMS to group and returns results', async () => {
      const result = await sendSmsToGroup(client, {
        message: 'Hello group',
        group_id: 1,
      })

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('results')
      expect(result.results).toHaveProperty('successful')
      expect(result.results).toHaveProperty('failed')
      expect(result.results).toHaveProperty('total')
      expect(result).toHaveProperty('group_name')
    })
  })

  describe('uploadImageFile', () => {
    it('uploads file and returns response', async () => {
      const file = new File(['image content'], 'test.jpg', { type: 'image/jpeg' })
      const result = await uploadImageFile(client, file)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('url')
    })
  })
})
