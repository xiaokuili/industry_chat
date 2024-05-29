import 'server-only'

import {
  StreamableValue,
  createAI,
  createStreamableUI,
  getMutableAIState,
  getAIState,
  streamUI,
  createStreamableValue
} from 'ai/rsc'
import { inquire } from '@/lib/chat/inquire'
import { taskManager } from '@/lib/chat/task-manager'

import {
  formatNumber,
  runAsyncFnWithoutBlocking,
  sleep,
  nanoid
} from '@/lib/utils'
import { saveChat } from '@/app/actions'
import { Chat, Message } from '@/lib/types'
import { auth } from '@/auth'
import { CoreMessage } from 'ai'
import { AIMessage } from '@/lib/types'

export type AIState = {
  chatId: string
  messages: AIMessage[]
}

export type UIState = {
  id: string
  component: React.ReactNode
  isGenerating?: StreamableValue<boolean>
  isCollapsed?: StreamableValue<boolean>
}[]

async function submitUserMessage(formData: FormData, skip: boolean) {
  'use server'
  const aiState = getMutableAIState<typeof AI>()
  const uiStream = createStreamableUI()
  const isGenerating = createStreamableValue(true)
  const isCollapsed = createStreamableValue(false)

  const messages: CoreMessage[] = [...aiState.get().messages]
    .filter(
      message =>
        message.role !== 'tool' &&
        message.type !== 'followup' &&
        message.type !== 'related' &&
        message.type !== 'end'
    )
    .map(message => {
      const { role, content } = message
      return { role, content } as CoreMessage
    })
  const groupeId = nanoid()

  // Limit the number of messages to the maximum
  const maxMessages = 10
  messages.splice(0, Math.max(messages.length - maxMessages, 0))

  // content
  const userInput = skip
    ? `{"action": "skip"}`
    : (formData?.get('input') as string)

  const content = skip
    ? userInput
    : formData
      ? JSON.stringify(Object.fromEntries(formData))
      : null

  const type = skip
    ? undefined
    : formData?.has('input')
      ? 'input'
      : formData?.has('related_query')
        ? 'input_related'
        : 'inquiry'

  if (content) {
    aiState.update({
      ...aiState.get(),
      messages: [
        ...aiState.get().messages,
        {
          id: nanoid(),
          role: 'user',
          content,
          type
        }
      ]
    })
    messages.push({
      role: 'user',
      content
    })
  }
  async function processEvents() {
    let action = { object: { next: 'proceed' } }
    // If the user skips the task, we proceed to the search
    if (!skip) action = (await taskManager(messages)) ?? action

    if (action.object.next === 'inquire') {
      // Generate inquiry
      const inquiry = await inquire(uiStream, messages)
      uiStream.done()
      isGenerating.done()
      isCollapsed.done(false)
      aiState.done({
        ...aiState.get(),
        messages: [
          ...aiState.get().messages,
          {
            id: nanoid(),
            role: 'assistant',
            content: `inquiry: ${inquiry?.question}`
          }
        ]
      })
      return
    }
    isCollapsed.done(true)
  }
  processEvents()
  return {
    id: nanoid(),
    isGenerating: isGenerating.value,
    component: uiStream.value,
    isCollapsed: isCollapsed.value
  }
}

export const AI = createAI<AIState, UIState>(
  {
    actions: {
      submitUserMessage
    },
    initialUIState: [],
    initialAIState: { chatId: nanoid(), messages: [] }
    // onGetUIState: async () => {
    // 'use server'
    // const session = await auth()
    // if (session && session.user) {
    //   const aiState = getAIState()
    //   if (aiState) {
    //     const uiState = getUIStateFromAIState(aiState)
    //     return uiState
    //   }
    // } else {
    //   return
    // }
    // },
    // onSetAIState: async ({ state }) => {
    // 'use server'
    // const session = await auth()
    // if (session && session.user) {
    //   const { chatId, messages } = state
    //   const createdAt = new Date()
    //   const userId = session.user.id as string
    //   const path = `/chat/${chatId}`
    //   const firstMessageContent = messages[0].content as string
    //   const title = firstMessageContent.substring(0, 100)
    // } else {
    //   return
    // }
  }
  // }
)

export const getUIStateFromAIState = (aiState: Chat) => {
  const result = [{ id: '', display: <></> }]
  return result
}
