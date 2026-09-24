# dsh-candidate-builder

Directory-confined subagents for the DeepSeek Harness. A `candidate-builder` child is a
fresh in-process agent that can read and write **one directory** and nothing
else.

## What confines it

Four layers, strongest first:

1. The child session's `cwd` **is** the confined directory, and its sandbox mode
   is pinned to `workspace-write` — that is the file sandbox's write boundary.
2. A monotonic tool guard in the child's scope checks the path argument of
   `read`, `write`, `edit`, `glob`, `grep` and `read_image` before the tool body
   runs. Absolute paths, relative paths and `..` escapes are all resolved
   against the root; anything outside is denied. Guards have no allow result, so
   nothing the child registers can overturn a denial.
3. Shell tools (`pwsh`/`bash`), delegation tools (`subagent`, `subagent_fork`,
   `spawn_teammate`, `workflow`, `ralph`, `candidate-builder` itself) and the
   runtime tools (`cordis_inspect_*`, `plugin_manager`, the `evolve_*` tools) are
   **never** grantable, so a child can neither run code, spawn an unguarded
   grandchild, install a plugin, nor run or change the search. Skills stay available: the catalog is
   instruction knowledge, not a path grant.
4. The child's approval policy is pinned to `never`, so escalating to
   `danger-full-access` is impossible.

**What it is not.** This is a fence, not a jail. The child has no shell, so it
cannot read outside the directory through shell commands; the gap that remains
is below.

The path guard is lexical: it does not resolve symlinks, so a symlink planted
inside the confined directory can be read through. Writes are still caught by
the sandbox pin.

## Install

```sh
dsh plugin --profile web add dsh-candidate-builder                 # from npm
dsh plugin --profile web add github:<owner>/dsh-candidate-builder  # from git
dsh plugin --profile web add ./dsh-candidate-builder-0.1.0.tgz     # from a tarball
```

Then restart the harness. No install script runs: the package ships prebuilt
`lib/` artifacts.

## The two rows

`cordis.patch.yml` inserts two rows, and they do not have the same freedom.

The **provider** row registers on `ctx.subagents`, which is a process registry
where a provider name may be registered only once. It has to stay on the host
plane — a profile layer — and cannot move into an agent preset.

The **tool** row is free. Left in the profile, `candidate-builder` is a global tool every
preset can call. To give it to one preset only, move that row into the
`plugins` list of that preset's `@deepseek-ai/dsh-agent-preset` declaration
instead:

```yaml
- id: tool-candidate-builder
  name: dsh-candidate-builder/tool
  config:
    provider: candidate-builder
    toolName: candidate-builder
```

## Configuration

| row | field | default | description |
| --- | --- | --- | --- |
| `dsh-candidate-builder` | `providerName` | `candidate-builder` | provider name on `ctx.subagents` |
| `dsh-candidate-builder/tool` | `provider` | `candidate-builder` | provider to start runs on |
| `dsh-candidate-builder/tool` | `toolName` | `candidate-builder` | model-facing tool name |

## Tool arguments

| argument | type | required | description |
| --- | --- | --- | --- |
| `directory` | string | yes | the directory the child may read and write; absolute, or relative to the session workspace |
| `prompt` | string | yes | the complete, self-contained task — the child does not see the parent conversation |
| `description` | string | no | short label shown in subagent listings |
| `allow_shell` | boolean | no | no effect: the child never gets `pwsh`/`bash` |
| `allowed_tools` | string[] | no | additional tools to enable; shell, delegation, runtime and web tools are never granted, unknown names are ignored |
| `persona` | string | no | persona applied to this child only |
| `model` | string | no | model id override; the provider is inherited from the parent route |
| `run_in_background` | boolean | no | return a job id immediately instead of waiting; collect with `job_output`, stop with `job_kill` |
| `max_depth` | integer | no | delegation depth cap (default 1) |

Background runs need `@deepseek-ai/dsh-jobs` and `@deepseek-ai/dsh-tool-jobs`
mounted; without them the tool says so rather than falling back.

## Requirements

- Node >= 22
- A DeepSeek Harness install providing `@deepseek-ai/dsh-subagent`, `dsh-agent`,
  `dsh-llm`, `dsh-session`, `dsh-tools`, `dsh-brand`, `cordis` and
  `schemastery`. All are **peer** dependencies. That is deliberate: `dsh-tools`
  identifies its scheduler with a plain `Symbol()`, so a second physical copy of
  it in the tree would read as a different symbol and break tool dispatch.

Developed against harness `0.1.2-rc.1`. The provider uses public exports of
`@deepseek-ai/dsh-subagent`, not internals, but those exports are not a frozen
API — pin a harness version you have tested.

## Development

```sh
pnpm install
pnpm run build
pnpm test
```

## License

MIT
