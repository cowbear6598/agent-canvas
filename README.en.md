[繁體中文](README.md) | [日本語](README.ja.md)

# Claude Code Canvas

A canvas tool for visually designing and executing AI Agent workflows, powered by Claude Agent SDK for agent execution. Also supports team collaboration.

<video src="https://github.com/user-attachments/assets/58a82eb0-e629-46cc-a944-5ba891692b52" controls width="100%"></video>

## Table of Contents

- [Important Notes](#important-notes)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Tutorials](#tutorials)
  - [What is a POD?](#what-is-a-pod)
  - [How to Switch Models?](#how-to-switch-models)
  - [Slot Overview](#slot-overview)
  - [Connection Line](#connection-line)

## Important Notes

- This project is currently in **Alpha**. Features and UI may change significantly.
- Recommended for **local environment** use only, not recommended for cloud deployment (no user authentication is implemented).
- Since it uses the **Claude Agent SDK**, make sure the service runs in an environment where **Claude is already logged in**. Not supported API Key now.
- Currently **only tested on macOS**. Other operating systems may have unknown issues.
- Canvas data is stored in `~/Documents/ClaudeCanvas`
- AI is currently granted **maximum permissions**. Please be careful with operations.

## Installation

**Prerequisites:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and logged in

```bash
curl -fsSL https://raw.githubusercontent.com/cowbear6598/claude-code-canvas/main/install.sh | sh
```

**Uninstall**

```bash
curl -fsSL https://raw.githubusercontent.com/cowbear6598/claude-code-canvas/main/install.sh | sh -s -- --uninstall
```

## Usage

```bash
# Start service (background daemon, default port 3001)
claude-code-canvas start

# Start with custom port
claude-code-canvas start --port 8080

# Check service status
claude-code-canvas status

# Stop service
claude-code-canvas stop

# View latest logs (default 50 lines)
claude-code-canvas logs

# View specific number of log lines
claude-code-canvas logs -n 100
```

Open your browser and navigate to `http://localhost:3001` to get started.

## Configuration

To use Clone features for accessing private repositories, use the `config` command. If you have already logged in with `gh`, you may not need to set the GitHub Token separately.

```bash
# GitHub Token
claude-code-canvas config set GITHUB_TOKEN ghp_xxxxx

# GitLab Token
claude-code-canvas config set GITLAB_TOKEN glpat-xxxxx

# Self-hosted GitLab URL (optional, defaults to gitlab.com)
claude-code-canvas config set GITLAB_URL https://gitlab.example.com

# List all configurations
claude-code-canvas config list
```

## Tutorials

### What is a POD?

- A Pod = Claude Code
- Right-click on the canvas → Pod to create one

![Pod](tutorials/pod.png)

### How to Switch Models?

- Hover over the model label on top of the Pod to select Opus / Sonnet / Haiku

![Switch Model](tutorials/switch-model.gif)

### Slot Overview

- Skills / SubAgents / MCPs can hold multiple items
- Style (Output Style) / Command (Slash Command) / Repo can only hold one
- Command will automatically prepend to your message, e.g., `/command message`
- Repo changes the working directory; without one, the Pod uses its own directory

![Slot](tutorials/slot.gif)

### Connection Line

- Auto: Always triggers the next Pod regardless
- AI: AI decides whether to trigger the next Pod
- Direct: Ignores other Connection Lines and triggers directly

![Connection Line](tutorials/connection-line.gif)

#### Multi-Connection Trigger Rules

When a Pod has multiple incoming Connection Lines:

- Auto + Auto = Pod triggers when both are ready
- Auto + AI = If AI rejects, Pod won't trigger; if AI approves, Pod triggers
- Direct + Direct = When one completes, waits 10 seconds for other Direct lines to finish; if they do, summarizes together then triggers Pod; otherwise, each summarizes independently
- Auto + Auto + Direct + Direct = Split into two groups (Auto group and Direct group) for summarizing; whichever group completes first triggers first, the other group enters the queue
