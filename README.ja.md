[繁體中文](README.md) | [English](README.en.md)

# Agent Canvas

AI Agent ワークフローを視覚的にデザインして実行するためのキャンバスツールです。チームでの共同作業もサポートします。

<video src="https://github.com/user-attachments/assets/58a82eb0-e629-46cc-a944-5ba891692b52" controls width="100%"></video>

## 目次

- [注意事項](#注意事項)
- [インストール](#インストール)
- [使い方](#使い方)
- [設定](#設定)
- [AI アクセス](#ai-アクセス)
- [チュートリアル](#チュートリアル)
  - [POD とは何ですか？](#pod-とは何ですか)
  - [モデルの切り替え方法](#モデルの切り替え方法)
  - [Slot の説明](#slot-の説明)
  - [Connection Line](#connection-line)
  - [Run と並列実行](#run-と並列実行)
  - [Plugin](#plugin)
  - [Workflow 実践例](#workflow-実践例)
  - [Schedule スケジュール](#schedule-スケジュール)
  - [Header と管理センター](#header-と管理センター)

## 注意事項

- **macOS / Linux** でテスト済みです。他のオペレーティングシステムでは未知の問題が発生する可能性があります
- **ローカル環境**での利用を推奨します。Workspace Password は利用できますが、完全なマルチユーザーアカウント・ロール管理機能はありません。外部公開する場合は、HTTPS、ファイアウォール、保護されたリバースプロキシなども設定してください
- 認証方式は Provider によって異なり、対応するサブスクリプションログインまたは API Key 設定を利用できます

## インストール

**前提条件：** 対応する AI Provider のうち、少なくとも1つで認証を完了していること

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex CLI](https://developers.openai.com/codex/cli)
- [OpenCode](https://opencode.ai/docs/cli/)

**ワンクリックインストール（推奨）**

```bash
curl -fsSL https://raw.githubusercontent.com/cowbear6598/agent-canvas/main/install.sh | sh
```

**アンインストール**

```bash
curl -fsSL https://raw.githubusercontent.com/cowbear6598/agent-canvas/main/install.sh | sh -s -- --uninstall
```

## 使い方

```bash
# サービスを起動（バックグラウンド daemon モード、デフォルト port 3001）
agent-canvas start

# port を指定して起動
agent-canvas start --port 8080

# サービスの状態を確認
agent-canvas status

# サービスを停止
agent-canvas stop

# 最新ログを表示（デフォルト 50 行）
agent-canvas logs

# 指定行数のログを表示
agent-canvas logs -n 100
```

起動後、ブラウザで `http://localhost:3001` にアクセスすると使用できます。

## 設定

Clone 関連機能でプライベートリポジトリにアクセスする場合は、`config` コマンドで設定してください。`gh` でログイン済みの場合、GitHub Token の設定は不要な場合があります。

```bash
# GitHub Token
agent-canvas config set GITHUB_TOKEN ghp_xxxxx

# GitLab Token
agent-canvas config set GITLAB_TOKEN glpat-xxxxx

# セルフホスト GitLab URL（任意、デフォルトは gitlab.com）
agent-canvas config set GITLAB_URL https://gitlab.example.com

# すべての設定を確認
agent-canvas config list
```

## AI アクセス

Header の管理センターから「AI アクセス」を開くと、失効可能な外部 Token の作成、Advertised URL の設定、Token を含まない Agent Canvas Skill のダウンロードができます。Canvas の許可範囲と `canvas:read`、`canvas:create`、`canvas:write`、`canvas:execute` scope は個別に管理され、`canvas:write` には読み取り権限が含まれます。

Pod の MCP メニューには、既定で無効な内蔵 Agent Canvas MCP もあります。有効にすると、外部管理 Token をモデルへ公開せず、現在の Canvas、Pod、Run に紐づく短期 capability が Run 中だけ発行されます。

## チュートリアル

### POD とは何ですか？

- 1つの Pod は1つの AI Agent を表します
- キャンバスを右クリック → Pod → AI Provider を選択して作成します
- Pod を右クリックすると、Provider の切り替え、Integration の接続、その他の Pod 設定を変更できます

### モデルの切り替え方法

- Pod 上部のモデルラベルにカーソルを合わせ、Provider が対応するモデルを選択します
- Brain メニューで Thinking / effort レベルを調整できます。選択肢はモデルの機能によって異なります

### Slot の説明

- **Plugin**：この Pod で有効にする Plugin / Skill bundle を選択します
- **MCP**：Pod で利用可能にする MCP Server を切り替えます
- **Thinking**：モデルの思考強度を調整します
- **Fast**：Provider が対応する高速モードを切り替えます
- **Goal**：Pod の実行時に従う目標を追加します
- **Repo**：Repository をバインドします。Run では隔離されたワークスペースを使用し、未設定の場合は Pod 自身の作業ディレクトリを使用します

### Connection Line

Connection Line を右クリックすると基本モードを選択でき、Direct も個別に切り替えられます：

- **Auto**：ソース Pod の完了後、その要約を自動的にターゲット Pod へ渡します
- **Branch**：同じソースから伸びる Branch の名前と説明を使い、AI が1本を選択します。判定に失敗した場合、どの Branch もトリガーされません
- **Direct**：Auto または Branch と併用できます。ソースの完了時にターゲットを直接トリガーし、通常の複数入力待機には参加しません

#### 複数接続時のトリガールール

Pod に複数の Connection Line が接続されている場合：

- Auto + Auto：同じグループの全ソースを待ち、要約を結合して1回トリガーします
- Auto + Branch：選択された Branch は準備完了として扱われます。拒否された場合、そのグループはターゲット Pod をトリガーしません
- Direct + Direct：各 Direct は完了時に個別でトリガーされ、**現在は10秒間待って結合する動作はありません**
- Auto + Auto + Direct + Direct：Auto グループは集約ルールに従い、各 Direct は個別にトリガーするため、ターゲット Pod が複数回実行される場合があります
- 同じ Run 内でターゲット Pod がビジーの場合、後続のトリガーは queue に入り、順番に実行されます

#### モデル設定

**管理センター → Model 設定 → Connection Line** でモデルを選択します。同じ設定が下流向け要約の生成と Branch 判定の両方に使用されます。

### Run と並列実行

- 手動メッセージ、Schedule、Integration イベントのたびに Run が作成され、同じ Pod の異なる Run は並列実行できます
- 手動、Schedule、Integration で作成された Run と、その中の下流 Workflow 実行はすべて Run 履歴で確認できます
- Git Repository をバインドすると、Run ごとに隔離されたワークスペースを使用します。同じ Run 内で同じ Repository を使う Pod はそのワークスペースを共有し、Run の終了後に自動的にクリーンアップされます
- 同じ Run 内でビジー状態の Pod が繰り返しトリガーされた場合、queue の順番で実行されます

### Plugin

Plugin Manager では、Pod で利用できる Plugin / Skill bundle を管理します。Claude CLI で事前にインストールする必要はありません。

- **管理センター → Plugin** から GitHub Repository をインポートするかローカル bundle をアップロードし、Plugin Manager で更新、削除、並び替えができます
- Pod の **Plugin Slot** で利用する項目を切り替えます
- 有効な Plugin の機能は、その Pod の実行中に Agent へ提供されます
- Plugin と MCP は個別に設定され、同時に利用できます

### Workflow 実践例

#### 例1：コードレビュー（Auto チェーン）

```text
[Code Reviewer] --Auto--> [Report Generator]
```

- Code Reviewer の Goal にレビュー基準を設定します
- Report Generator は上流の要約を受け取り、完全なレポートにまとめます

#### 例2：スマートルーティング（Branch）

```text
                 /--Branch: Bug----> [Bug Handler]
[Issue Analyzer]
                 \--Branch: Feature-> [Feature Advisor]
```

- 各 Branch に明確な名前と説明を設定します
- 判定に成功すると1本の Branch だけが選択され、失敗するとどの Branch もトリガーされません

#### 例3：並列収集と結合

```text
[Security Analyst]    --Auto--\
                               --> [Final Report]
[Performance Analyst] --Auto--/
```

- 2つの Analyst Pod は並列実行できます
- Final Report は同じ Auto グループの全ソースを待ち、結合された要約を受け取ります

#### 例4：独立した通知（Direct）

```text
[Build] --Direct--> [Notifier]
[Test]  --Direct--> [Notifier]
```

- Build と Test は完了時にそれぞれ Notifier をトリガーします
- Direct は固定時間の結合待ちを行いません。Notifier がビジーの場合、後のトリガーは queue に入ります

### Schedule スケジュール

- **設定**：Pod のタイマーボタンをクリック → 頻度を選択 → 有効化
- **頻度**：x 秒ごと、x 分ごと、x 時間ごと、毎日、毎週
- **編集 / 無効化**：タイマーボタンをクリック → 設定を更新または無効化

- トリガーごとに新しい Run が作成され、完了後は Connection Line のルールに従って下流 Workflow が続行されます
- 同じ Pod の別の Run が実行中でも、Schedule はスキップされません
- 「毎日」と「毎週」の時刻は **管理センター → Global Settings → Timezone** に基づきます

### Header と管理センター

Header には以下の主要な入口があります：

- **接続状態**：フロントエンドとバックエンドの接続状態を表示します
- **管理センター**：Global Settings、Integration、AI アクセス、MCP、Plugin、Model 設定、OpenCode を管理します
- **Run 履歴**：Run と Pod の会話を確認します
- **Canvas セレクター**：Canvas を切り替え、管理します

#### 言語切り替え

**管理センター → Global Settings → Language** で次の言語を選択できます：

- 繁體中文（繁体字中国語）
- English（英語）
- 日本語

#### グローバル設定

**管理センター → Global Settings** を開きます：

- **Timezone**：毎日 / 毎週の Schedule と毎日のバックアップ時刻に影響します
- **Backup**：Git Remote URL と毎日のバックアップ時刻を設定し、即時バックアップを実行して Canvas データをリモート Git Repository にプッシュします
- **Workspace Password**：現在のワークスペースへのアクセスを保護します。外部公開時は HTTPS とネットワーク層の保護も使用してください

> ⚠️ `encryption.key` はバックアップに含まれません。復元後は暗号化キーに関連する設定を再度行う必要があります。

#### Integration 連携

**管理センター → Integration** を開くと、外部プラットフォームのイベントから Run を作成して Pod をトリガーできます。

**共通セットアップフロー**

1. Provider を選択 → Add App → Token / Secret を入力 → 確認
2. Pod を右クリック → Connect Integration → 登録済み App と Resource を選択 → 確認

**Discord**

- Bot Token が必要です
- Server と Channel をバインドし、そのチャンネルで Bot にメンションするとトリガーされます

**Slack**

- Bot Token（`xoxb-` プレフィックス）と32文字の Signing Secret が必要です
- Webhook URL：`/slack/events`

**Telegram**

- BotFather から取得した Bot Token が必要です
- プライベートメッセージに対応し、Resource に User ID を入力します

**Jira**

- Site URL と16文字以上の Webhook Secret が必要です
- Webhook URL：`/jira/events/{appName}`
- イベントフィルター：All / Status Changed

**Sentry**

- 32文字以上の Client Secret が必要です
- Webhook URL：`/sentry/events/{appName}`
- created と unresolved イベントに対応します

**Webhook**

- 名前を入力すると、システムが Bearer Token を生成します
- 外部プログラムは POST リクエストでバインドされた Pod をトリガーできます：

```bash
curl -X POST https://your-host/webhook/{appName} \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"message": "trigger"}'
```

#### Run 履歴

Header から Run 履歴を開くと、上記の Run、下流 Workflow、各 Pod の会話を確認できます。
