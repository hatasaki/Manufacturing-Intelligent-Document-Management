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
| `msal` | Microsoft Entra ID 認証 (Confidential Client) |
| `msgraph-sdk` | Microsoft Graph API クライアント |
| `azure-ai-contentunderstanding` | Content Understanding SDK (GA v1.0.1) |
| `azure-ai-projects` | Foundry Agent Service SDK (v2.0.0+) |
| `azure-cosmos` | Cosmos DB NoSQL SDK (v4.7+) |
| `azure-identity` | Azure 認証 (DefaultAzureCredential) |

### JavaScript ライブラリ (フロントエンド)

| ライブラリ | 用途 |
|-----------|------|
| `@azure/msal-browser` | MSAL.js v2 (SPA 認証) |

## ディレクトリ構成

```
src/
├── frontend/        # フロントエンド (JavaScript)
├── backend/         # バックエンド API (Python / Flask)
└── infra/           # IaC (Bicep)
```

---

## UI デザイン

言語: **英語** のモダン UI Web アプリケーション

### レイアウト

```
┌─────────────────────────────────────────────────────────────────────┐
│ [Logo] Manufacturing Intelligent    [Teams Channel ▼]    [User名]  │
│        Document Management          (プルダウン選択)               │
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
│  │  │ドラッグ&ドロップ│  │  │  フォローアップ質問・回答一覧:            │
│  │  │  でアップロード │  │  │  ┌──────────────────────────────────┐  │
│  │  └──────────────┘  │  │  │ Q1: ... │ 回答者: ... │ 回答: ... │  │
│  └────────────────────┘  │  │ Q2: ... │ 回答者: ... │ 回答: ... │  │
│                          │  │ Q3: ... │ Not Available             │  │
│                          │  └──────────────────────────────────────┘  │
└──────────────────────────┴──────────────────────────────────────────┘
```

### UI 要素

| 位置 | 要素 | 説明 |
|------|------|------|
| トップ左 | アプリタイトル | "Manufacturing Intelligent Document Management" |
| トップ中央 | Teams チャネル選択 | プルダウンでユーザーがアクセス可能な Teams チャネルを選択 |
| トップ右 | ユーザー名表示 | ログイン中のユーザー名を表示 |
| 左ペイン | ファイル一覧 | 選択した Teams チャネルの SharePoint 共有ファイル一覧。ドラッグ＆ドロップによるアップロード対応 |
| 右ペイン | ファイル詳細 | 選択ファイルのメタデータ、フォローアップ質問・回答一覧を表示 |

### フォローアップ質問ウィンドウ (モーダル)

- ファイルアップロード完了後に表示されるモーダルウィンドウ
- AI が生成した質問を 1 問ずつ表示
- ユーザーが応答 → AI が回答の十分性を判定 → 不十分なら補足を求める
- 全質問完了後にお礼メッセージを表示してウィンドウを閉じる

---

## 機能一覧

### 1. 認証・ログイン

- **概要**: アプリ接続時に Microsoft Entra ID 経由で Graph API への認証を実施
- **フロントエンド認証**: MSAL.js v2 (Authorization Code Flow with PKCE) でブラウザ上でトークン取得
- **バックエンド認証**: MSAL Python (Confidential Client) で On-Behalf-Of (OBO) フローにより Graph API / Azure サービスを呼び出し
- **Entra ID アプリ登録で必要な API 権限 (Delegated)**:
  - `User.Read` — ユーザー情報取得
  - `Team.ReadBasic.All` — 参加チーム一覧取得
  - `Channel.ReadBasic.All` — チャネル一覧取得
  - `Files.ReadWrite.All` — SharePoint ファイルの読み書き
  - `Sites.ReadWrite.All` — SharePoint サイトメタデータ操作
- **Azure サービス認証**: バックエンドから Content Understanding / Foundry Agent Service / Cosmos DB には `DefaultAzureCredential` (Managed Identity) を使用

### 2. Teams チャネル選択

- **概要**: ログイン後、ユーザーがアクセス権を持つ Teams チャネルのみをプルダウンで表示・選択
- **バックエンド処理**: 2 段階の Graph API 呼び出しが必要
  1. `GET /me/joinedTeams` — ユーザーが参加しているチーム一覧を取得
  2. `GET /teams/{teamId}/channels` — 各チームのチャネル一覧を取得
