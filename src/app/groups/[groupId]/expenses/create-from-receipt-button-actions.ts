'use server'
import { getCategories } from '@/lib/api'
import { env } from '@/lib/env'
import { formatCategoryForAIPrompt } from '@/lib/utils'
import Anthropic from '@anthropic-ai/sdk'

// Client is instantiated lazily per-call so the module can be imported even
// when ANTHROPIC_API_KEY is absent (flag-off path never calls the functions).

function getClient() {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
}

/**
 * Fetch a URL and return its content as a base64-encoded string + media type.
 * MinIO/S3 URLs may not be publicly reachable by Anthropic's servers, so we
 * fetch the image server-side and pass it as a base64 content block.
 */
async function fetchImageAsBase64(
  imageUrl: string,
): Promise<{ data: string; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }> {
  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch receipt image: ${response.status} ${response.statusText}`,
    )
  }
  const contentType = response.headers.get('content-type') ?? 'image/jpeg'
  // Normalise to one of the four types Anthropic accepts
  const media_type = (
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(contentType)
      ? contentType
      : 'image/jpeg'
  ) as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

  const buffer = await response.arrayBuffer()
  const data = Buffer.from(buffer).toString('base64')
  return { data, media_type }
}

/**
 * Extract expense information from a receipt image URL.
 * Returns safe defaults on any failure so the UI degrades gracefully.
 */
export async function extractExpenseInformationFromImage(imageUrl: string): Promise<{
  amount: number
  categoryId: string | null
  date: string | null
  title: string | null
}> {
  'use server'
  const categories = await getCategories()
  const client = getClient()

  let imageBlock: Anthropic.ImageBlockParam
  try {
    const { data, media_type } = await fetchImageAsBase64(imageUrl)
    imageBlock = {
      type: 'image',
      source: { type: 'base64', media_type, data },
    }
  } catch {
    // Fall back to URL block if fetch fails (works only when URL is publicly accessible)
    imageBlock = {
      type: 'image',
      source: { type: 'url', url: imageUrl },
    }
  }

  const categoryList = categories
    .map((category) => formatCategoryForAIPrompt(category))
    .join(', ')

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 256,
      tools: [
        {
          name: 'record_receipt_info',
          description: 'Record structured information extracted from a receipt image.',
          input_schema: {
            type: 'object' as const,
            properties: {
              amount: {
                type: 'number',
                description: 'Total amount as a plain number without currency symbol or formatting.',
              },
              categoryId: {
                type: 'string',
                description: `The ID of the best-matching expense category. Choose from: ${categoryList}. Use the numeric ID only.`,
              },
              date: {
                type: 'string',
                description: 'Date of the expense in yyyy-mm-dd format.',
              },
              title: {
                type: 'string',
                description: 'A short descriptive title for the expense.',
              },
            },
            required: ['amount', 'categoryId', 'date', 'title'],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'record_receipt_info' },
      messages: [
        {
          role: 'user',
          content: [
            imageBlock,
            {
              type: 'text',
              text: 'This is a receipt image. Extract the total amount, the most fitting expense category ID, the date, and a short title.',
            },
          ],
        },
      ],
    })

    // Extract the tool_use block from the response
    const toolUseBlock = message.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    )
    if (!toolUseBlock) {
      return { amount: 0, categoryId: null, date: null, title: null }
    }

    const input = toolUseBlock.input as {
      amount: number
      categoryId: string
      date: string
      title: string
    }
    return {
      amount: Number(input.amount),
      categoryId: input.categoryId ?? null,
      date: input.date ?? null,
      title: input.title ?? null,
    }
  } catch {
    // Return safe defaults so the UI degrades gracefully
    return { amount: 0, categoryId: null, date: null, title: null }
  }
}

export type ReceiptExtractedInfo = Awaited<
  ReturnType<typeof extractExpenseInformationFromImage>
>
