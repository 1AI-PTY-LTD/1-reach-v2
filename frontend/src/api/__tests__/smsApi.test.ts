import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { sendSms, sendMms, sendSmsToGroup, uploadImageFile } from '../smsApi'
import { createMockApiClient } from '../../test/test-utils'
import { server } from '../../test/handlers'

describe('smsApi', () => {
  const client = createMockApiClient()

  describe('sendSms', () => {
    it('queues SMS and returns 202 with schedule_id', async () => {
      const result = await sendSms(client, {
        message: 'Hello world',
        recipient: '0412345678',
        contact_id: 1,
      })

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('message')
      expect(result).toHaveProperty('schedule_id', 1)
    })
  })

  describe('sendMms', () => {
    it('queues MMS and returns 202 with schedule_id', async () => {
      const result = await sendMms(client, {
        message: 'Hello with image',
        recipient: '0412345678',
        contact_id: 1,
        media_url: 'https://storage.example.com/image.jpg',
      })

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('message')
      expect(result).toHaveProperty('schedule_id', 2)
    })
  })

  describe('sendSmsToGroup', () => {
    it('queues group SMS and returns 202 with total count', async () => {
      const result = await sendSmsToGroup(client, {
        message: 'Hello group',
        group_id: 1,
      })

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('results')
      expect(result.results).toHaveProperty('total', 3)
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

  describe('error handling', () => {
    it('sendSms rejects when API returns 500', async () => {
      server.use(
        http.post('http://localhost:8000/api/sms/send/', () =>
          HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
        )
      )
      await expect(
        sendSms(client, { message: 'Hello', recipient: '0412345678', contact_id: 1 })
      ).rejects.toThrow()
    })
  })
})