- **エンドポイント**: `GET /api/teams/channels` (バックエンドで上記を集約して返却)
- **出力**: チーム名 + チャネル名の階層リスト (teamId, channelId, サイト ID 含む)
- **UI**: プルダウンで「チーム名 > チャネル名」形式で表示

### 3. ファイル一覧表示

- **概要**: 選択した Teams チャネルの SharePoint サイトに共有されているファイル一覧を左ペインに表示
- **バックエンド処理**:
  1. `GET /teams/{teamId}/channels/{channelId}/filesFolder` — チャネルのファイルルート (DriveItem) を取得し `driveId` と `folderId` を得る
  2. `GET /drives/{driveId}/items/{folderId}/children` — フォルダ内のファイル一覧を取得
- **エンドポイント**: `GET /api/teams/{team_id}/channels/{channel_id}/files`
- **出力**: ファイル名、サイズ、更新日時、driveItemId 等

### 4. ファイルアップロード

- **概要**: 左ペインにファイルをドラッグ＆ドロップしてアップロード
- **エンドポイント**: `POST /api/teams/{team_id}/channels/{channel_id}/files`
- **対応形式**: PDF のみ（現時点）
- **SharePoint へのアップロード方法**:
  - 小ファイル (< 4MB): `PUT /drives/{driveId}/items/{folderId}:/{fileName}:/content`
  - 大ファイル (≥ 4MB): Upload Session API (`POST /drives/{driveId}/items/{folderId}:/{fileName}:/createUploadSession`)
- **独自ドキュメント識別子の付与**: SharePoint のカスタム列 (Site Column) を作成し、Graph API (`PATCH /drives/{driveId}/items/{itemId}/listItem/fields`) で値を設定
- **処理フロー**:
  1. UI に「ファイルを分析しています」と表示
  2. Teams チャネルの SharePoint サイトにファイルをアップロード
  3. アップロード結果から `driveItemId` を取得
  4. 独自ドキュメント識別子を生成し、SharePoint カスタム列に付与
  5. Content Understanding で分析実行 — **非同期 (Long-Running Operation)**: ポーリングで完了を待機 (後述)
  6. 分析結果を Cosmos DB に保存 (upsert)
  7. Foundry Agent で質問生成 (後述)
  8. 質問リストを Cosmos DB に保存
  9. フォローアップ質問ウィンドウを表示

- **同一ファイル判定**: SharePoint の Graph API ドライブアイテム ID (`driveItemId`) が同一であれば同一ドキュメントとして扱い、既存の Cosmos DB アイテムを更新 (upsert) する
- **再アップロード時のフォローアップ質問**: 既存の質問・回答は履歴 (`questionHistory`) として保持し、新たに生成された質問を `followUpQuestions` に追加する
- **エラーハンドリング**: 後述「エラーハンドリング」セクション参照

### 5. Content Understanding 分析

- **概要**: アップロードされた PDF を **Azure Content Understanding in Foundry Tools** の pre-built ドキュメントアナライザーで分析
- **サービス**: Azure Content Understanding (Azure AI Service) — SharePoint Content Understanding とは別サービス
- **前提リソース**: Microsoft Foundry リソース + モデルデプロイメント (gpt-4.1, text-embedding-3-large)
- **Python SDK**: `azure-ai-contentunderstanding` (GA v1.0.1, API version `2025-11-01`)
- **ベースアナライザー**: `prebuilt-document`
- **分析設定 (config)**:
  - `enableFigureAnalysis`: `true` (図表の構造化分析)
  - `enableFigureDescription`: `true` (図表の自然言語説明生成)
  - `enableOcr`: `true` (スキャン PDF 対応)
- **処理方式**: 非同期 Long-Running Operation — `begin_analyze` でリクエスト送信後、`result()` でポーリング完了待機
- **出力**: `AnalysisResult` (抽出テキスト markdown、図表情報、テーブル、キーバリューペア等)
- **保存先**: Cosmos DB (ドキュメント識別子と紐付け、upsert)

### 6. フォローアップ質問生成 (質問作成エージェント)

