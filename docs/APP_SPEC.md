# Manufacturing Intelligent Document Management

> 製造業の設計ファイルをTeams/SharePoint連携で管理し、AIによるフォローアップ質問で暗黙知を抽出・蓄積するWebアプリケーション

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | JavaScript (ブラウザ稼働) |
| バックエンド | Python / Flask |
| データベース | Azure Cosmos DB |
| ドキュメント分析 | Azure Content Understanding in Foundry Tools (pre-built モデル) |
| AI エージェント | Microsoft Foundry Agent Service (New Foundry Agent) |
| 認証 | Microsoft Entra ID (MSAL.js + MSAL Python) |
| ファイル管理 | Microsoft Teams / SharePoint Online (Graph API) |
| ホスティング | Azure App Service |

### Python パッケージ (バックエンド)

| パッケージ | 用途 |
|-----------|------|
| `flask` | Web フレームワーク |
| `gunicorn` | WSGI サーバー |
| `msal` | Microsoft Entra ID 認証 (Confidential Client) |
| `msgraph-sdk` | Microsoft Graph API クライアント |
| `azure-ai-contentunderstanding` | Content Understanding SDK (GA v1.0.1) |
| `azure-ai-projects` | Foundry Agent Service SDK (v2.0.0+) |
| `azure-cosmos` | Cosmos DB NoSQL SDK (v4.7+) |
| `azure-identity` | Azure 認証 (DefaultAzureCredential) |

### JavaScript ライブラリ (フロントエンド)

| ライブラリ | 用途 |
|-----------|------|
| `@azure/msal-browser` | MSAL.js v2.35.0 (SPA 認証、CDN 配信) |
| `marked` | Markdown → HTML パーサー (CDN 配信) |
| `DOMPurify` | HTML サニタイズ (XSS 防止、CDN 配信) |

## ディレクトリ構成

```
├── azure.yaml              # azd プロジェクト定義 (hooks 含む)
├── infra/                  # IaC (Bicep)
│   ├── main.bicep
│   ├── main.parameters.json
│   ├── abbreviations.json
│   └── modules/
│       ├── ai-foundry.bicep
│       ├── ai-foundry-role-assignment.bicep
│       ├── app-service.bicep
│       ├── app-service-plan.bicep
│       ├── cosmos-db.bicep
│       └── cosmos-role-assignment.bicep
├── scripts/
│   └── create_agents.py    # Foundry Agent 自動作成スクリプト
├── src/
│   ├── frontend/           # フロントエンド (JavaScript)
│   │   ├── index.html
│   │   ├── css/styles.css
│   │   └── js/
│   │       ├── app.js
│   │       ├── api.js
│   │       ├── auth.js
│   │       ├── config.js
│   │       └── ui.js
│   └── backend/            # バックエンド API (Python / Flask)
│       ├── app.py
│       ├── config.py
│       ├── requirements.txt
│       ├── routes/
│       │   ├── auth_routes.py
│       │   ├── teams_routes.py
│       │   └── document_routes.py
│       └── services/
│           ├── auth_service.py
│           ├── graph_service.py
│           ├── cosmos_service.py
│           ├── content_understanding_service.py
│           └── agent_service.py
└── docs/
    └── APP_SPEC.md
```

---

## UI デザイン

言語: **英語** のモダン UI Web アプリケーション

### レイアウト

