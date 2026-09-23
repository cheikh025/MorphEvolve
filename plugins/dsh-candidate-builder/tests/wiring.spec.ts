import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as providerPlugin from '../src/index.ts'
import * as toolPlugin from '../src/tool.ts'

it('registers the candidate builder provider and its model-facing tool', async () => {
  const registered: Array<{ name: string }> = []
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Tools)
    await ctx.plugin({
      name: 'test-subagents',
      apply(scope: Context) {
        scope.provide('subagents', {
          registerProvider(provider: { name: string }) { registered.push(provider) },
        })
      },
    })
    await ctx.plugin(providerPlugin)
    await ctx.plugin(toolPlugin)

    expect(registered.map(provider => provider.name)).toEqual(['candidate-builder'])
    expect(ctx.tools.get('candidate-builder')).toBeDefined()
  } finally {
    await ctx.fiber.dispose()
  }
})
