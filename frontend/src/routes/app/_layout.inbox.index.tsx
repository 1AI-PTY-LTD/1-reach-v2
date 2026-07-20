import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/_layout/inbox/')({
  component: InboxIndex,
})

export function InboxIndex() {
  return (
    <div className="border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg">
      <div className="flex items-center justify-center py-16">
        <p className="text-zinc-400 dark:text-zinc-500">
          Select a conversation to view its messages
        </p>
      </div>
    </div>
  )
}