```
┌─────────────────────────────────────────────────────────────────────┐
│ [Logo] Manufacturing Intelligent    [Teams Channel ▼] [Deep Analysis] [EN/JP] [User名]  │
│        Document Management          (トップ中央)                                      │
├──────────────────────────┬──────────────────────────────────────────┤
│                          │                                          │
│   ファイル一覧 (左ペイン)  │        ファイル詳細 (右ペイン)            │
│                          │                                          │
│  ┌────────────────────┐  │  ファイル識別子: DOC-XXXX-XXXX           │
│  │ 📄 design_v1.pdf   │  │  ファイル名: design_v1.pdf               │
│  │ 📄 spec_rev2.pdf   │  │  作成日: 2026-03-01                     │
│  │ 📄 drawing.pdf     │  │  作成者: John Smith                      │
│  │                    │  │  最終更新日: 2026-03-15                   │
│  │                    │  │  最終更新者: Jane Doe                     │
│  │  ┌──────────────┐  │  │                                          │
│  │  │ドラッグ&ドロップ│  │  │  [📄 ファイルの分析結果] ボタン           │
│  │  │  でアップロード │  │  │                                          │
│  │  └──────────────┘  │  │  フォローアップ質問・回答一覧:            │
│  │  │  でアップロード │  │  │  ┌──────────────────────────────────┐  │
│  │  └──────────────┘  │  │  │ Q1: ... │ 会話スレッド全文表示     │  │
│  └────────────────────┘  │  │ Q2: ... │ 会話スレッド全文表示     │  │
│                          │  │ Q3: ... │ Not Available             │  │
│                          │  └──────────────────────────────────────┘  │
└──────────────────────────┴──────────────────────────────────────────┘
```

### ヘッダー構造

ヘッダーは3セクション構成で、CSS Flexbox により各セクションが均等に配置される:

| セクション | CSS クラス | 配置 | 内容 |
|-----------|-----------|------|------|
| 左 | `.header-left` | `flex: 1` | ロゴアイコン + アプリタイトル |
| 中央 | `.header-center` | `flex: 1; justify-content: center` | Teams チャネル選択プルダウン |
| 右 | `.header-right` | `flex: 1; justify-content: flex-end` | Deep Analysis トグルスイッチ + 言語切り替え (EN/JP) + ユーザー名表示 |

### フォローアップ質問ウィンドウ (モーダル — チャットスレッド形式)

- ファイルアップロード完了後に表示されるモーダルウィンドウ
- AI が生成した質問を **1 問ずつチャットスレッド形式** で表示
- ユーザーが応答 → AI が回答の十分性を判定:
  - **十分**: チャットバブルで確認メッセージ → 1.5 秒後に次の質問へ (スレッドリセット)
  - **不十分**: 黄色の警告バブルで補足要求を表示 → 再入力可能
- **最大 3 回の深堀り質問** で自動的に完了 (AI が不十分と判定しても強制終了)
- **スキップ機能**: 各質問に「Skip」ボタンを提供。スキップすると `pending` のまま次の質問へ
- Enter キーで送信、Shift+Enter で改行
- 全質問完了後にお礼メッセージを表示してウィンドウを閉じる

### ファイル詳細の質問・回答表示

- 回答済みの質問には `conversationThread` の全メッセージを時系列で表示
- ユーザーメッセージ: 青い左ボーダー (`.thread-msg-user`)
- AI フィードバック: 灰色の左ボーダー (`.thread-msg-ai`)
- 未回答の質問は「Not Available」バッジで表示

### ファイル分析結果モーダル

- ファイル詳細のメタデータとフォローアップ質問の間に「ファイルの分析結果」ボタンを配置
- クリックするとモーダルウィンドウを表示し、Cosmos DB に保存された Content Understanding 分析結果を閲覧可能
- **表示項目**: モデルバージョン、分析日時、テーブル情報、キー・バリューペア、抽出テキスト (Markdown レンダリング)
- 抽出テキストは `marked.js` で Markdown → HTML 変換し、`DOMPurify` でサニタイズして表示
- 分析データが存在しない場合はボタンを無効化

---

## 機能一覧

### 1. 認証・ログイン

- **概要**: アプリ接続時に Microsoft Entra ID 経由で認証を実施
- **フロントエンド認証**: MSAL.js v2.35.0 (Authorization Code Flow with PKCE) でブラウザ上でトークン取得
  - CDN: `https://alcdn.msauth.net/browser/2.35.0/js/msal-browser.min.js`
  - ログインスコープ: `api://<client-id>/access_as_user` (OBO フロー用)
  - キャッシュ: `sessionStorage`
- **バックエンド認証**: MSAL Python (Confidential Client) で On-Behalf-Of (OBO) フローにより Graph API を呼び出し
- **Entra ID アプリ登録で必要な API 権限 (Delegated)**:
  - `User.Read` — ユーザー情報取得
  - `Team.ReadBasic.All` — 参加チーム一覧取得
  - `Channel.ReadBasic.All` — チャネル一覧取得
  - `Files.ReadWrite.All` — SharePoint ファイルの読み書き
  - `Sites.ReadWrite.All` — SharePoint サイトメタデータ操作
