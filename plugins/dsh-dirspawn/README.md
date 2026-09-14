# dsh-dirspawn

Directory-confined subagents for the DeepSeek Harness. A `dirspawn` child is a
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
3. Shell tools (`pwsh`/`bash`) are removed by default and grantable per call.
   Delegation tools (`subagent`, `subagent_fork`, `workflow`, `ralph`,
   `dirspawn` itself) and the `cordis_*` dynamic-plugin tools are **never**
   grantable, so a child can neither spawn an unguarded grandchild nor define a
   plugin that reads the host filesystem. Skills stay available: the catalog is
   instruction knowledge, not a path grant.
4. The child's approval policy is pinned to `never`, so escalating to
   `danger-full-access` is impossible.

**What it is not.** This is a fence, not a jail. Grant `allow_shell` and the
child's shell commands can still *read* arbitrary paths — only their workdir is
confined. Leave shell off for hard read-and-write confinement.

The path guard is lexical: it does not resolve symlinks, so a symlink planted
inside the confined directory can be read through. Writes are still caught by
the sandbox pin.

## Install

```sh
dsh plugin --profile web add dsh-dirspawn                 # from npm
dsh plugin --profile web add github:<owner>/dsh-dirspawn  # from git
dsh plugin --profile web add ./dsh-dirspawn-0.1.0.tgz     # from a tarball
```

Then restart the harness. No install script runs: the package ships prebuilt
`lib/` artifacts.

## The two rows

`cordis.patch.yml` inserts two rows, and they do not have the same freedom.

The **provider** row registers on `ctx.subagents`, which is a process registry
where a provider name may be registered only once. It has to stay on the host
plane — a profile layer — and cannot move into an agent preset.

The **tool** row is free. Left in the profile, `dirspawn` is a global tool every
preset can call. To give it to one preset only, copy that row into the preset's
`agent.cordis.yml` instead:

```yaml
- id: tool-dirspawn
  name: dsh-dirspawn/tool
  config:
    provider: dirspawn
    toolName: dirspawn
```

## Configuration

| row | field | default | description |
| --- | --- | --- | --- |
| `dsh-dirspawn` | `providerName` | `dirspawn` | provider name on `ctx.subagents` |
| `dsh-dirspawn/tool` | `provider` | `dirspawn` | provider to start runs on |
| `dsh-dirspawn/tool` | `toolName` | `dirspawn` | model-facing tool name |

## Tool arguments

| argument | type | required | description |
| --- | --- | --- | --- |
| `directory` | string | yes | the directory the child may read and write; absolute, or relative to the session workspace |
| `prompt` | string | yes | the complete, self-contained task — the child does not see the parent conversation |
| `description` | string | no | short label shown in subagent listings |
| `allow_shell` | boolean | no | re-enable `pwsh`/`bash`; workdir stays confined, reads outside become possible |
| `allowed_tools` | string[] | no | additional tools to enable; only `pwsh`/`bash` are grantable, unknown names are ignored |
| `persona` | string | no | persona applied to this child only |
| `model` | string | no | model id override; the provider is inherited from the parent route |
| `run_in_background` | boolean | no | return a job id immediately instead of waiting; collect with `job_output`, stop with `job_kill` |
| `max_depth` | integer | no | delegation depth cap (default 3) |

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
