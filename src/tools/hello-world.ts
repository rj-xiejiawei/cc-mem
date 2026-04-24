import { z } from 'zod'

export const helloWorldSchema = z.object({
  name: z.string().optional().describe('Optional name to greet'),
})

export async function helloWorld(input: z.infer<typeof helloWorldSchema>) {
  const name = input.name || 'World'
  const message = `Hello, ${name}! This is cc-mem speaking.`
  return {
    content: [{ type: 'text' as const, text: message }],
  }
}
