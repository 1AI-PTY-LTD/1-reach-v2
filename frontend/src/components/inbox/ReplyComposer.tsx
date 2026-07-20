import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '../../ui/button'
import { Textarea } from '../../ui/textarea'
import { sendSms } from '../../api/smsApi'
import { useApiClient } from '../../lib/ApiClientProvider'
import { estimateSmsSegments, SMS_MAX_LENGTH } from '../../lib/sms'
import type { Contact } from '../../types/contact.types'
import Logger from '../../utils/logger'

export function ReplyComposer({ contact }: { contact: Contact }) {
  const client = useApiClient()
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)

  const segments = estimateSmsSegments(message)

  async function handleSend() {
    const text = message.trim()
    if (!text || isSending) return
    setIsSending(true)
    try {
      // Replies are always two-way so the recipient can answer back.
      await sendSms(client, {
        message: text,
        recipients: [{ phone: contact.phone, contact_id: contact.id }],
        two_way: true,
      })
      setMessage('')
      toast.success('Reply sent')
      queryClient.invalidateQueries({ queryKey: ['thread', contact.id] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({ queryKey: ['schedules', 'contact', contact.id] })
    } catch (error) {
      Logger.error('Error sending reply', {
        component: 'ReplyComposer',
        data: { error: (error as Error).message },
      })
      toast.error((error as Error).message || 'Failed to send reply')
    } finally {
      setIsSending(false)
    }
  }

  if (contact.opt_out) {
    return (
      <div
        className="border-t border-zinc-950/10 dark:border-white/10 px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400"
        data-testid="composer-opted-out"
      >
        This contact has opted out of receiving messages — replies are disabled.
      </div>
    )
  }

  return (
    <div className="border-t border-zinc-950/10 dark:border-white/10 p-4">
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Textarea
            aria-label="Reply message"
            placeholder="Type a reply…"
            rows={2}
            maxLength={SMS_MAX_LENGTH}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {message.length}/{SMS_MAX_LENGTH} characters · {segments}{' '}
            {segments === 1 ? 'segment' : 'segments'}
          </p>
        </div>
        <Button
          color="emerald"
          disabled={!message.trim() || isSending}
          onClick={handleSend}
        >
          {isSending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  )
}
