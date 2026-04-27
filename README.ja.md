[繁體中文](README.md) | [English](README.en.md)

# Claude Code Canvas

AI Agent ワークフローを視覚的にデザインして実行するためのキャンバスツールです。Claude Agent SDK を使用して Agent の実行を駆動し、チームでの共同作業もサポートします。

<video src="https://github.com/user-attachments/assets/67cceb64-1b02-41a0-8f31-7d41b05a9add" controls width="100%"></video>

## 目次

- [注意事項](#注意事項)
- [インストール](#インストール)
- [使い方](#使い方)
- [設定](#設定)
- [チュートリアル](#チュートリアル)
  - [POD とは何ですか？](#pod-とは何ですか)
  - [モデルの切り替え方法](#モデルの切り替え方法)
  - [Slot の説明](#slot-の説明)
  - [Connection Line](#connection-line)
  - [通常モードと Multi-Instance モード](#通常モードと-multi-instance-モード)
  - [Plugin](#plugin)
  - [Workflow 実践例](#workflow-実践例)
  - [Schedule スケジュール](#schedule-スケジュール)
  - [Header ボタン](#header-ボタン)

## 注意事項

- **ローカル環境**での使用を推奨します。クラウドへのデプロイは推奨しません（このツールには現在ユーザー認証機能がありません）
- **Claude Agent SDK** を使用するため、このサービスは**すでに Claude にログインしている環境**で起動してください。現在 API Key には対応していません
- **macOS / Linux** でテスト済みです。他のオペレーティングシステムでは未知の問題が発生する可能性があります
- キャンバスのデータは `~/Documents/ClaudeCanvas` に保存されます
- 現在 AI に**最大権限**が付与されています。操作にはご注意ください

## インストール

**前提条件：** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) がインストールされてログイン済みであること

**ワンクリックインストール（推奨）**

```bash
curl -fsSL https://raw.githubusercontent.com/cowbear6598/claude-code-canvas/main/install.sh | sh
```

**アンインストール**

```bash
curl -fsSL https://raw.githubusercontent.com/cowbear6598/claude-code-canvas/main/install.sh | sh -s -- --uninstall
```

## 使い方

```bash
# サービスを起動（バックグラウンド daemon モード、デフォルト port 3001）
claude-code-canvas start

# port を指定して起動
claude-code-canvas start --port 8080

# サービスの状態を確認
claude-code-canvas status

# サービスを停止
claude-code-canvas stop

# 最新ログを表示（デフォルト 50 行）
claude-code-canvas logs

# 指定行数のログを表示
claude-code-canvas logs -n 100
```

起動後、ブラウザで `http://localhost:3001` にアクセスすると使用できます。

## 設定

Clone 関連機能でプライベートリポジトリにアクセスする場合は、`config` コマンドで設定してください。`gh` でログイン済みの場合、GitHub Token の設定は不要な場合があります。

```bash
# GitHub Token
claude-code-canvas config set GITHUB_TOKEN ghp_xxxxx

# GitLab Token
claude-code-canvas config set GITLAB_TOKEN glpat-xxxxx

# セルフホスト GitLab URL（任意、デフォルトは gitlab.com）
claude-code-canvas config set GITLAB_URL https://gitlab.example.com

# すべての設定を確認
claude-code-canvas config list
```

## チュートリアル

### POD とは何ですか？

- 1つの Pod = Claude Code
- キャンバスを右クリック → Pod で作成できます

### モデルの切り替え方法

- Pod 上部のモデルラベルにカーソルを合わせると、Opus / Sonnet / Haiku を選択できます

### Slot の説明

- Skills / SubAgents は複数入れることができます
- Style（Output Style）/ Command（Slash Command）/ Repo は1つのみ
- Command はメッセージの先頭に自動的に追加されます。例：`/command message`
- Repo は作業ディレクトリを変更します。入れない場合は Pod 自身のディレクトリが使われます

### Connection Line

- Auto：どんな場合でも次の Pod を実行します
- AI：AI が次の Pod を実行するかどうかを判断します
- Direct：他の Connection Line を無視して直接実行します

#### 複数接続時のトリガールール

Pod に複数の Connection Line が接続されている場合：

- Auto + Auto = 両方の準備ができた時に Pod がトリガーされます
- Auto + AI = AI が拒否した場合はトリガーされず、承認した場合は Pod がトリガーされます
- Direct + Direct = 一方が完了すると、10秒間他の Direct が完了するか待ちます。完了した場合は一緒にまとめて Pod をトリガーし、待ち時間内に完了しない場合はそれぞれ個別にまとめます
- Auto + Auto + Direct + Direct = 2つのグループ（Auto グループと Direct グループ）に分けてまとめを行い、先に完了したグループが先にトリガーされ、もう一方のグループはキューに入って待機します

#### モデル設定

Connection Line を右クリックして、以下のモデルを切り替えることができます（デフォルトはどちらも Sonnet）：

- **Summary Model**：下流の Pod に渡す要約を生成するモデル
- **AI Model**：下流の Pod をトリガーするかどうかを判断するモデル（AI モードでのみ利用可能）

### 通常モードと Multi-Instance モード

Pod はデフォルトで通常モードです。**消しゴムボタンを長押し**すると Multi-Instance モードに切り替わり、ボタンに **M** アイコンが表示されます。

#### 通常モード

- 一度に1つのメッセージのみ処理し、ビジー時は新しいメッセージがキューに入ります
- Pod がビジー時、Integration イベントはスキップされます

#### Multi-Instance モード

- メッセージを送信するたびに新しい Run が作成され、並列実行が可能です
- ビジー状態に関係なく Integration イベントは常に実行されます
- チャット履歴は Run 履歴から確認してください
- Git Repo がバインドされている場合、各 Run は独立した Worktree を作成し、実行完了後に自動的にクリーンアップされます

### Plugin

Plugin は Claude CLI でインストールする拡張機能で、Pod に追加の機能を提供します。

- Plugin は事前に `claude` CLI でシステムにインストールする必要があります（`~/.claude/plugins/`）
- Pod を**右クリック** → Plugin → トグルスイッチで有効化 / 無効化
- 有効化すると、Pod の会話処理時に Plugin が読み込まれます
- Skills、MCP、SubAgents とは異なるシステムで、すべて同時に使用できます

### Workflow 実践例

**例1：コードレビュー（Auto チェーン）**

```
[Code Reviewer] --Auto--> [Report Generator]
```

- Pod A に Output Style でレビュー設定を行い、Pod B がレポートを生成します
- ポイント：Auto = 前の Pod が完了すると自動的に次をトリガーし、下流は前の Pod の出力を受信します

**例2：スマートルーティング（AI 条件分岐）**

```
[Issue Analyzer] --AI--> [Bug Handler]
[Issue Analyzer] --AI--> [Feature Advisor]
```

- AI がコンテンツに基づいてどの Pod をトリガーするか決定します
- ポイント：AI は複数、1つ、またはゼロの Pod をトリガーする可能性があります

**例3：並列収集 + マージ（マルチ入力集約）**

```
[Security Analyst]    --Auto--> [Final Report]
[Performance Analyst] --Auto--> [Final Report]
```

- 両方の Pod が完了した時のみ Final Report がトリガーされます
- ポイント：マルチ入力 Auto はすべてのソースの完了を待機します

### Schedule スケジュール

- Pod を設定した時間に自動実行する機能です
- 設定：Pod のタイマーボタンをクリック → 頻度を選択 → 有効化

<!-- screenshot: schedule-setup.png -->

**頻度タイプ（5種類）**

- x 秒ごと
- x 分ごと
- x 時間ごと
- 毎日
- 毎週

**編集・無効化**

- 編集：タイマーボタンをクリック → 内容を変更 → 更新
- 無効化：タイマーボタンをクリック → 無効化

**動作**

- トリガー時：Pod のステータスが chatting に変更されます
- 完了後：下流の Workflow が自動的にトリガーされます
- 注意：スケジュールはタイムゾーン設定（Settings）に依存します。Pod がビジー状態の場合はスキップされます

### Header ボタン

左から右へ4つのアイコン：

- **地球アイコン**：UI の言語を切り替え
- **歯車アイコン**：グローバル設定（タイムゾーン、バックアップ）
- **鍵アイコン**：インテグレーション管理（Slack、Telegram、Jira、Sentry、Webhook）
- **時計アイコン**：Run 実行履歴を表示

#### 言語切り替え

**地球アイコン**をクリックして、UI の言語を切り替えることができます：

- 繁體中文（繁体字中国語）
- English（英語）
- 日本語

#### グローバル設定

**歯車アイコン**をクリックしてグローバル設定を開きます。

**タイムゾーン**

**Timezone** で設定します。以下の機能に影響します：

- **Schedule スケジュール**：「毎日」と「毎週」のトリガー時刻はこのタイムゾーンに基づいて計算されます
- **バックアップスケジュール**：毎日の自動バックアップのトリガー時刻はこのタイムゾーンに基づいて計算されます

**バックアップ**

- **Backup** → 有効化 → Git Remote URL を入力 → 毎日のバックアップ時間を選択 → 保存
- Canvas データをリモート Git リポジトリにプッシュします

> ⚠️ `encryption.key` はバックアップに含まれません。別途保管してください。

#### Integration 連携

**鍵アイコン**をクリックしてインテグレーション管理を開きます。外部プラットフォームのイベントが自動的に Pod の実行をトリガーします。

**共通セットアップフロー**

1. Provider 選択 → **Add App** → Token / Secret を入力 → 確認
2. Pod を**右クリック** → Connect Integration → 登録済み App を選択 → 確認

**Slack**

- 必要な情報：Bot Token（`xoxb-` プレフィックス）+ Signing Secret（32文字）
- Webhook URL：`/slack/events`

**Telegram**

- 必要な情報：Bot Token（BotFather から取得）
- プライベートメッセージのみ対応
- Resource は手動で User ID を入力してください

**Jira**

- 必要な情報：Site URL + Webhook Secret（最低16文字）
- Webhook URL：`/jira/events/{appName}`
- イベントフィルター：All / Status Changed から選択できます

**Sentry**

- 必要な情報：Client Secret（最低32文字）
- Webhook URL：`/sentry/events/{appName}`
- created と unresolved イベントに対応しています

**Webhook**

外部プログラムに Webhook URL を提供し、Pod の実行を自動的にトリガーする仕組みです。

- 名前のみ入力すると、システムが Bearer Token を自動生成します
- 外部プログラムが POST リクエストで Pod をトリガーします：

```bash
curl -X POST https://your-host/webhook/events/{appName} \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"message": "trigger"}'
```

#### 実行履歴

**時計アイコン**をクリックして Run 実行履歴パネルを開きます。Multi-Instance モードの実行記録のみが記録されます。
