# TODO

## Add `provider` and `reasoning_effort` to the tool

**Today.** The tool only accepts `model`, and passes it as `agentOptions: { model }`
(`src/tool.ts`, where the start request is built). The child's provider is always
inherited from the parent route, and its reasoning effort can't be chosen at all.

**Target.** Accept `provider`, `model` and `reasoning_effort`, the same three the stock
`subagent` tool offers (`@deepseek-ai/dsh-tool-subagent`), and pass them as
`agentOptions: { provider, model, reasoningEffort }`.

Follow what `tool-subagent` already does:

- `provider` and `model` go together: its description tells the model to supply both,
  after checking the available routes with `list_subagent_models`. Confirm that tool is
  available wherever `dirspawn` is, or say how else to find valid routes.
- Validate the effort the way `tool-subagent` does (`ReasoningEffortId`).
- Leaving the effort out after changing the route should mean "use the new model's
  default". `resolveChildAgentOptions` in `@deepseek-ai/dsh-subagent` already drops the
  parent's effort when the route changes, so that should need no extra code — but test it.

The provider already declares `capabilities.agentOptions: true`, so only the tool needs
changing, not `src/index.ts`.

**Why.** Choosing which model and how much reasoning each worker gets is one of the
search levers EVOLVE's `improving-the-search-machinery` skill lists ("which models or
workers handle which work").

**Tests.** Only `path.ts` is tested today. Add a test that the tool builds the right
`agentOptions` for each combination of the three arguments.