- **Azure サービス認証**: バックエンドから Content Understanding / Foundry Agent Service / Cosmos DB には `DefaultAzureCredential` (Managed Identity) を使用

### 2. Teams チャネル選択

- **概要**: ログイン後、ユーザーがアクセス権を持つ Teams チャネルのみをプルダウンで表示・選択
- **バックエンド処理**: 2 段階の Graph API 呼び出し
  1. `GET /me/joinedTeams`
  2. `GET /teams/{teamId}/channels`
- **エンドポイント**: `GET /api/teams/channels`
- **UI**: トップ中央のプルダウンで「チーム名 > チャネル名」形式で表示

### 3. ファイル一覧表示

- **概要**: 選択した Teams チャネルの SharePoint サイトに共有されているファイル一覧を左ペインに表示
- **バックエンド処理**:
  1. `GET /teams/{teamId}/channels/{channelId}/filesFolder` — DriveItem 取得
  2. `GET /drives/{driveId}/items/{folderId}/children` — ファイル一覧取得
- **エンドポイント**: `GET /api/teams/{team_id}/channels/{channel_id}/files`
- **Cosmos DB 連携**: 各ファイルの `driveItemId` で Cosmos DB を検索し、既存の `docId` があれば返却

### 4. ファイルアップロード

- **概要**: 左ペインにファイルをドラッグ＆ドロップしてアップロード
- **エンドポイント**: `POST /api/teams/{team_id}/channels/{channel_id}/files`
- **対応形式**: PDF のみ
- **SharePoint へのアップロード方法**:
  - 小ファイル (< 4MB): `PUT /drives/{driveId}/items/{folderId}:/{fileName}:/content`
  - 大ファイル (≥ 4MB): Upload Session API
- **独自ドキュメント識別子**: `doc-{YYYYMMDD}-{UUID4先頭8桁}` 形式 (例: `doc-20260330-a1b2c3d4`)
- **非同期処理フロー**:
  1. SharePoint にアップロード
  2. ドキュメント識別子を生成・SharePoint カスタム列に付与
  3. Cosmos DB に `processingStatus: "analyzing"` で初期ドキュメント保存
  4. HTTP 201 をフロントエンドに即座に返却
  5. **バックグラウンドスレッド** で Content Understanding 分析を実行
  6. 分析結果を Cosmos DB に保存、`processingStatus: "generating_questions"` に更新
  7. Foundry Agent で約 5 問の質問生成
  8. 質問リストを Cosmos DB に保存、`processingStatus: "completed"` に更新
- **フロントエンドポーリング**: アップロード後、フロントエンドは 5 秒間隔で `GET /api/documents/{doc_id}` をポーリングし、`processingStatus` が `completed` または `error` になるまで待機 (最大 10 分)
- **進捗表示**: モーダルに処理段階に応じたメッセージを表示 (「アップロード中…」→「分析中…」→「質問生成中…」)
- **再アップロード**: 既存の質問・回答は `questionHistory` に移動、新規質問を生成
- **部分的完了**: 各ステップの障害時にそれまでの結果を保持し、`processingError` フィールドにエラー詳細を記録

### 5. Content Understanding 分析

- **サービス**: Azure Content Understanding in Foundry Tools (Azure AI Service)
- **Python SDK**: `azure-ai-contentunderstanding` v1.0.1 (API version `2025-11-01`)
- **アナライザー切り替え** (Deep Analysis トグルスイッチ):
  - **OFF (デフォルト)**: `prebuilt-document` — 高速なテキスト抽出、テーブル、キー・バリューペア抽出
  - **ON**: `prebuilt-documentSearch` (RAG 用アナライザー) — 図の検出・説明生成 (チャート: chart.js、ダイアグラム: mermaid.js)、テーブル、キー・バリューペア、サマリー生成
