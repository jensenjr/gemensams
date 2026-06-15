'use server'
import { getCategories } from '@/lib/api'
import { env } from '@/lib/env'
import { formatCategoryForAIPrompt } from '@/lib/utils'
import Anthropic from '@anthropic-ai/sdk'

// Client is instantiated lazily per-call so the module can be imported even
// when ANTHROPIC_API_KEY is absent (flag-off path never calls the function).

function getClient() {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
}

/** Limit of characters to be evaluated. May help avoiding abuse when using AI. */
const limit = 40 // ~10 tokens

/**
 * Attempt extraction of category from expense title
 * @param description Expense title or description. Only the first characters as defined in {@link limit} will be used.
 */
export async function extractCategoryFromTitle(description: string) {
  'use server'
  const categories = await getCategories()
  const client = getClient()

  const categoryList = categories
    .map((category) => formatCategoryForAIPrompt(category))
    .join(', ')

  const fallbackCategoryId = categories[0]?.id ?? 0

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      tools: [
        {
          name: 'record_category',
          description: 'Record the most relevant expense category ID for the given title.',
          input_schema: {
            type: 'object' as const,
            properties: {
              categoryId: {
                type: 'number',
                description: `Numeric ID of the best-matching category. Choose from: ${categoryList}. Fall back to ${formatCategoryForAIPrompt(categories[0])} if nothing fits.`,
              },
            },
            required: ['categoryId'],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'record_category' },
      messages: [
        {
          role: 'user',
          content: description.substring(0, limit),
        },
      ],
    })

    const toolUseBlock = message.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    )
    if (!toolUseBlock) {
      return { categoryId: fallbackCategoryId }
    }

    const input = toolUseBlock.input as { categoryId: number }
    const returnedId = Number(input.categoryId)

    // Ensure the returned ID actually exists in our category list
    const matched = categories.find((c) => c.id === returnedId)
    return { categoryId: matched?.id ?? fallbackCategoryId }
  } catch {
    // Fall back to the first category on any error
    return { categoryId: fallbackCategoryId }
  }
}

export type TitleExtractedInfo = Awaited<
  ReturnType<typeof extractCategoryFromTitle>
>
