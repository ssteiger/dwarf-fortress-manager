/**
 * The optional language model behind the legends narrator and the nickname
 * writer. Configured through environment variables only; server-side only.
 */

export type ModelProvider = 'openai' | 'anthropic'

export interface ModelConfig {
  provider: ModelProvider
  apiKey: string
  model: string
  /** API root; lets an OpenAI-compatible local server (Ollama, LM Studio) stand in. */
  baseUrl: string
}

const DEFAULT_MODEL: Record<ModelProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
}

const DEFAULT_BASE_URL: Record<ModelProvider, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
}

export function readModelConfig(): ModelConfig | null {
  const provider = (process.env.LEGENDS_NARRATOR_PROVIDER ?? '').trim().toLowerCase()
  const apiKey = (process.env.LEGENDS_NARRATOR_API_KEY ?? '').trim()
  if ((provider !== 'openai' && provider !== 'anthropic') || !apiKey) return null
  const model = (process.env.LEGENDS_NARRATOR_MODEL ?? '').trim() || DEFAULT_MODEL[provider]
  const baseUrl = (
    (process.env.LEGENDS_NARRATOR_BASE_URL ?? '').trim() || DEFAULT_BASE_URL[provider]
  ).replace(/\/+$/, '')
  return { provider, apiKey, model, baseUrl }
}

export interface CompletionRequest {
  system: string
  user: string
  temperature: number
  maxTokens: number
  timeoutMs?: number
}

export async function complete(config: ModelConfig, request: CompletionRequest): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 60_000)
  try {
    if (config.provider === 'openai') {
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        }),
        signal: controller.signal,
      })
      if (!res.ok)
        throw new Error(`The model's provider answered ${res.status}: ${await errorText(res)}`)
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const text = json.choices?.[0]?.message?.content?.trim()
      if (!text) throw new Error('The model returned nothing.')
      return text
    }
    const res = await fetch(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
      }),
      signal: controller.signal,
    })
    if (!res.ok)
      throw new Error(`The model's provider answered ${res.status}: ${await errorText(res)}`)
    const json = (await res.json()) as { content?: { type: string; text?: string }[] }
    const text = json.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim()
    if (!text) throw new Error('The model returned nothing.')
    return text
  } finally {
    clearTimeout(timer)
  }
}

async function errorText(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { message?: string } }
    return json.error?.message ?? res.statusText
  } catch {
    return res.statusText
  }
}