- **切り替え方法**: ヘッダー右側の「Deep Analysis」トグルスイッチでアップロード時に選択。フロントエンドから `deepAnalysis` パラメータでバックエンドに送信
- **入力**: `AnalysisInput(data=file_content, mime_type="application/pdf")`
- **出力**: `AnalysisResult` — `result.contents[0].markdown` で抽出テキスト取得 (Deep Analysis ON 時は図の説明がマークダウン内に埋め込み)
- **前提設定**: Foundry リソースに Content Understanding デフォルト設定が必要:
  ```
  PATCH {endpoint}/contentunderstanding/defaults?api-version=2025-11-01
  { "modelDeployments": { "gpt-4.1-mini": "gpt-41-mini", "text-embedding-3-large": "text-embedding-3-large" } }
  ```
  この設定は `azd up` の postprovision hook で自動実行される

### 6. フォローアップ質問生成 (質問作成エージェント)

- **エージェント名**: `question-generator-agent`
- **エージェント種別**: Prompt Agent (New Foundry Agent)
- **モデル**: `gpt-41-mini` (gpt-4.1-mini のデプロイメント名)
- **Python SDK**: `azure-ai-projects` v2.0.0+ — `AIProjectClient` + OpenAI Conversations API
- **呼び出しパターン**:
  ```python
  project_client = AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=credential)
  openai_client = project_client.get_openai_client()
  conversation = openai_client.conversations.create()
  response = openai_client.responses.create(
      conversation=conversation.id,
      input=analysis_text,
      extra_body={"agent_reference": {"name": "question-generator-agent", "type": "agent_reference"}},
  )
  questions = json.loads(response.output_text)
  ```
- **エージェント instructions**: 製造業ドメインの暗黙知を引き出す約 5 問の質問を生成。4 つの視点 (前提条件、論理ギャップ、経験知、見落としリスク) に基づく
- **図 ID → ページ番号変換**: エージェントへの入力テキスト内の図 ID (`fig-001` 等) をすべて `(page N)` に置換し、ページ番号で参照可能にする
- **参照ルール**: エージェント instructions で図 ID・図番号の参照を明示的に禁止。質問ではページ番号を使って参照する
- **出力形式**: `[{"questionId": "q-001", "question": "...", "perspective": "..."}]`
- **エージェント作成**: `azd up` の postprovision hook で `scripts/create_agents.py` が自動作成

### 7. フォローアップ質問応答 (質問回答分析エージェント)

- **エージェント名**: `answer-analysis-agent`
- **エージェント種別**: Prompt Agent (New Foundry Agent)
- **モデル**: `gpt-41-mini`
- **判定基準**: 実用的な知見が共有されているか、文脈が十分か、質問に関連しているか
- **出力形式**: `{"validation": "sufficient"|"insufficient", "feedback": "..."}`
- **寛容な判定ポリシー**:
  - 短い回答でも実質的内容があれば受理
  - 「N/A」「不明」も理由なしで受理
  - 文法・フォーマットは不問
  - 疑わしい場合は sufficient として扱う
- **最大深堀り回数**: 3 回 (バックエンド・フロントエンド両方で制限)
  - バックエンド: `conversationThread` 内のユーザーメッセージ数が 3 以上で自動 sufficient
  - フロントエンド: `roundCount >= MAX_ROUNDS` で AI 判定に関わらず次の質問へ
- **会話スレッド保存**: 各やりとり (ユーザー回答 + AI フィードバック) を `conversationThread` 配列に蓄積

### 8. ファイル詳細表示

- **エンドポイント**: `GET /api/documents/{doc_id}?channelId={channelId}`
- **データ取得元**:
  - **ファイルメタデータ**: Graph API からリアルタイム取得 (`driveItemPath` を使用)
  - **分析結果・質問・回答**: Cosmos DB から取得
- **表示項目**: ファイル識別子、ファイル名、作成日/作成者、最終更新日/更新者、分析結果ボタン、フォローアップ質問一覧 (会話スレッド全文)

---

## データモデル (Cosmos DB)

### コンテナ設計

- **コンテナ名**: `documents`
- **パーティションキー**: `/channelId`
- **作成方法**: `azd up` の postprovision hook で `az cosmosdb sql container create` により作成 (ARM コントロールプレーン経由)

