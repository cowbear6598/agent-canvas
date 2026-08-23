[繁體中文](README.md) | [日本語](README.ja.md)

# Agent Canvas

A canvas tool for visually designing and executing AI Agent workflows, with team collaboration support.

<video src="https://github.com/user-attachments/assets/58a82eb0-e629-46cc-a944-5ba891692b52" controls width="100%"></video>

## Table of Contents

- [Important Notes](#important-notes)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [AI Access](#ai-access)
- [Tutorials](#tutorials)
  - [What is a POD?](#what-is-a-pod)
  - [How to Switch Models?](#how-to-switch-models)
  - [Slot Overview](#slot-overview)
  - [Connection Line](#connection-line)
  - [Runs and Parallel Execution](#runs-and-parallel-execution)
  - [Plugin](#plugin)
  - [Workflow Patterns](#workflow-patterns)
  - [Schedule](#schedule)
  - [Header and Management Hub](#header-and-management-hub)

## Important Notes

- Tested on **macOS / Linux**. Other operating systems may have unknown issues.
- A **local environment** is recommended. Agent Canvas provides a Workspace Password, but it does not provide a complete multi-user account and role system. For external access, also use HTTPS, a firewall, or a protected reverse proxy.
- Authentication depends on the Provider; supported subscription sign-in or API Key configurations can be used.

## Installation

**Prerequisite:** Authenticate at least one supported AI Provider.

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex CLI](https://developers.openai.com/codex/cli)
- [OpenCode](https://opencode.ai/docs/cli/)

**One-line install (recommended)**

```bash
curl -fsSL https://raw.githubusercontent.com/cowbear6598/agent-canvas/main/install.sh | sh
```

**Uninstall**

```bash
curl -fsSL https://raw.githubusercontent.com/cowbear6598/agent-canvas/main/install.sh | sh -s -- --uninstall
```

## Usage

```bash
# Start service (background daemon, default port 3001)
agent-canvas start

# Start with custom port
agent-canvas start --port 8080

# Check service status
agent-canvas status

# Stop service
agent-canvas stop

# View latest logs (default 50 lines)
agent-canvas logs

# View a specific number of log lines
agent-canvas logs -n 100
```

Open `http://localhost:3001` in a browser after startup.

## Configuration

Use the `config` command when Clone features need access to private repositories. If you are already logged in with `gh`, you may not need to set a GitHub Token separately.

```bash
# GitHub Token
agent-canvas config set GITHUB_TOKEN ghp_xxxxx

# GitLab Token
agent-canvas config set GITLAB_TOKEN glpat-xxxxx

# Self-hosted GitLab URL (optional, defaults to gitlab.com)
agent-canvas config set GITLAB_URL https://gitlab.example.com

# List all configurations
agent-canvas config list
```

## AI Access

Open **AI Access** from the Header management hub to create revocable external tokens, configure an advertised URL, and download an Agent Canvas Skill that never contains a token. Canvas grants are managed separately from the `canvas:read`, `canvas:create`, `canvas:write`, and `canvas:execute` scopes; `canvas:write` includes read access.

The Pod MCP menu also provides a built-in Agent Canvas MCP that is off by default. When enabled, the backend issues a short-lived capability bound to the current Canvas, Pod, and Run without exposing an external management token to the model.

## Tutorials

### What is a POD?

- One Pod represents one AI Agent.
- Right-click the canvas → Pod → select an AI Provider to create one.
- Right-click a Pod to switch its Provider, connect an Integration, or adjust other Pod settings.

### How to Switch Models?

- Hover over the model label at the top of a Pod to select a model supported by that Provider.
- Use the Brain menu to adjust the Thinking / effort level. Available options depend on the model.

### Slot Overview

- **Plugin**: Select the Plugin / Skill bundles enabled for this Pod.
- **MCP**: Toggle the MCP Servers available to the Pod.
- **Thinking**: Adjust the model's reasoning effort.
- **Fast**: Toggle a Provider's supported fast mode.
- **Goal**: Add objectives that the Pod must follow while executing.
- **Repo**: Bind a repository. Runs use isolated workspaces; without a binding, the Pod uses its own working directory.

### Connection Line

Right-click a Connection Line to choose its base mode and independently toggle Direct:

- **Auto**: After the source Pod finishes, automatically pass its summary to the target Pod.
- **Branch**: AI selects one of the Branch lines from the same source using each line's name and description. If the decision fails, no Branch is triggered.
- **Direct**: Can coexist with Auto or Branch. It triggers the target as soon as the source completes and does not participate in normal multi-input waiting.

#### Multi-Connection Trigger Rules

When a Pod has multiple incoming Connection Lines:

- Auto + Auto: Wait for every source in the same group, then merge their summaries and trigger once.
- Auto + Branch: A selected Branch counts as ready; if it is rejected, that group does not trigger the target Pod.
- Direct + Direct: Each Direct line triggers independently when it completes. **There is currently no 10-second merge window.**
- Auto + Auto + Direct + Direct: The Auto group follows aggregation rules, while each Direct line triggers independently, so the target Pod may run multiple times.
- If the target Pod is already busy within the same Run, later triggers enter a queue and execute in order.

#### Model Settings

Open **Management Hub → Model Settings → Connection Line** to select the model. The same setting is used for downstream summary generation and Branch decisions.

### Runs and Parallel Execution

- Every manual message, Schedule trigger, or Integration event creates a Run. Different Runs for the same Pod can execute in parallel.
- Runs created manually, by schedules, or by integrations—and their downstream workflow executions—are all available in Run History.
- With a bound Git repository, different Runs use isolated workspaces. Pods using the same repository within one Run share that Run's workspace, which is cleaned up when the Run finishes.
- Repeated triggers for a busy Pod within the same Run are processed in queue order.

### Plugin

Plugin Manager manages the Plugin / Skill bundles available to Pods. Installing them through the Claude CLI is not required.

- From **Management Hub → Plugin**, import a GitHub repository or upload a local bundle, then update, delete, or reorder it in Plugin Manager.
- Toggle the desired items in a Pod's **Plugin Slot**.
- Enabled Plugin capabilities are made available to the Agent while that Pod executes.
- Plugin and MCP are configured separately and can be used together.

### Workflow Patterns

#### Example 1: Code Review (Auto chain)

```text
[Code Reviewer] --Auto--> [Report Generator]
```

- Put the review criteria in the Code Reviewer's Goal.
- Report Generator receives the upstream summary and turns it into a complete report.

#### Example 2: Smart Routing (Branch)

```text
                 /--Branch: Bug----> [Bug Handler]
[Issue Analyzer]
                 \--Branch: Feature-> [Feature Advisor]
```

- Give every Branch a clear name and description.
- A successful decision selects exactly one Branch. A failed decision triggers none.

#### Example 3: Parallel Collection and Merge

```text
[Security Analyst]    --Auto--\
                               --> [Final Report]
[Performance Analyst] --Auto--/
```

- The two Analyst Pods can run in parallel.
- Final Report waits for every source in the same Auto group and receives their merged summaries.

#### Example 4: Independent Notifications (Direct)

```text
[Build] --Direct--> [Notifier]
[Test]  --Direct--> [Notifier]
```

- Build and Test each trigger Notifier when they complete.
- Direct lines do not wait for a fixed merge window. If Notifier is busy, the later trigger is queued.

### Schedule

- **Setup**: Click the timer button on a Pod → select a frequency → enable it.
- **Frequency**: Every x seconds, minutes, or hours; every day; or every week.
- **Edit / disable**: Click the timer → update its settings or disable it.

- Every trigger creates a new Run. On completion, downstream workflows continue according to the Connection Line rules.
- A schedule is not skipped just because another Run for the same Pod is active.
- Daily and weekly times use **Management Hub → Global Settings → Timezone**.

### Header and Management Hub

The Header provides these main entry points:

- **Connection Status**: Shows the frontend-to-backend connection state.
- **Management Hub**: Manages Global Settings, Integration, AI Access, MCP, Plugin, Model Settings, and OpenCode.
- **Run History**: Opens Runs and Pod conversations.
- **Canvas Selector**: Switches or manages canvases.

#### Language

Open **Management Hub → Global Settings → Language** to choose:

- 繁體中文 (Traditional Chinese)
- English
- 日本語 (Japanese)

#### Global Settings

Open **Management Hub → Global Settings**:

- **Timezone**: Affects daily / weekly schedules and daily backup times.
- **Backup**: Configure a Git Remote URL and daily backup time, run an immediate backup, and push Canvas data to the remote Git repository.
- **Workspace Password**: Protects access to the current workspace. External deployments should still use HTTPS and network-layer protection.

> ⚠️ `encryption.key` is not included in backups. Encryption-key-related settings must be configured again after a restore.

#### Integration

Open **Management Hub → Integration** to let external platform events create Runs and trigger Pods.

**General setup flow**

1. Select a Provider → Add App → enter the Token / Secret → confirm.
2. Right-click a Pod → Connect Integration → select the registered App and Resource → confirm.

**Discord**

- Requires a Bot Token.
- Bind a Server and Channel; mention the Bot in that channel to trigger it.

**Slack**

- Requires a Bot Token (`xoxb-` prefix) and a 32-character Signing Secret.
- Webhook URL: `/slack/events`

**Telegram**

- Requires a Bot Token from BotFather.
- Supports private messages; enter the User ID as the Resource.

**Jira**

- Requires a Site URL and a Webhook Secret of at least 16 characters.
- Webhook URL: `/jira/events/{appName}`
- Event filters: All / Status Changed

**Sentry**

- Requires a Client Secret of at least 32 characters.
- Webhook URL: `/sentry/events/{appName}`
- Supports created and unresolved events.

**Webhook**

- Enter a name and the system generates a Bearer Token.
- An external program can trigger the bound Pod with a POST request:

```bash
curl -X POST https://your-host/webhook/{appName} \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"message": "trigger"}'
```

#### Run History

Open Run History from the Header to inspect the Runs described above, their downstream workflows, and each Pod's conversation.