- **概要**: Foundry Agent Service の **New Foundry Agent** に登録された「質問作成エージェント」を呼び出し、フォローアップ質問を約 5 問生成
- **エージェント名**: `question-generator-agent`
- **エージェント種別**: Prompt Agent
- **Python SDK**: `azure-ai-projects` (v2.0.0+) — `AIProjectClient` でエージェントを名前で取得し、会話 API で呼び出し
- **呼び出しパターン**:
  ```python
  project_client = AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=credential)
  openai_client = project_client.get_openai_client()
  agent = project_client.agents.get_agent(name="question-generator-agent", version="latest")
  conversation = openai_client.conversations.create()
  # Content Understanding の分析結果テキストをユーザーメッセージとして送信
  openai_client.conversations.items.create(conversation_id=conv.id, items=[...])
  response = openai_client.responses.create(conversation=conv.id, extra_body={"agent": {"name": agent.name, "type": "agent_reference"}}, input="")
  ```
- **エージェント instructions**:
  ```
  You are a manufacturing domain expert specializing in extracting implicit knowledge
  from engineering documents. Your role is to analyze uploaded technical documents and
  generate approximately 5 follow-up questions that uncover undocumented expert knowledge.

  Focus your questions on the following perspectives:
  1. Unstated but critical assumptions and preconditions that experienced engineers
     would consider essential (e.g., environmental conditions, material properties,
     operational constraints).
  2. Logical gaps or potential contradictions in the document where the reasoning
     appears to skip steps or where conclusions don't fully follow from stated premises.
  3. Experience-based and lessons-learned insights that are typically known only through
     practice or past failures (e.g., common failure modes, maintenance pitfalls,
     manufacturing tolerances that differ from theoretical values).
  4. Easily overlooked points that could lead to quality issues, safety risks, or
     production inefficiencies if not addressed.

  Output format:
  Return a JSON array of question objects, each with:
  - "questionId": a unique identifier (e.g., "q-001")
  - "question": the question text in English
  - "perspective": which of the 4 categories above this question addresses

  Guidelines:
  - Ask specific, actionable questions rather than vague or general ones.
  - Reference specific sections, figures, or values from the document when possible.
  - Questions should require domain expertise to answer, not just reading the document.
  - Do NOT ask questions whose answers are explicitly stated in the document.
  ```
- **エンドポイント**: `POST /api/documents/{doc_id}/generate-questions`
- **再アップロード時の動作**: 既存の質問・回答は履歴 (`questionHistory`) として保持し、新たに生成された質問を `followUpQuestions` に追加する
- **保存先**: Cosmos DB (ドキュメント識別子と紐付け)
- **エラーハンドリング**: 後述「エラーハンドリング」セクション参照

### 7. フォローアップ質問応答 (質問回答分析エージェント)

- **概要**: フォローアップ質問ウィンドウで 1 問ずつ質問を表示し、ユーザーが応答
- **エージェント名**: `answer-analysis-agent`
- **エージェント種別**: Prompt Agent
- **判定**: Foundry Agent Service の **New Foundry Agent** に登録された「質問回答分析エージェント」が応答の十分性を判定
  - 不十分な場合: 補足情報を提示し再確認
  - 十分な場合: 次の質問へ進む
- **エージェント instructions**:
  ```
  You are a manufacturing quality assurance specialist responsible for evaluating
  answers to follow-up questions about engineering documents. Your role is to ensure
  that each answer provides sufficient detail and actionable information to complement
  the original document.

  For each question-answer pair, evaluate the response based on:
  1. Completeness: Does the answer fully address all aspects of the question?
  2. Specificity: Does the answer include concrete values, conditions, or references
     rather than vague generalizations?
  3. Actionability: Could another engineer use this answer to make informed decisions
     or take appropriate actions?
  4. Relevance: Does the answer directly relate to the question asked?

  Output format:
  Return a JSON object with:
  - "validation": "sufficient" or "insufficient"
  - "feedback": If insufficient, provide a specific, helpful message explaining what
    additional information is needed. Use a professional and encouraging tone.
    If sufficient, provide a brief acknowledgment.

  Guidelines:
  - Be fair but thorough. Accept answers that demonstrate practical knowledge even
    if not perfectly structured.
  - When requesting more detail, suggest specific types of information that would help
    (e.g., "Could you specify the exact tolerance range?" rather than "Please elaborate.").
  - Accept "not applicable" or "unknown" as valid answers only if the respondent explains
    why (e.g., "This was not tested because the component operates at room temperature only.").
  - Do NOT reject answers simply because they are brief if they contain sufficient substance.
  - After all questions are answered, output: {"complete": true, "message": "Thank you for
    providing these valuable insights. Your expertise will help ensure the quality and
    completeness of this document."}
  ```
