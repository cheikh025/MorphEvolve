# dsh-candidate-builder

Directory-confined subagents for the DeepSeek Harness. A `candidate-builder` child is a
fresh in-process agent whose file tools are restricted to **one directory**.

## What confines it

Four layers, strongest first:

1. The child session's `cwd` **is** the confined directory, and its sandbox mode
   is pinned to `workspace-write` — that is the file sandbox's write boundary.
2. A monotonic tool guard in the child's scope checks the path argument of
   `read`, `write`, `edit`, `glob`, `grep` and `read_image` before the tool body
   runs. Absolute paths, relative paths and `..` escapes are all resolved
   against the root; anything outside is denied. Guards have no allow result, so
   nothing the child registers can overturn a denial.
3. Delegation tools (`subagent`, `subagent_fork`,
   `spawn_teammate`, `workflow`, `ralph`, `candidate-builder` itself) and the
   runtime tools (`cordis_inspect_*`, `plugin_manager`, the `evolve_*` tools) are
   **never** grantable, so a child can neither spawn an unguarded
   grandchild, install a plugin, nor run or change the search. Skills stay available: the catalog is
   instruction knowledge, not a path grant.
4. The child's approval policy is pinned to `never`, so escalating to
   `danger-full-access` is impossible.

Evolutionary workers enable shell tools (`pwsh`/`bash`) by default on this branch.
For direct `candidate-builder` calls, set `allow_shell: true` to enable them.
Shell commands use the child's sandbox;
the lexical file-tool guard does not inspect command contents or confine shell reads.

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
| `allow_shell` | boolean | no | enable `pwsh`/`bash` with `true`; direct tool calls default to disabled |
| `allowed_tools` | string[] | no | retained in the confinement payload; currently does not change the inherited tool set |
| `persona` | string | no | persona applied to this child only |
| `model` | string | no | model id override; the provider is inherited from the parent route |
| `run_in_background` | boolean | no | return a job id immediately instead of waiting; collect with `job_output`, stop with `job_kill` |
| `max_depth` | integer | no | delegation depth cap (default 1) |
| `timeout_seconds` | integer | no | elapsed-time limit per worker; defaults to `600` (10 minutes); `0` disables it |
| `warning_seconds` | integer | no | warn at this many seconds remaining; defaults to `min(120, timeout_seconds)`; `0` disables the warning |

Background runs need `@deepseek-ai/dsh-jobs` and `@deepseek-ai/dsh-tool-jobs`
mounted; without them the tool says so rather than falling back.

## Worker time limits

For ten minutes of work with a warning one minute before the deadline:

```json
{
  "directory": "/work/run/candidates/c000001",
  "prompt": "Improve the solution and write your changes.",
  "allow_shell": true,
  "timeout_seconds": 600,
  "warning_seconds": 60
}
```

The timer starts at the first `agent/assistant-stream` start event, after child
creation and prompt preparation. It runs continuously through later model
requests, retries, shell commands, and waiting. Each worker has its own timer.
Values must be nonnegative integer seconds, at most 2147483, and the warning
threshold must not exceed the time limit. A short limit of 120 seconds or less
queues the default warning immediately; set a smaller threshold when desired.

The warning uses `child.steer()` and reaches the next admitted model step. It
does not interrupt a response or shell command in progress. Its remaining-time
text is refreshed during admission. A request or command that lasts through the
deadline may prevent the worker from consuming the warning at all.

At expiry, the provider cancels the child through the normal agent cancellation
signal, waits for quiescence, and disposes its handle. Cancellation is cooperative:
tools must honor that signal, and cleanup may finish after the deadline. Saved
files remain available. Completion, cancellation, and disposal clear all timers;
a finished worker is never restarted by a late warning.

Foreground results include `timing` with the deadline, elapsed seconds,
`warningQueued`, and `timedOut`. Expiry returns `stopReason: "aborted"` together
with `timing.timedOut: true` and any partial output. Background jobs report a
failed outcome with a time-limit diagnostic. The timer writes no events of its
own to the child session, because the harness refuses to reload a session log
that contains an unknown plugin event type. Warning delivery uses the ordinary
inbox and `user/message` history, and expiry appears as the aborted `turn/end`
reason.

Programmatic provider requests use `timeoutSeconds` and `warningSeconds` at the
top level, alongside `persona`, `maxDepth`, and `confine`.

## Requirements

- Node >= 22
- A DeepSeek Harness install providing `@deepseek-ai/dsh-subagent`, `dsh-agent`,
  `dsh-llm`, `dsh-session`, `dsh-tools`, `dsh-brand`, `cordis` and
  `schemastery`. All are **peer** dependencies. That is deliberate: `dsh-tools`
  identifies its scheduler with a plain `Symbol()`, so a second physical copy of
  it in the tree would read as a different symbol and break tool dispatch.

Developed against harness `0.1.7-rc.1`. The provider uses public exports of
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
