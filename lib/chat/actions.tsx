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
import { researcher } from '@/lib/chat/researcher'
import { UserMessage, BotMessage } from '@/components/message'
import { CopilotDisplay } from '@/components/copilot-display'
import { Section } from '@/components/section'
import { Spinner } from '@/components/spinner'
import RetrieveSection from '@/components/retrieve-section'
import { nanoid } from '@/lib/utils'
import { saveChat } from '@/app/actions'
import { Chat } from '@/lib/types'
import { CoreMessage, ToolResultPart } from 'ai'
import { AIMessage } from '@/lib/types'
import { RemoteRunnable } from '@langchain/core/runnables/remote'
import { create } from 'domain'

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

  const remoteChain = new RemoteRunnable({
    url: 'http://localhost:8000/industry'
  })

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
    // Set the collapsed state to true
    isCollapsed.done(true)

    //  Generate the answer
    let answer = ''
    let toolOutputs: ToolResultPart[] = []
    let errorOccurred = false
    const streamText = createStreamableValue<string>()
    uiStream.update(<Spinner />)

    // If useSpecificAPI is enabled, only function calls will be made
    // If not using a tool, this model geerates the answer
    const logStream = await remoteChain.streamEvents(
      {
        question: '今天周几?',
        chat_history: []
      },
      // LangChain runnable config properties
      {
        // Version is required for streamEvents since it's a beta API
        version: 'v1',
        // Optional, chain specific config
        metadata: {
          conversation_id: 'other_metadata'
        }
      },
      // Optional additional streamLog properties for filtering outputs
      {
        includeNames: ['prompt', 'llm', 'retriever']
        // includeTags: [],
        // includeTypes: [],
        // excludeNames: [],
        // excludeTags: [],
        // excludeTypes: [],
      }
    )

    for await (const chunk of logStream) {
      switch (chunk.event) {
        case 'on_prompt_end':
          console.log('Prompt end:', chunk.data)
          break
        case 'on_chat_model_end':
          console.log('LLM end:', chunk.data.output.generations[0][0].text)
          const value1 = createStreamableValue()
          value1.update('1111111' + chunk.data.output.generations[0][0].text)
          uiStream.update(<BotMessage content={value1.value} />)
          value1.done()
          break
        case 'on_retriever_end':
          console.log('Retriever end:', chunk.data)
          break
      }
    }

    while (answer.length === 0 && !errorOccurred) {
      // Search the web and generate the answer
      const { fullResponse, hasError, toolResponses } = await researcher(
        uiStream,
        streamText,
        messages,
        false
      )
      answer = fullResponse
      toolOutputs = toolResponses
      errorOccurred = hasError

      if (toolOutputs.length > 0) {
        toolOutputs.map(output => {
          aiState.update({
            ...aiState.get(),
            messages: [
              ...aiState.get().messages,
              {
                id: groupeId,
                role: 'tool',
                content: JSON.stringify(output.result),
                name: output.toolName,
                type: 'tool'
              }
            ]
          })
        })
      }
    }
    streamText.done()
    if (!errorOccurred) {
      // Generate related queries
      // const relatedQueries = await querySuggestor(uiStream, messages)
      // Add follow-up panel

      // Add the answer, related queries, and follow-up panel to the state
      // Wait for 0.5 second before adding the answer to the state
      await new Promise(resolve => setTimeout(resolve, 500))

      aiState.done({
        ...aiState.get(),
        messages: [
          ...aiState.get().messages,
          {
            id: groupeId,
            role: 'assistant',
            content: answer,
            type: 'answer'
          }
        ]
      })
    }

    isGenerating.done(false)
    uiStream.done()
  }
  processEvents()
  return {
    id: nanoid(),
    isGenerating: isGenerating.value,
    component: uiStream.value,
    isCollapsed: isCollapsed.value
  }
}

const initialAIState: AIState = {
  chatId: nanoid(),
  messages: []
}

const initialUIState: UIState = []

// AI is a provider you wrap your application with so you can access AI and UI state in your components.
export const AI = createAI<AIState, UIState>({
  actions: {
    submitUserMessage
  },
  initialUIState,
  initialAIState,
  onGetUIState: async () => {
    'use server'

    const aiState = getAIState()
    if (aiState) {
      const uiState = getUIStateFromAIState(aiState)
      return uiState
    } else {
      return
    }
  },
  onSetAIState: async ({ state, done }) => {
    'use server'

    // Check if there is any message of type 'answer' in the state messages
    if (!state.messages.some(e => e.type === 'answer')) {
      return
    }

    const { chatId, messages } = state
    const createdAt = new Date()

    const path = `/chat/${chatId}`
    const title =
      messages.length > 0
        ? JSON.parse(messages[0].content)?.input?.substring(0, 100) ||
          'Untitled'
        : 'Untitled'
    // Add an 'end' message at the end to determine if the history needs to be reloaded
    const updatedMessages: AIMessage[] = [
      ...messages,
      {
        id: nanoid(),
        role: 'assistant',
        content: `end`,
        type: 'end'
      }
    ]

    const chat: Chat = {
      id: chatId,
      createdAt,
      userId: '',
      path,
      title,
      messages: updatedMessages
    }
    await saveChat(chat)
  }
})

export const getUIStateFromAIState = (aiState: Chat) => {
  const chatId = aiState.chatId
  const isSharePage = aiState.isSharePage
  return aiState.messages
    .map((message, index) => {
      const { role, content, id, type, name } = message

      if (!type || type === 'end' || (isSharePage && type === 'related'))
        return null

      switch (role) {
        case 'user':
          switch (type) {
            case 'input':
            case 'input_related':
              const json = JSON.parse(content)
              const value = type === 'input' ? json.input : json.related_query
              return {
                id,
                component: <UserMessage> {value}</UserMessage>
              }
            case 'inquiry':
              return {
                id,
                component: <CopilotDisplay content={content} />
              }
          }
        case 'assistant':
          const answer = createStreamableValue()
          answer.done(content)
          switch (type) {
            case 'answer':
              return {
                id,
                component: <BotMessage content={answer.value} />
              }
          }
        case 'tool':
          try {
            const toolOutput = JSON.parse(content)
            const isCollapsed = createStreamableValue()
            isCollapsed.done(true)
            const searchResults = createStreamableValue()
            searchResults.done(JSON.stringify(toolOutput))
            switch (name) {
              case 'retrieve':
                return {
                  id,
                  component: <RetrieveSection data={toolOutput} />,
                  isCollapsed: isCollapsed.value
                }
            }
          } catch (error) {
            return {
              id,
              component: null
            }
          }
        default:
          return {
            id,
            component: null
          }
      }
    })
    .filter(message => message !== null) as UIState
}