```jsonc
{
  // === 基本識別情報 ===
  "id": "doc-20260330-a1b2c3d4",
  "channelId": "teams-channel-id",
  "siteId": "sharepoint-site-id",
  "driveItemId": "sharepoint-drive-item-id",
  "driveItemPath": "/drives/{driveId}/items/{itemId}",

  // === Content Understanding 分析結果 ===
  "analysis": {
    "modelVersion": "prebuilt-documentSearch-v1",
    "analyzedAt": "2026-03-15T14:35:00Z",
    "extractedText": "... (抽出テキスト markdown、図の説明埋め込み) ...",
    "figures": [{ "figureId": "fig-001", "description": "...", "boundingBox": { "page": 3 } }],
    "tables": [],
    "keyValuePairs": []
  },

  // === フォローアップ質問・回答 (会話スレッド含む) ===
  "followUpQuestions": [
    {
      "questionId": "q-001",
      "question": "What temperature range was assumed?",
      "perspective": "unstated_assumptions",
      "generatedAt": "2026-03-15T14:40:00Z",
      "status": "answered",
      "answeredBy": "john.smith@contoso.com",
      "answeredAt": "2026-03-15T15:00:00Z",
      "answer": "The assumed range is -40°C to 120°C",
      "agentValidation": "sufficient",
      "conversationThread": [
        { "role": "user", "text": "About -40 to 120C", "timestamp": "...", "answeredBy": "..." },
        { "role": "assistant", "text": "Could you clarify the basis?", "timestamp": "...", "validation": "insufficient" },
        { "role": "user", "text": "Based on MIL-STD-810G testing", "timestamp": "...", "answeredBy": "..." },
        { "role": "assistant", "text": "Thank you, that's clear.", "timestamp": "...", "validation": "sufficient" }
      ]
    }
  ],

  // === 質問履歴 (再アップロード時) ===
  "questionHistory": [],
  "relatedDocuments": [],

  // === 非同期処理ステータス ===
  "processingStatus": "completed",  // "analyzing" | "generating_questions" | "completed" | "error"
  "processingError": null,           // エラー発生時のメッセージ

  // === メタ情報 ===
  "version": 1,
  "createdInDbAt": "2026-03-15T14:35:00Z",
  "updatedInDbAt": "2026-03-15T15:05:00Z"
}
```

---