- **完了時**: 全質問への応答完了後、お礼メッセージを表示してウィンドウを閉じる
- **保存先**: Cosmos DB (回答をドキュメント識別子と紐付けて登録)
- **保存タイミング**: 1 問回答ごとに Cosmos DB へ即時保存する (途中離脱時もそれまでの回答データを保持)
- **エラーハンドリング**: 後述「エラーハンドリング」セクション参照

### 8. ファイル詳細表示

- **概要**: 左ペインでファイルを選択すると右ペインに詳細情報を表示
- **エンドポイント**: `GET /api/documents/{doc_id}`
- **データ取得元**:
  - **ファイルメタデータ** (ファイル名、作成日、作成者、最終更新日、最終更新者): Graph API からリアルタイム取得 (変更される可能性があるため Cosmos DB には保存しない)
  - **ドキュメント識別子、分析結果、フォローアップ質問・回答**: Cosmos DB から取得
  - **連携キー**: Cosmos DB に保存された SharePoint ドライブアイテムのオブジェクトパス (`driveItemPath`) と `driveItemId` を用いて Graph API の情報と一意に紐付ける
- **表示項目**:
  - ファイル識別子 (Cosmos DB)
  - ファイル名 (Graph API)
  - 作成日 (Graph API)
  - 作成者名 (Graph API)
  - 最終更新日 (Graph API)
  - 最終更新者名 (Graph API)
  - フォローアップ質問一覧 - 質問、回答者、回答内容 (Cosmos DB)
  - 未実施の質問は「Not Available」と表示

---

## ファイルアップロード シーケンス

```
ユーザー                  フロントエンド              バックエンド (Flask)         SharePoint / Graph API      Content Understanding    Foundry Agent Service    Cosmos DB
  │                          │                          │                          │                          │                        │                        │
  │──ファイルD&D──────────────▶│                          │                          │                          │                        │                        │
  │                          │──POST /api/.../files──────▶│                          │                          │                        │                        │
  │                          │◀─「分析中」表示─────────────│                          │                          │                        │                        │
  │                          │                          │──ファイル登録──────────────▶│                          │                        │                        │
  │                          │                          │◀─ドキュメントID付与────────│                          │                        │                        │
  │                          │                          │──分析リクエスト────────────────────────────────────────▶│                        │                        │
  │                          │                          │◀─分析結果──────────────────────────────────────────────│                        │                        │
  │                          │                          │──分析結果保存 (upsert)──────────────────────────────────────────────────────────────────────────────────▶│
  │                          │                          │──質問生成リクエスト──────────────────────────────────────────────────────────────▶│                        │
  │                          │                          │◀─質問リスト (約5問)────────────────────────────────────────────────────────────│                        │
  │                          │                          │──質問リスト保存──────────────────────────────────────────────────────────────────────────────────────────▶│
  │                          │◀─質問ウィンドウ表示────────│                          │                          │                        │                        │
  │◀─Q1 表示─────────────────│                          │                          │                          │                        │                        │
  │──回答──────────────────▶│──回答送信──────────────────▶│                          │                          │                        │                        │
  │                          │                          │──回答分析リクエスト──────────────────────────────────────────────────────────────▶│                        │
  │                          │                          │◀─判定結果 (十分/不十分)───────────────────────────────────────────────────────│                        │
  │                          │                          │──回答を即時保存─────────────────────────────────────────────────────────────────────────────────────▶│
  │                          │  ... (Q2〜Q5 繰り返し: 各回答を都度保存) ...                                                                                             │
  │◀─お礼メッセージ──────────│                          │                          │                          │                        │                        │
  │                          │◀─完了──────────────────────│                          │                          │                        │                        │
```

---

## データモデル (Cosmos DB)

### コンテナ設計

RAG 情報としてそのまま利用でき、将来的にドキュメント間の関係をグラフ化できる設計とする。

**Cosmos DB コンテナ設定:**
- **コンテナ名**: `documents`
- **パーティションキー**: `/channelId`

