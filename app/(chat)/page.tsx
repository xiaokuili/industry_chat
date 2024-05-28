import { nanoid } from '@/lib/utils'
import { Chat } from '@/components/chat'
import { AI } from '@/lib/chat/actions'
import { getMissingKeys } from '@/app/actions'
import { auth } from '@/auth'

export const metadata = {
  title: '产业 AI Chatbot'
}

export default async function IndexPage() {
  const id = nanoid()

  const session = await auth()

  const missingKeys = await getMissingKeys()

  return (
    <AI initialAIState={{ chatId: id, messages: [] }}>
      <Chat id={id} session={session} missingKeys={missingKeys} />
    </AI>
  )
}
