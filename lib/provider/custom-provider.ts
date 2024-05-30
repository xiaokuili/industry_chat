import {
  generateId,
  loadApiKey,
  withoutTrailingSlash
} from '@ai-sdk/provider-utils'
import { CustomChatLanguageModel } from './custom-chat-language-model'
import { CustomChatModelId, CustomChatSettings } from './custom-chat-settings'

// model factory function with additional methods and properties
export interface CustomProvider {
  (
    modelId: CustomChatModelId,
    settings?: CustomChatSettings
  ): CustomChatLanguageModel

  // explicit method for targeting a specific API in case there are several
  chat(
    modelId: CustomChatModelId,
    settings?: CustomChatSettings
  ): CustomChatLanguageModel
}

// optional settings for the provider
export interface CustomProviderSettings {
  /**
Use a different URL prefix for API calls, e.g. to use proxy servers.
   */
  baseURL?: string

  /**
API key.
   */
  apiKey?: string

  /**
Custom headers to include in the requests.
     */
  headers?: Record<string, string>
}

// provider factory function
export function createCustomProvider(
  options: CustomProviderSettings = {}
): CustomProvider {
  const createModel = (
    modelId: CustomChatModelId,
    settings: CustomChatSettings = {}
  ) =>
    new CustomChatLanguageModel(modelId, settings, {
      provider: 'custom.chat',
      baseURL:
        withoutTrailingSlash(options.baseURL) ?? 'https://custom.ai/api/v1',
      headers: () => ({
        Authorization: `Bearer ${loadApiKey({
          apiKey: options.apiKey,
          environmentVariableName: 'CUSTOM_API_KEY',
          description: 'Custom Provider'
        })}`,
        ...options.headers
      }),
      generateId: options.generateId ?? generateId
    })

  const provider = function (
    modelId: CustomChatModelId,
    settings?: CustomChatSettings
  ) {
    if (new.target) {
      throw new Error(
        'The model factory function cannot be called with the new keyword.'
      )
    }

    return createModel(modelId, settings)
  }

  provider.chat = createModel

  return provider as CustomProvider
}

/**
 * Default custom provider instance.
 */
export const customProvider = createCustomProvider()