```jsonc
// Container: documents
// Partition Key: /channelId

{
  // === 基本識別情報 ===
  "id": "doc-20260330-a1b2c3d4",           // ドキュメント識別子 (一意)
  "channelId": "teams-channel-id",          // Teams チャネル ID
  "siteId": "sharepoint-site-id",          // SharePoint サイト ID
  "driveItemId": "sharepoint-drive-item-id", // SharePoint ドライブアイテム ID (同一ファイル判定に使用)
  "driveItemPath": "/drives/{driveId}/items/{itemId}", // SharePoint オブジェクトパス (Graph API 連携キー)

  // === ファイルメタデータ (Graph API からリアルタイム取得するため CosmosDB には保存しない) ===
  // fileName, createdAt, createdBy, lastModifiedAt, lastModifiedBy は
  // driveItemId / driveItemPath を用いて Graph API から都度取得する

  // === Content Understanding 分析結果 (RAG 用) ===
  // 注意: Content Understanding は Azure AI Service (Foundry Tools) であり、
  //       SharePoint Content Understanding (M365 Syntex) とは別サービス
  "analysis": {
    "modelVersion": "prebuilt-v1",
    "analyzedAt": "2026-03-15T14:35:00Z",
    "extractedText": "... (抽出テキスト全文) ...",
    "figures": [
      {
        "figureId": "fig-001",
        "description": "Assembly diagram showing ...",
        "boundingBox": { "page": 1, "x": 0, "y": 0, "width": 100, "height": 80 }
      }
    ],
    "tables": [ ],
    "keyValuePairs": [ ]
  },

  // === フォローアップ質問・回答 ===
  "followUpQuestions": [
    {
      "questionId": "q-001",
      "question": "What temperature range was assumed for the material stress test?",
      "perspective": "unstated_assumptions",
      "generatedAt": "2026-03-15T14:40:00Z",
      "status": "answered",          // "pending" | "answered"
      "answeredBy": "john.smith@contoso.com",
      "answeredAt": "2026-03-15T15:00:00Z",
      "answer": "The assumed range is -40°C to 120°C based on ...",
      "agentValidation": "sufficient" // "sufficient" | "insufficient"
    },
    {
      "questionId": "q-002",
      "question": "Are there any known failure modes not documented?",
      "perspective": "lessons_learned",
      "generatedAt": "2026-03-15T14:40:00Z",
      "status": "pending",
      "answeredBy": null,
      "answeredAt": null,
      "answer": null,
      "agentValidation": null
    }
  ],

  // === フォローアップ質問履歴 (再アップロード時に既存の質問・回答を保持) ===
  "questionHistory": [
    {
      "generationRound": 1,
      "generatedAt": "2026-03-01T10:00:00Z",
      "questions": [
        {
          "questionId": "q-h-001",
          "question": "Previous version question...",
          "perspective": "unstated_assumptions",
          "status": "answered",
          "answeredBy": "john.smith@contoso.com",
          "answeredAt": "2026-03-01T10:30:00Z",
          "answer": "Previous answer...",
          "agentValidation": "sufficient"
        }
      ]
    }
  ],

  // === ドキュメント関係 (グラフ化対応) ===
  "relatedDocuments": [
    {
      "relatedDocumentId": "doc-20260215-x9y8z7w6",
      "relationship": "supersedes",   // "supersedes" | "references" | "derived_from" | "related_to" | etc.
      "description": "This document supersedes the previous design spec v1."
    }
  ],

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
| `POST` | `/api/teams/{team_id}/channels/{channel_id}/files` | ファイルアップロード (PDF のみ) |
| `GET` | `/api/documents/{doc_id}` | ドキュメント詳細取得 (Cosmos DB + Graph API) |
| `POST` | `/api/documents/{doc_id}/generate-questions` | フォローアップ質問生成 |
| `POST` | `/api/documents/{doc_id}/questions/{q_id}/answer` | 質問への回答送信・分析 |
| `GET` | `/api/me` | ログインユーザー情報取得 |

---

## 外部サービス連携

| サービス | 用途 | リソース要件 |
|---------|------|-------------|
| Microsoft Entra ID | 認証 (OAuth 2.0 PKCE + OBO) | アプリ登録 (SPA + Web API) |
| Microsoft Graph API | Teams チャネル取得、SharePoint ファイル操作、ユーザー情報取得 | — |
| Azure Content Understanding in Foundry Tools | PDF 分析 (pre-built `prebuilt-document`モデル) | Microsoft Foundry リソース + モデルデプロイメント |
| Microsoft Foundry Agent Service (New Foundry Agent) | 質問作成エージェント、質問回答分析エージェント | 同一 Foundry リソース内にエージェント登録 |
| Azure Cosmos DB for NoSQL | ドキュメント情報・分析結果・質問/回答の永続化 (RAG 対応) | NoSQL アカウント |
| Azure App Service | アプリホスティング (Flask + 静的ファイル) | Linux App Service Plan |

---

## 非機能要件

- **認証**: Microsoft Entra ID (フロントエンド: MSAL.js PKCE、バックエンド: MSAL Python OBO)
- **認可**: Graph API Delegated 権限スコープに基づくアクセス制御
- **対応ファイル形式**: PDF のみ (現時点)
- **パフォーマンス**: 同期 API レスポンス < 500ms。Content Understanding 分析・Foundry Agent 呼出しは非同期 Long-Running Operation
- **セキュリティ**: OWASP Top 10 準拠、CORS 設定、CSRF 対策
- **データ設計**: Cosmos DB をそのまま RAG 情報源として利用可能な形式で保存
- **将来拡張**: ドキュメント間関係のグラフ化に対応する `relatedDocuments` フィールドを設計済み
- **デプロイ構成**: Azure App Service (Linux) に Flask API + フロントエンド静的ファイルを同一デプロイ

## エラーハンドリング

すべての外部サービス呼び出しにはリトライを実装する。リトライ後もエラーが解消しない場合は、エラー詳細をユーザーに表示する。

### リトライポリシー

| 対象サービス | リトライ回数 | リトライ間隔 | 備考 |
|-------------|------------|------------|------|
| Microsoft Graph API | 最大 3 回 | 指数バックオフ (1s, 2s, 4s) | 429 (Rate Limit) / 503 / 504 はリトライ、401 は再認証 |
| Content Understanding | 最大 3 回 | 指数バックオフ (2s, 4s, 8s) | LRO ポーリング中の一時エラーもリトライ |
| Foundry Agent Service | 最大 3 回 | 指数バックオフ (1s, 2s, 4s) | タイムアウトは 60 秒 |
| Cosmos DB | 最大 3 回 | 指数バックオフ (1s, 2s, 4s) | 429 (Request Rate Too Large) はリトライ |

### エラー表示

- **処理中エラー**: ファイルアップロード中にエラーが発生した場合、モーダルに「Analysis failed: {エラー詳細}」と赤字で表示し、「Retry」ボタンを提供する
- **質問生成エラー**: 質問生成が失敗した場合、「Question generation failed: {エラー詳細}. The file has been uploaded successfully. You can retry question generation later.」と表示
- **質問応答エラー**: 回答分析中にエラーが発生した場合、「Answer analysis temporarily unavailable: {エラー詳細}. Your answer has been saved. Please try again.」と表示し、回答自体は Cosmos DB に保存済みであることを保証する
- **ネットワークエラー**: フロントエンドで通信エラーを検知した場合、トースト通知で「Connection error. Please check your network and try again.」と表示

### 部分的完了の扱い

ファイルアップロードの処理フローの各ステップで障害が発生した場合、それまでに完了したステップの結果は保持する:

| 障害発生ステップ | 保持される結果 | ユーザーへの通知 |
|----------------|--------------|----------------|
| SharePoint アップロード失敗 | なし | ファイルアップロードの再試行を促す |
| Content Understanding 分析失敗 | SharePoint 上のファイル | 「ファイルは保存済み。分析のリトライ」ボタン表示 |
| 質問生成失敗 | SharePoint ファイル + 分析結果 (Cosmos DB) | 「分析完了。質問生成のリトライ」ボタン表示 |
| 質問応答中のエージェント障害 | 上記 + 保存済み回答 | 「回答保存済み。分析サービス一時停止中」と表示 |

## コーディング規約

- フロントエンド: JavaScript (ES Modules)
- バックエンド: Python 3.12+ / Flask
- リンター: Flake8 (Python), ESLint (JavaScript)
- フォーマッター: Black (Python), Prettier (JavaScript)
- テスト: pytest (Python)
- コミットメッセージ: Conventional Commits

---

## Azure リソース要件

| リソース | 設定要件 |
|---------|---------|
| Microsoft Entra ID | アプリ登録 2 件 (SPA / Web API)、リダイレクト URI 設定 |
| Microsoft Foundry リソース | Content Understanding 対応リージョンに作成 |
| Foundry モデルデプロイメント | `gpt-4.1` (completion)、`text-embedding-3-large` (embedding) |
| Foundry Agent Service | 質問作成エージェント・質問回答分析エージェントを Prompt Agent として登録 |
| Azure Cosmos DB for NoSQL | `documents` コンテナ作成 |
| Azure App Service | Linux App Service Plan (Python 3.12+) |

---

## 補足仕様

### 認証・セッション

- **トークンリフレッシュ**: MSAL.js v2 の `acquireTokenSilent` で自動サイレントリフレッシュ。失敗時は `acquireTokenPopup` で再認証を促す
- **同時ログイン**: 制限なし。MSAL.js のトークンキャッシュ (`sessionStorage`) によりタブ単位で独立動作

### UI/UX 補足

- **モーダルの中断/再開**: ユーザーがフォローアップ質問モーダルを途中で閉じた場合、未回答の質問は `pending` のまま Cosmos DB に保持される。右ペインのファイル詳細に「Resume Questions」ボタンを表示し、中断した質問から再開できる
- **ファイル一覧のソート**: デフォルトは最終更新日の降順。ファイル名ソートの切り替えボタンを提供。ページネーションは不要 (Graph API の `$top` + `$skipToken` で無限スクロール)
- **質問履歴の表示**: 右ペインには最新の `followUpQuestions` のみ表示。`questionHistory` は「View History」リンクで展開可能なアコーディオン UI で表示
- **並行アップロード**: 不可。アップロード処理中はドラッグ＆ドロップエリアを無効化し、「Processing...」オーバーレイを表示。ファイル選択・詳細表示は可能
- **PDF 以外のファイル拒否**: フロントエンドで `.pdf` 拡張子をチェックし、非対応ファイルはドロップ時に「Only PDF files are supported.」とトースト表示して即座にリジェクト
- **ファイル削除時の動作**: SharePoint 上でファイルが削除された場合、Cosmos DB のデータはそのまま保持 (オーファンデータ)。ファイル詳細表示時に Graph API から 404 が返った場合、右ペインに「File not found in SharePoint. Metadata shown from last known state.」と表示
- **レスポンシブ対応**: v1 ではデスクトップブラウザのみ対応 (1024px 以上)。モバイル対応は将来スコープ

### API/バックエンド補足

- **ドキュメント識別子の生成ルール**: `doc-{YYYYMMDD}-{UUID4先頭8桁}` 形式。例: `doc-20260330-a1b2c3d4`
- **Content Understanding への入力方法**: バックエンドが SharePoint から Graph API (`GET /drives/{driveId}/items/{itemId}/content`) で PDF バイナリをダウンロードし、Content Understanding SDK の `begin_analyze` にバイナリで渡す
- **ファイルサイズ上限**: アプリ側で **50MB** を上限とする。Content Understanding のサービス上限 (500MB) より小さく制限し、応答性を確保
- **API レスポンス形式**: 全エンドポイントで統一 JSON エンベロープを使用
  ```json
  // 成功時
  { "status": "success", "data": { ... } }
  // エラー時
  { "status": "error", "error": { "code": "ANALYSIS_FAILED", "message": "...", "details": "..." } }
  ```
  HTTP ステータスコード: 200 (成功), 400 (バリデーションエラー), 401 (未認証), 404 (未検出), 413 (ファイルサイズ超過), 500 (サーバーエラー), 502/503 (外部サービス障害)
- **Cosmos DB RU/スループット**: Autoscale (400–4000 RU/s) で開始。パーティションキー `/channelId` はチャネルあたり数十～数百ドキュメントを想定

### セキュリティ補足

- **CORS**: Flask が静的ファイルも配信する同一オリジン構成のため CORS は不要。ローカル開発時は `flask-cors` で `localhost` のみ許可
- **監査ログ**: ファイルアップロード、質問生成、回答送信の各操作を Python `logging` で記録 (userId, docId, action, timestamp)。App Service の診断ログで収集。v1 では専用の監査 UI は設けない

### デプロイ構成

- **デプロイ方式**: Azure App Service (Linux) に Flask アプリをデプロイ。Flask が `/static/` パスでフロントエンド (HTML/CSS/JS) を配信するシンプル構成
- **SharePoint カスタム列**: アプリがチャネル初回アクセス時に Graph API (`POST /sites/{siteId}/columns`) でカスタム列 `MidmDocumentId` の存在を確認し、存在しなければ自動作成
