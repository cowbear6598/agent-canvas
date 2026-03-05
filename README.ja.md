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

## 注意事項

- 現在まだ **Alpha バージョン**であり、機能やインターフェースが大きく変わる可能性があります
- **ローカル環境**での使用を推奨します。クラウドへのデプロイは推奨しません（このツールには現在ユーザー認証機能がありません）
- **Claude Agent SDK** を使用するため、このサービスは**すでに Claude にログインしている環境**で起動してください。現在 API Key には対応していません
- 現在**macOS のみでテスト済み**です。他のオペレーティングシステムでは未知の問題が発生する可能性があります
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

![Pod](tutorials/pod.png)

### モデルの切り替え方法

- Pod 上部のモデルラベルにカーソルを合わせると、Opus / Sonnet / Haiku を選択できます

![Switch Model](tutorials/switch-model.gif)

### Slot の説明

- Skills / SubAgents は複数入れることができます
- Style（Output Style）/ Command（Slash Command）/ Repo は1つのみ
- Command はメッセージの先頭に自動的に追加されます。例：`/command message`
- Repo は作業ディレクトリを変更します。入れない場合は Pod 自身のディレクトリが使われます

![Slot](tutorials/slot.gif)

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

![Connection Line](tutorials/connection-line.gif)