## API エンドポイント一覧

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/teams/channels` | ユーザーが参加するチーム・チャネル階層一覧取得 |
| `GET` | `/api/teams/{team_id}/channels/{channel_id}/files` | チャネルの SharePoint ファイル一覧取得 |
| `POST` | `/api/teams/{team_id}/channels/{channel_id}/files` | ファイルアップロード (PDF のみ、非同期処理) |
| `GET` | `/api/documents/{doc_id}?channelId={channelId}` | ドキュメント詳細取得 (Cosmos DB + Graph API) |
| `POST` | `/api/documents/{doc_id}/generate-questions` | フォローアップ質問生成 |
| `POST` | `/api/documents/{doc_id}/questions/{q_id}/answer` | 質問への回答送信・分析 (最大 3 往復) |
| `GET` | `/api/me` | ログインユーザー情報取得 |

---

## Azure リソース (Bicep 自動プロビジョニング)

`azd up` で以下のリソースがすべて自動作成される。手動設定が必要なのは **Entra ID アプリ登録のみ**。

| リソース | Bicep モジュール | 設定 |
|---------|-----------------|------|
| Resource Group | main.bicep | `rg-{environmentName}` |
| Azure Cosmos DB | cosmos-db.bicep | Serverless, `disableLocalAuth: true`, `publicNetworkAccess: Enabled` |
| Microsoft Foundry (AIServices) | ai-foundry.bicep | `kind: AIServices`, `allowProjectManagement: true`, `disableLocalAuth: true`, API `2025-06-01` |
| Foundry Project | ai-foundry.bicep | 子リソース `/projects`, SystemAssigned Identity |
| gpt-4.1-mini デプロイメント | ai-foundry.bicep | デプロイメント名 `gpt-41-mini`, GlobalStandard, capacity 10 |
| text-embedding-3-large デプロイメント | ai-foundry.bicep | GlobalStandard, capacity 10 |
| App Service Plan | app-service-plan.bicep | Linux, B1 SKU |
| App Service | app-service.bicep | Python 3.10, SystemAssigned Identity, SCM/FTP Basic Auth 無効 |
| Cosmos DB RBAC | cosmos-role-assignment.bicep | Data Contributor + DocumentDB Account Contributor |
| AI Foundry RBAC | ai-foundry-role-assignment.bicep | Cognitive Services User |

### postprovision hook で実行される追加セットアップ

1. **フロントエンド静的ファイルのコピー** (`src/frontend` → `src/backend/static`)
2. **Entra ID 値の config.js 注入** (`__ENTRA_CLIENT_ID__`, `__ENTRA_TENANT_ID__` 置換)
3. **ZIP デプロイ** (`az webapp deployment source config-zip`, Oryx ビルド)
4. **Cosmos DB データベース/コンテナ作成** (`az cosmosdb sql database/container create`)
5. **Content Understanding デフォルト設定** (`PATCH /contentunderstanding/defaults`)
6. **Foundry Agent 作成** (`scripts/create_agents.py` — `question-generator-agent`, `answer-analysis-agent`)

---

## 非機能要件

- **認証**: Microsoft Entra ID (フロントエンド: MSAL.js v2.35.0 PKCE、バックエンド: MSAL Python OBO)
- **認可**: Graph API Delegated 権限スコープに基づくアクセス制御
- **対応ファイル形式**: PDF のみ
- **パフォーマンス**: 同期 API レスポンス < 500ms。Content Understanding 分析・Foundry Agent 呼出しはバックグラウンドスレッドで非同期実行 (フロントエンドは 5 秒間隔ポーリング)
- **セキュリティ**:
  - OWASP Top 10 準拠
  - Key 認証完全無効化 (`disableLocalAuth: true` — Cosmos DB, AI Foundry)
  - SCM/FTP Basic 認証無効化
  - Managed Identity (RBAC) ベースの全 Azure サービス認証
  - HTTPS Only, TLS 1.2 最小バージョン
- **デプロイ**: `azd up` 一発デプロイ (Entra ID アプリ登録のみ事前手動設定)
- **ランタイム**: Python 3.10 (App Service Linux, Oryx ビルド)
- **起動タイムアウト**: `WEBSITES_CONTAINER_START_TIME_LIMIT=600` (10 分)

## エラーハンドリング

### リトライポリシー

| 対象サービス | リトライ回数 | リトライ間隔 | 備考 |
|-------------|------------|------------|------|
| Microsoft Graph API | 最大 3 回 | 指数バックオフ (1s, 2s, 4s) | 429 / 503 / 504 はリトライ |
| Content Understanding | 最大 3 回 | 指数バックオフ (2s, 4s, 8s) | LRO ポーリング中の一時エラーもリトライ |
| Foundry Agent Service | 最大 3 回 | 指数バックオフ (1s, 2s, 4s) | タイムアウトは 60 秒 |
| Cosmos DB | 最大 3 回 | 指数バックオフ (1s, 2s, 4s) | 429 はリトライ |

### 部分的完了の扱い

バックグラウンド処理中の障害は `processingStatus: "error"` と `processingError` フィールドに記録される。フロントエンドはポーリング結果でエラーを検知しユーザーに通知する。

| 障害発生ステップ | processingStatus | 保持される結果 |
|----------------|-----------------|---------------|
| SharePoint アップロード失敗 | (HTTP 500 即時返却) | なし |
| Content Understanding 分析失敗 | `error` | SharePoint 上のファイル + Cosmos DB 初期ドキュメント |
| 質問生成失敗 | `completed` (processingError あり) | SharePoint ファイル + 分析結果 (Cosmos DB) |
| 質問応答中のエージェント障害 | — (HTTP 207) | 上記 + 保存済み回答 |

## コーディング規約

- フロントエンド: JavaScript (ES Modules)
- バックエンド: Python 3.10+ / Flask
- コミットメッセージ: Conventional Commits
