import {
  LanguageModelV1,
  LanguageModelV1FinishReason,
  LanguageModelV1StreamPart
} from '@ai-sdk/provider'
import {
  ParseResult,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  postJsonToApi
} from '@ai-sdk/provider-utils'
import {
  CustomChatModelId,
  CustomChatSettings
} from '@/lib/provider/custom-chat-settings'
import { createJsonErrorResponseHandler } from '@ai-sdk/provider-utils'
import { z } from 'zod'

const mistralErrorDataSchema = z.object({
  object: z.literal('error'),
  message: z.string(),
  type: z.string(),
  param: z.string().nullable(),
  code: z.string().nullable()
})

export type MistralErrorData = z.infer<typeof mistralErrorDataSchema>

export const mistralFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: mistralErrorDataSchema,
  errorToMessage: data => data.message
})
function mapMistralFinishReason(
  finishReason: string | null | undefined
): LanguageModelV1FinishReason {
  switch (finishReason) {
    case 'stop':
      return 'stop'
    case 'length':
    case 'model_length':
      return 'length'
    case 'tool_calls':
      return 'tool-calls'
    default:
      return 'other'
  }
}

type CostomChatConfig = {
  provider: string
  baseURL: string
  headers: () => Record<string, string | undefined>
  generateId: () => string
}

export class CustomChatLanguageModel implements LanguageModelV1 {
  readonly specificationVersion = 'v1'
  readonly defaultObjectGenerationMode = 'json'

  readonly modelId: CustomChatModelId
  readonly settings: CustomChatSettings

  private readonly config: CostomChatConfig

  constructor(
    modelId: CustomChatModelId,
    settings: CustomChatSettings,
    config: CostomChatConfig
  ) {
    this.modelId = modelId
    this.settings = settings
    this.config = config
  }

  get provider(): string {
    return this.config.provider
  }

  private getArgs({ prompt }: Parameters<LanguageModelV1['doGenerate']>[0]) {
    // prompt 可以是字符串，可以是其他
    return prompt
  }

  async doGenerate(
    options: Parameters<LanguageModelV1['doGenerate']>[0]
  ): Promise<Awaited<ReturnType<LanguageModelV1['doGenerate']>>> {
    const prompt = this.getArgs(options)

    const { responseHeaders, value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers: this.config.headers(),
      body: prompt,
      failedResponseHandler: mistralFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        mistralChatResponseSchema
      ),
      abortSignal: options.abortSignal
    })

    return {
      text: '' ?? undefined,
      toolCalls: [],
      finishReason: mapMistralFinishReason(''),
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens
      },
      rawCall: {
        rawPrompt: 'default prompt',
        rawSettings: {}
      },
      rawResponse: { headers: responseHeaders }
    }
  }

  async doStream(
    options: Parameters<LanguageModelV1['doStream']>[0]
  ): Promise<Awaited<ReturnType<LanguageModelV1['doStream']>>> {
    const prompt = this.getArgs(options)

    const { responseHeaders, value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers: this.config.headers(),
      body: {
        prompt,
        stream: true
      },
      failedResponseHandler: mistralFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(
        mistralChatChunkSchema
      ),
      abortSignal: options.abortSignal
    })

    let finishReason: LanguageModelV1FinishReason = 'other'
    let usage: { promptTokens: number; completionTokens: number } = {
      promptTokens: Number.NaN,
      completionTokens: Number.NaN
    }

    const generateId = this.config.generateId

    return {
      stream: response.pipeThrough(
        new TransformStream<
          ParseResult<z.infer<typeof mistralChatChunkSchema>>,
          LanguageModelV1StreamPart
        >({
          transform(chunk, controller) {
            if (!chunk.success) {
              controller.enqueue({ type: 'error', error: chunk.error })
              return
            }

            const value = chunk.value

            if (value.usage != null) {
              usage = {
                promptTokens: value.usage.prompt_tokens,
                completionTokens: value.usage.completion_tokens
              }
            }

            const choice = value.choices[0]

            if (choice?.finish_reason != null) {
              finishReason = mapMistralFinishReason(choice.finish_reason)
            }

            if (choice?.delta == null) {
              return
            }

            const delta = choice.delta

            if (delta.content != null) {
              controller.enqueue({
                type: 'text-delta',
                textDelta: delta.content
              })
            }

            if (delta.tool_calls != null) {
              for (const toolCall of delta.tool_calls) {
                // mistral tool calls come in one piece

                const toolCallId = generateId() // delta and tool call must have same id

                controller.enqueue({
                  type: 'tool-call-delta',
                  toolCallType: 'function',
                  toolCallId,
                  toolName: toolCall.function.name,
                  argsTextDelta: toolCall.function.arguments
                })

                controller.enqueue({
                  type: 'tool-call',
                  toolCallType: 'function',
                  toolCallId,
                  toolName: toolCall.function.name,
                  args: toolCall.function.arguments
                })
              }
            }
          },

          flush(controller) {
            controller.enqueue({ type: 'finish', finishReason, usage })
          }
        })
      ),
      rawCall: { rawPrompt: '', rawSettings: {} },
      rawResponse: { headers: responseHeaders }
    }
  }
}

// limited version of the schema, focussed on what is needed for the implementation
// this approach limits breakages when the API changes and increases efficiency
const mistralChatResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        role: z.literal('assistant'),
        content: z.string().nullable(),
        tool_calls: z
          .array(
            z.object({
              function: z.object({
                name: z.string(),
                arguments: z.string()
              })
            })
          )
          .optional()
          .nullable()
      }),
      index: z.number(),
      finish_reason: z.string().optional().nullable()
    })
  ),
  object: z.literal('chat.completion'),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number()
  })
})

// limited version of the schema, focussed on what is needed for the implementation
// this approach limits breakages when the API changes and increases efficiency
const mistralChatChunkSchema = z.object({
  object: z.literal('chat.completion.chunk'),
  choices: z.array(
    z.object({
      delta: z.object({
        role: z.enum(['assistant']).optional(),
        content: z.string().nullable().optional(),
        tool_calls: z
          .array(
            z.object({
              function: z.object({ name: z.string(), arguments: z.string() })
            })
          )
          .optional()
          .nullable()
      }),
      finish_reason: z.string().nullable().optional(),
      index: z.number()
    })
  ),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number()
    })
    .optional()
    .nullable()
})
