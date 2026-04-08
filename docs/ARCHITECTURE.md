# Architecture Overview — Manufacturing Intelligent Document Management

> 本ドキュメントは、システム全体のアーキテクチャ、各コンポーネントの役割、およびAIエージェントの動作フローを詳細に説明する。

---

## 1. システム全体アーキテクチャ

```mermaid
graph TB
    subgraph "Client (Browser)"
        FE_AUTH["auth.js<br/>MSAL.js v2.35.0<br/>Authorization Code Flow + PKCE"]
        FE_APP["app.js<br/>アプリケーション制御"]
        FE_API["api.js<br/>API クライアント"]
        FE_UI["ui.js<br/>UI レンダリング<br/>(タブ UI + ペインリサイズ)"]
        FE_I18N["i18n.js<br/>多言語対応 (EN/JP)"]
        FE_CONFIG["config.js<br/>MSAL / API 設定"]
    end

    subgraph "Azure App Service (Python 3.10 / Flask)"
        BE_APP["app.py<br/>Flask アプリケーション"]
        subgraph "Routes"
            AUTH_ROUTE["auth_routes.py<br/>GET /api/me"]
            TEAMS_ROUTE["teams_routes.py<br/>GET /api/teams/channels<br/>GET /api/teams/.../files<br/>POST /api/teams/.../files"]
            DOC_ROUTE["document_routes.py<br/>GET /api/documents/{id}<br/>POST .../generate-questions<br/>POST .../answer"]
            REL_ROUTE["relationship_routes.py<br/>GET /api/documents/{id}/relationships"]
        end
        subgraph "Services"
            AUTH_SVC["auth_service.py<br/>MSAL OBO + リトライ"]
            GRAPH_SVC["graph_service.py<br/>Microsoft Graph API"]
            COSMOS_SVC["cosmos_service.py<br/>Cosmos DB CRUD"]
            CU_SVC["content_understanding_service.py<br/>ドキュメント分析"]
            AGENT_SVC["agent_service.py<br/>Foundry Agent 呼び出し"]
            REL_SVC["relationship_service.py<br/>関係抽出 (逐次キュー)"]
        end
    end

    subgraph "Azure Services"
        ENTRA["Microsoft Entra ID"]
        GRAPH["Microsoft Graph API"]
        SP["SharePoint Online<br/>(Teams Channel Files)"]
        COSMOS["Azure Cosmos DB<br/>(Serverless / NoSQL)"]
        FOUNDRY["Azure AI Foundry<br/>(AIServices)"]
        CU["Content Understanding<br/>(prebuilt-document /<br/>prebuilt-documentSearch)"]
        AGENT_Q["質問生成エージェント<br/>(question-generator-agent)"]
        AGENT_A["回答分析エージェント<br/>(answer-analysis-agent)"]
        AGENT_C["文書分類エージェント<br/>(doc-classifier-agent)"]
        AGENT_R["関係分析エージェント<br/>(relationship-analyzer-agent)"]
        GPT["gpt-4.1-mini<br/>Model Deployment"]
    end

    FE_AUTH -->|"1. PKCE ログイン"| ENTRA
    ENTRA -->|"2. Access Token"| FE_AUTH
    FE_API -->|"3. Bearer Token"| BE_APP

    BE_APP --> AUTH_ROUTE
    BE_APP --> TEAMS_ROUTE
    BE_APP --> DOC_ROUTE
    BE_APP --> REL_ROUTE

    AUTH_ROUTE --> AUTH_SVC
    TEAMS_ROUTE --> AUTH_SVC
    DOC_ROUTE --> AUTH_SVC
    REL_ROUTE --> AUTH_SVC

    AUTH_SVC -->|"OBO フロー"| ENTRA
    AUTH_SVC -->|"Graph Token"| GRAPH_SVC

    GRAPH_SVC -->|"Delegated 権限"| GRAPH
    GRAPH -->|"ファイル操作"| SP

    DOC_ROUTE --> CU_SVC
    DOC_ROUTE --> AGENT_SVC
    DOC_ROUTE --> COSMOS_SVC
    REL_ROUTE --> COSMOS_SVC
    REL_ROUTE --> GRAPH_SVC
    TEAMS_ROUTE --> GRAPH_SVC
    TEAMS_ROUTE --> CU_SVC
    TEAMS_ROUTE --> AGENT_SVC
    TEAMS_ROUTE --> COSMOS_SVC
    TEAMS_ROUTE --> REL_SVC

    REL_SVC --> AGENT_SVC
    REL_SVC --> COSMOS_SVC

    CU_SVC -->|"DefaultAzureCredential"| CU
    AGENT_SVC -->|"DefaultAzureCredential"| FOUNDRY
    COSMOS_SVC -->|"DefaultAzureCredential"| COSMOS

    FOUNDRY --> AGENT_Q
    FOUNDRY --> AGENT_A
    FOUNDRY --> AGENT_C
    FOUNDRY --> AGENT_R
    AGENT_Q --> GPT
    AGENT_A --> GPT
    AGENT_C --> GPT
    AGENT_R --> GPT
    CU --> GPT
```

---

## 2. 認証フロー

```mermaid
sequenceDiagram
    actor User as ユーザー
    participant Browser as ブラウザ (MSAL.js)
    participant Entra as Microsoft Entra ID
    participant Flask as Flask バックエンド
    participant MSAL as MSAL Python (OBO)
    participant Graph as Microsoft Graph API

    User->>Browser: アプリにアクセス
    Browser->>Entra: loginPopup() — Authorization Code Flow + PKCE
    Entra-->>Browser: Access Token (scope: api://{client-id}/access_as_user)
    Browser->>Flask: API リクエスト (Authorization: Bearer {token})
    Flask->>Flask: @require_auth デコレータ — トークン抽出
    Flask->>MSAL: acquire_token_on_behalf_of(user_assertion)
    MSAL->>Entra: OBO トークン交換
    Entra-->>MSAL: Graph API Access Token
    MSAL-->>Flask: Graph Token を g.graph_token に保存
    Flask->>Graph: Graph API 呼び出し (Bearer {graph_token})
    Graph-->>Flask: レスポンス
    Flask-->>Browser: JSON レスポンス
```

### 認証の二層構造

| レイヤー | 方式 | 用途 |
|---------|------|------|
| フロントエンド → バックエンド | MSAL.js (PKCE) | ユーザー認証、API アクセストークン取得 |
| バックエンド → Graph API | MSAL Python (OBO) | ユーザー委任権限での Graph API 呼び出し |
| バックエンド → Azure Services | DefaultAzureCredential (Managed Identity) | Cosmos DB, Content Understanding, Foundry Agent |

---

## 3. Teams チャネル選択フロー

```mermaid
sequenceDiagram
    actor User as ユーザー
    participant Browser as ブラウザ
    participant Flask as Flask API
    participant Graph as Graph API

    User->>Browser: ログイン完了
    Browser->>Flask: GET /api/teams/channels
    Flask->>Graph: GET /me/joinedTeams
    Graph-->>Flask: チーム一覧
    loop 各チーム
        Flask->>Graph: GET /teams/{teamId}/channels
        Graph-->>Flask: チャネル一覧
    end
    Flask-->>Browser: [{teamId, teamName, channelId, channelName}, ...]
    Browser->>Browser: プルダウンに「チーム名 > チャネル名」形式で表示
    User->>Browser: チャネル選択
    Browser->>Flask: GET /api/teams/{teamId}/channels/{channelId}/files
    Flask->>Graph: GET /teams/{teamId}/channels/{channelId}/filesFolder
    Graph-->>Flask: DriveItem (driveId, folderId)
    Flask->>Graph: GET /drives/{driveId}/items/{folderId}/children
    Graph-->>Flask: ファイル一覧
    Flask->>Flask: 各ファイルの driveItemId で Cosmos DB を検索 (docId 取得)
    Flask-->>Browser: ファイル一覧 (docId 付き)
    Browser->>Browser: 左ペインにファイル一覧を表示
```

---

## 4. ファイルアップロード — 全体処理フロー

```mermaid
flowchart TD
    START([ユーザーが PDF をドラッグ&ドロップ]) --> VALIDATE{PDF か?}
    VALIDATE -->|No| REJECT[エラー: PDF のみ対応]
    VALIDATE -->|Yes| FOLDER[1. チャネルの filesFolder 取得<br/>Graph API]
    FOLDER --> SIZE{ファイルサイズ}
    SIZE -->|< 4MB| SMALL[2a. PUT .../content<br/>小ファイルアップロード]
    SIZE -->|≥ 4MB| LARGE[2b. Upload Session API<br/>大ファイルアップロード]
    SMALL --> DOCID
    LARGE --> DOCID
    DOCID[3. ドキュメント識別子生成<br/>doc-YYYYMMDD-UUID8桁]
    DOCID --> EXISTING{既存ドキュメント?}
    EXISTING -->|Yes| HISTORY[既存質問を questionHistory に移動]
    EXISTING -->|No| CUSTOM
    HISTORY --> CUSTOM[4. SharePoint カスタム列に DocIdentifier 設定]
    CUSTOM --> SAVE_INIT[5. Cosmos DB に初期ドキュメント保存<br/>processingStatus: analyzing]
    SAVE_INIT --> RETURN_201[HTTP 201 を即座に返却<br/>docId + processingStatus]
    RETURN_201 --> POLL[フロントエンド: 5秒間隔でポーリング<br/>GET /api/documents/docId]

    SAVE_INIT --> BG_START[バックグラウンドスレッド開始]
    BG_START --> ANALYZE[6. Content Understanding で分析<br/>prebuilt-documentSearch]
    ANALYZE --> ANALYZE_OK{分析成功?}
    ANALYZE_OK -->|No| BG_ERR1[processingStatus: error<br/>processingError に詳細記録]
    ANALYZE_OK -->|Yes| SAVE_ANALYSIS[7. 分析結果を Cosmos DB に保存<br/>processingStatus: generating_questions]
    SAVE_ANALYSIS --> GEN_Q[8. question-generator-agent で質問生成]
    GEN_Q --> GEN_OK{質問生成成功?}
    GEN_OK -->|No| BG_ERR2[processingStatus: completed<br/>processingError に詳細記録]
    GEN_OK -->|Yes| SAVE_Q[9. 質問を Cosmos DB に保存<br/>processingStatus: completed]
    SAVE_Q --> REL_QUEUE[10. 関係抽出をキューに投入<br/>relationshipStatus: queued]

    POLL -->|completed| MODAL([フォローアップ質問モーダル表示])
    POLL -->|error| TOAST[エラートースト表示]
    MODAL -->|全質問完了| AUTO_SELECT[アップロードファイルを自動選択<br/>右ペインに詳細表示]

    REL_QUEUE -.->|ワーカースレッド| REL_PROCESS[11. 文書分類 + 関係推定<br/>relationship-analyzer-agent]
    REL_PROCESS --> REL_SAVE[12. 関係を双方向保存<br/>relationshipStatus: completed]

    style REJECT fill:#ffcccc
    style BG_ERR1 fill:#ffcccc
    style BG_ERR2 fill:#fff3cd
    style SAVE_Q fill:#ccffcc
    style RETURN_201 fill:#ccffcc
```

---

## 5. Content Understanding 分析フロー

```mermaid
sequenceDiagram
    participant Route as teams_routes.py
    participant CU_SVC as content_understanding_service.py
    participant CU as Azure Content Understanding
    participant Model as prebuilt-document /<br/>prebuilt-documentSearch

    Route->>CU_SVC: analyze_document(file_content, deep_analysis)
    CU_SVC->>CU_SVC: DefaultAzureCredential で認証
    CU_SVC->>CU_SVC: analyzer_id = deep_analysis ?<br/>"prebuilt-documentSearch" : "prebuilt-document"
    CU_SVC->>CU: begin_analyze(analyzer_id,<br/>input=AnalysisInput(data, mime_type="application/pdf"))
    Note over CU: 非同期 LRO (Long Running Operation)
    CU->>Model: PDF 解析実行
    Model-->>CU: AnalysisResult
    CU-->>CU_SVC: poller.result()
    CU_SVC->>CU_SVC: result.contents[0].markdown → extractedText
    CU_SVC->>CU_SVC: figures (説明埋め込み済み), tables, keyValuePairs 抽出
    CU_SVC-->>Route: analysis dict
    Note over CU_SVC: リトライ: 最大3回, 指数バックオフ (2s, 4s, 8s)
```

### Content Understanding 出力構造

```json
{
  "modelVersion": "prebuilt-documentSearch-v1",
  "analyzedAt": "2026-03-15T14:35:00Z",
  "extractedText": "... (Markdown 形式テキスト、図の説明埋め込み) ...",
  "figures": [{"figureId": "fig-001", "description": "...", "boundingBox": {"page": 3}}],
  "tables": [{"rowCount": 5, "columnCount": 3}],
  "keyValuePairs": [{"key": "Part Number", "value": "ABC-123"}]
}
```

---

## 6. AI エージェント詳細アーキテクチャ

### 6.1 エージェント構成概要

```mermaid
graph LR
    subgraph "Azure AI Foundry Project"
        subgraph "Prompt Agent 1"
            QG["question-generator-agent"]
            QG_INST["Instructions:<br/>製造業ドメイン専門家として<br/>4つの視点から約5問の質問生成"]
        end
        subgraph "Prompt Agent 2"
            AA["answer-analysis-agent"]
            AA_INST["Instructions:<br/>品質保証専門家として<br/>回答の十分性を判定"]
        end
        subgraph "Prompt Agent 3"
            DC["doc-classifier-agent"]
            DC_INST["Instructions:<br/>文書を6段階に分類し<br/>メタデータを抽出"]
        end
        subgraph "Prompt Agent 4"
            RA["relationship-analyzer-agent"]
            RA_INST["Instructions:<br/>文書間の関係を<br/>3種類で判定"]
        end
        MODEL["gpt-4.1-mini<br/>(デプロイメント名: gpt-41-mini)"]
    end

    QG --> MODEL
    AA --> MODEL
    DC --> MODEL
    RA --> MODEL
    QG_INST -.-> QG
    AA_INST -.-> AA
    DC_INST -.-> DC
    RA_INST -.-> RA
```

### 6.2 question-generator-agent (質問生成エージェント)

```mermaid
sequenceDiagram
    participant Route as teams_routes.py / document_routes.py
    participant Agent_SVC as agent_service.py
    participant Client as AIProjectClient
    participant OpenAI as OpenAI Conversations API
    participant Agent as question-generator-agent
    participant GPT as gpt-4.1-mini

    Route->>Agent_SVC: generate_questions(extracted_text, figures)
    Agent_SVC->>Agent_SVC: 図 ID をページ番号に置換<br/>(fig-001 → "(page 3)")
    Agent_SVC->>Client: AIProjectClient(endpoint, credential)
    Agent_SVC->>Client: get_openai_client()
    Client-->>Agent_SVC: openai_client
    Agent_SVC->>Client: agents.get(agent_name="question-generator-agent")
    Client-->>Agent_SVC: agent 定義
    Agent_SVC->>OpenAI: conversations.create()
    OpenAI-->>Agent_SVC: conversation (id)
    Agent_SVC->>OpenAI: responses.create(<br/>  conversation=conversation.id,<br/>  input=extracted_text,<br/>  agent_reference={name, type}<br/>)
    OpenAI->>Agent: Instructions + extracted_text
    Agent->>GPT: プロンプト実行
    GPT-->>Agent: JSON 質問配列
    Agent-->>OpenAI: response
    OpenAI-->>Agent_SVC: response.output_text
    Agent_SVC->>Agent_SVC: JSON パース (コードフェンス除去)
    Agent_SVC-->>Route: [{"questionId", "question", "perspective"}, ...]
    Note over Agent_SVC: リトライ: 最大3回, 指数バックオフ (1s, 2s, 4s)
```

#### 質問生成の4つの視点

| 視点 | キー | 説明 |
|------|------|------|
| 前提条件 | `unstated_assumptions` | 経験豊富なエンジニアが不可欠と考える暗黙の前提 (環境条件、材料特性、運用制約) |
| 論理ギャップ | `logical_gaps` | 推論の飛躍や結論が前提から完全に導かれていない部分 |
| 経験知 | `experience_knowledge` | 実践や過去の失敗からのみ得られる知見 (故障モード、保守の落とし穴) |
| 見落としリスク | `overlooked_risks` | 品質問題、安全リスク、生産非効率を引き起こす可能性のある見落とし |

#### 出力形式

```json
[
  {
    "questionId": "q-001",
    "question": "What temperature range was assumed for this component?",
    "perspective": "unstated_assumptions"
  },
  {
    "questionId": "q-002",
    "question": "What common failure modes have been observed in similar designs?",
    "perspective": "experience_knowledge"
  }
]
```

### 6.3 answer-analysis-agent (回答分析エージェント)

```mermaid
sequenceDiagram
    participant Route as document_routes.py
    participant Agent_SVC as agent_service.py
    participant Client as AIProjectClient
    participant OpenAI as OpenAI Responses API
    participant Agent as answer-analysis-agent
    participant GPT as gpt-4.1-mini

    Route->>Agent_SVC: analyze_answer(question, answer)
    Agent_SVC->>Client: AIProjectClient(endpoint, credential)
    Agent_SVC->>Client: get_openai_client()
    Agent_SVC->>Client: agents.get(agent_name="answer-analysis-agent")
    Agent_SVC->>OpenAI: responses.create(<br/>  input=json.dumps({question, answer}),<br/>  agent_reference={name, type}<br/>)
    OpenAI->>Agent: Instructions + {question, answer}
    Agent->>GPT: プロンプト実行
    GPT-->>Agent: JSON 判定結果
    Agent-->>OpenAI: response
    OpenAI-->>Agent_SVC: response.output_text
    Agent_SVC->>Agent_SVC: JSON パース
    Agent_SVC-->>Route: {"validation": "sufficient|insufficient", "feedback": "..."}
    Note over Agent_SVC: リトライ: 最大3回, 指数バックオフ (1s, 2s, 4s)
```

#### 判定ポリシー (寛容なアプローチ)

```mermaid
flowchart TD
    INPUT[回答を受信] --> CHECK1{実用的な知見が<br/>含まれているか?}
    CHECK1 -->|Yes| SUFFICIENT[✅ sufficient]
    CHECK1 -->|No| CHECK2{「N/A」「不明」<br/>等の回答か?}
    CHECK2 -->|Yes| SUFFICIENT
    CHECK2 -->|No| CHECK3{質問に<br/>関連しているか?}
    CHECK3 -->|No| INSUFFICIENT["⚠️ insufficient<br/>+ 補足要求フィードバック"]
    CHECK3 -->|Yes| CHECK4{文脈が十分か?}
    CHECK4 -->|Yes| SUFFICIENT
    CHECK4 -->|No| DOUBT{判断に迷う?}
    DOUBT -->|Yes| SUFFICIENT
    DOUBT -->|No| INSUFFICIENT

    style SUFFICIENT fill:#ccffcc
    style INSUFFICIENT fill:#fff3cd
```

---

## 7. フォローアップ質問応答フロー (チャットスレッド)

```mermaid
sequenceDiagram
    actor User as ユーザー
    participant Browser as ブラウザ (モーダル)
    participant Flask as Flask API
    participant Agent as answer-analysis-agent
    participant Cosmos as Cosmos DB

    Note over Browser: アップロード完了 → モーダル表示
    Note over Browser: Question 1 of N を表示

    loop 各質問 (最大 N 問)
        Browser->>Browser: AI 質問をチャットバブルで表示
        
        alt ユーザーが回答
            User->>Browser: 回答テキスト入力 (Enter で送信)
            Browser->>Flask: POST /api/documents/{docId}/questions/{qId}/answer
            Flask->>Cosmos: ドキュメント取得
            Flask->>Flask: conversationThread にユーザーメッセージ追加
            Flask->>Cosmos: 中間保存

            alt ユーザーメッセージ数 ≥ 3 (最大深堀り到達)
                Flask-->>Browser: {validation: "sufficient", feedback: "Thank you..."}
                Browser->>Browser: 確認メッセージ表示 → 1.5秒後に次の質問
            else ユーザーメッセージ数 < 3
                Flask->>Agent: analyze_answer(question, answer)
                Agent-->>Flask: {validation, feedback}
                Flask->>Flask: conversationThread に AI フィードバック追加
                Flask->>Cosmos: 保存

                alt validation = "sufficient"
                    Flask-->>Browser: {validation: "sufficient", feedback}
                    Browser->>Browser: 確認メッセージ → 1.5秒後に次の質問
                else validation = "insufficient"
                    Flask-->>Browser: {validation: "insufficient", feedback}
                    Browser->>Browser: 黄色警告バブル表示、再入力可能
                    Note over Browser: roundCount < MAX_ROUNDS(3) なら再入力<br/>≥ MAX_ROUNDS なら強制的に次の質問へ
                end
            end
        else ユーザーがスキップ
            User->>Browser: 「Skip」ボタン押下
            Browser->>Browser: status="pending" のまま次の質問へ
        end
    end

    Browser->>Browser: 完了メッセージ表示 → モーダル閉じ
```

### 深堀り制限の二重チェック

```mermaid
flowchart TD
    ANSWER[ユーザー回答受信] --> SAVE[conversationThread に保存]
    SAVE --> COUNT{ユーザーメッセージ数 ≥ 3?}
    COUNT -->|Yes| FORCE_ACCEPT["強制 sufficient<br/>(バックエンド制限)"]
    COUNT -->|No| AGENT[answer-analysis-agent 呼び出し]
    AGENT --> RESULT{validation}
    RESULT -->|sufficient| NEXT[次の質問へ]
    RESULT -->|insufficient| ROUND{フロントエンド<br/>roundCount ≥ MAX_ROUNDS?}
    ROUND -->|Yes| FORCE_NEXT["強制的に次の質問へ<br/>(フロントエンド制限)"]
    ROUND -->|No| RETRY[黄色警告表示<br/>再入力可能]
    FORCE_ACCEPT --> NEXT
    FORCE_NEXT --> NEXT

    style FORCE_ACCEPT fill:#e6f3ff
    style FORCE_NEXT fill:#e6f3ff
```

---

## 8. データフロー (Cosmos DB)

```mermaid
flowchart LR
    subgraph "書き込みフロー"
        UPLOAD["ファイルアップロード<br/>POST .../files"] -->|"upsert"| DOC["documents コンテナ<br/>PK: /channelId"]
        ANALYZE["Content Understanding<br/>分析完了"] -->|"upsert (analysis)"| DOC
        GEN["質問生成<br/>agent"] -->|"upsert (followUpQuestions)"| DOC
        ANS["回答送信<br/>POST .../answer"] -->|"upsert (conversationThread)"| DOC
        REGEN["質問再生成<br/>POST .../generate-questions"] -->|"upsert (questionHistory 移動)"| DOC
    end

    subgraph "読み取りフロー"
        DOC -->|"read_item(id, channelId)"| GET_DOC["ドキュメント詳細取得"]
        DOC -->|"query(driveItemId)"| FIND["driveItemId で検索"]
        DOC -->|"query(channelId)"| LIST["チャネル内ドキュメント一覧"]
    end
```

### Cosmos DB ドキュメントのライフサイクル

```mermaid
stateDiagram-v2
    [*] --> Uploaded: SharePoint アップロード成功
    Uploaded --> Analyzing: processingStatus: analyzing<br/>バックグラウンドスレッド開始
    Analyzing --> GeneratingQuestions: processingStatus: generating_questions<br/>CU 分析完了
    Analyzing --> Error: processingStatus: error<br/>CU 分析失敗
    GeneratingQuestions --> Completed: processingStatus: completed<br/>質問生成成功
    GeneratingQuestions --> CompletedWithError: processingStatus: completed<br/>質問生成失敗 (processingError あり)
    Completed --> Answering: ユーザーが回答開始
    Answering --> Answered: 全質問回答完了/スキップ
    Answered --> Analyzing: 再アップロード/再生成<br/>(既存質問は questionHistory へ)
    Error --> Analyzing: 再分析
    CompletedWithError --> Completed: 再生成
```

---

## 9. エージェント作成・デプロイフロー

```mermaid
sequenceDiagram
    participant Dev as 開発者
    participant AZD as azd up
    participant Bicep as Bicep (IaC)
    participant Azure as Azure リソース
    participant Hook as postprovision hook
    participant Script as create_agents.py

    Dev->>AZD: azd up
    AZD->>Bicep: main.bicep デプロイ
    Bicep->>Azure: Resource Group 作成
    Bicep->>Azure: Cosmos DB (Serverless) 作成
    Bicep->>Azure: AI Foundry (AIServices) 作成
    Bicep->>Azure: Foundry Project 作成
    Bicep->>Azure: gpt-4.1-mini デプロイメント作成
    Bicep->>Azure: text-embedding-3-large デプロイメント作成
    Bicep->>Azure: App Service Plan + App Service 作成
    Bicep->>Azure: RBAC ロール割り当て (Cosmos DB, AI Foundry)
    AZD->>Hook: postprovision フック実行
    Hook->>Hook: 1. src/frontend → src/backend/static コピー
    Hook->>Hook: 2. config.js に Entra ID 値注入
    Hook->>Hook: 3. ZIP デプロイ (az webapp deployment)
    Hook->>Azure: 4. Cosmos DB データベース/コンテナ作成 (ARM)
    Hook->>Azure: 5. Content Understanding デフォルト設定 (PATCH)
    Hook->>Script: 6. python scripts/create_agents.py
    Script->>Azure: agents.create_version("question-generator-agent", ...)
    Script->>Azure: agents.create_version("answer-analysis-agent", ...)
    Script->>Azure: agents.create_version("doc-classifier-agent", ...)
    Script->>Azure: agents.create_version("relationship-analyzer-agent", ...)
    Script-->>Hook: エージェント作成完了
    Hook-->>AZD: デプロイ完了
```

---

## 10. API エンドポイント — リクエスト/レスポンスフロー

```mermaid
flowchart LR
    subgraph "認証 API"
        ME["GET /api/me"]
    end

    subgraph "Teams API"
        CH["GET /api/teams/channels"]
        FILES["GET /api/teams/{tid}/channels/{cid}/files"]
        UPLOAD["POST /api/teams/{tid}/channels/{cid}/files"]
    end

    subgraph "Document API"
        DOC["GET /api/documents/{docId}"]
        GENQ["POST /api/documents/{docId}/generate-questions"]
        ANSQ["POST /api/documents/{docId}/questions/{qId}/answer"]
    end

    subgraph "外部サービス"
        GRAPH["Graph API"]
        COSMOS["Cosmos DB"]
        CU["Content Understanding"]
        AGENT["Foundry Agent"]
    end

    ME -->|"OBO → Graph"| GRAPH
    CH -->|"joinedTeams → channels"| GRAPH
    FILES -->|"filesFolder → children"| GRAPH
    FILES -->|"driveItemId 検索"| COSMOS
    UPLOAD -->|"PUT/Upload Session<br/>+ processingStatus: analyzing"| GRAPH
    UPLOAD -->|"upsert(初期ドキュメント)"| COSMOS
    Note over UPLOAD: HTTP 201 即座返却
    UPLOAD -.->|"バックグラウンドスレッド"| CU
    UPLOAD -.->|"バックグラウンドスレッド"| AGENT
    DOC -->|"get_drive_item"| GRAPH
    DOC -->|"get_document"| COSMOS
    GENQ -->|"generate_questions"| AGENT
    GENQ -->|"upsert_document"| COSMOS
    ANSQ -->|"analyze_answer"| AGENT
    ANSQ -->|"upsert_document"| COSMOS

    REL["GET /api/documents/{docId}/relationships"]
    REL -->|"関係情報取得"| COSMOS
    REL -->|"ファイル名/URL補完"| GRAPH
```

---

## 11. エラーハンドリングとリトライ

```mermaid
flowchart TD
    REQUEST[API リクエスト] --> EXEC[関数実行]
    EXEC --> SUCCESS{成功?}
    SUCCESS -->|Yes| RETURN[結果返却]
    SUCCESS -->|No| CHECK{リトライ可能?<br/>429 / 503 / 504}
    CHECK -->|No| RAISE[例外送出]
    CHECK -->|Yes| ATTEMPT{試行回数 < max_retries?}
    ATTEMPT -->|No| RAISE
    ATTEMPT -->|Yes| WAIT["待機<br/>base_delay × 2^attempt"]
    WAIT --> EXEC

    subgraph "リトライ設定"
        R1["Graph API: 3回, 1s-2s-4s"]
        R2["Content Understanding: 3回, 2s-4s-8s"]
        R3["Foundry Agent: 3回, 1s-2s-4s"]
        R4["Cosmos DB: 3回, 1s-2s-4s"]
    end
```

### 部分的完了 — 非同期処理の段階的保存

```mermaid
flowchart TD
    STEP1["Step 1: SharePoint アップロード"] --> S1_OK{成功?}
    S1_OK -->|No| ERR500["HTTP 500<br/>保存結果: なし"]
    S1_OK -->|Yes| STEP2["Step 2: Cosmos DB 初期保存<br/>processingStatus: analyzing"]
    STEP2 --> RETURN["HTTP 201 即座返却"]
    RETURN --> BG["バックグラウンドスレッド開始"]
    BG --> STEP3["Step 3: Content Understanding 分析"]
    STEP3 --> S3_OK{成功?}
    S3_OK -->|No| ERR_PROC1["processingStatus: error<br/>保存: SP ファイル + 初期ドキュメント"]
    S3_OK -->|Yes| STEP4["Step 4: 質問生成 (Agent)"]
    STEP4 --> S4_OK{成功?}
    S4_OK -->|No| ERR_PROC2["processingStatus: completed<br/>processingError あり<br/>保存: ファイル + 分析結果"]
    S4_OK -->|Yes| STEP5["Step 5: 質問保存<br/>processingStatus: completed"]

    style ERR500 fill:#ffcccc
    style ERR_PROC1 fill:#ffcccc
    style ERR_PROC2 fill:#fff3cd
    style STEP5 fill:#ccffcc
```

---

## 12. インフラストラクチャ構成

```mermaid
graph TB
    subgraph "Azure Subscription"
        RG["Resource Group<br/>rg-{environmentName}"]

        subgraph "Compute"
            ASP["App Service Plan<br/>Linux / B1 SKU"]
            APP["App Service<br/>Python 3.10<br/>SystemAssigned Identity"]
        end

        subgraph "Data"
            COSMOS["Cosmos DB<br/>Serverless / NoSQL<br/>disableLocalAuth: true"]
            DB["Database: manufacturing-docs"]
            CONT["Container: documents<br/>PK: /channelId"]
        end

        subgraph "AI"
            AI_SVC["AI Foundry (AIServices)<br/>disableLocalAuth: true"]
            PROJECT["Foundry Project<br/>SystemAssigned Identity"]
            GPT_DEP["gpt-4.1-mini<br/>GlobalStandard / capacity 10"]
            EMB_DEP["text-embedding-3-large<br/>GlobalStandard / capacity 10"]
        end

        subgraph "Security & Identity"
            MI_APP["App Service<br/>Managed Identity"]
            MI_PROJ["Foundry Project<br/>Managed Identity"]
            RBAC_COSMOS["Cosmos DB RBAC<br/>Data Contributor +<br/>DocumentDB Account Contributor"]
            RBAC_AI["AI Foundry RBAC<br/>Cognitive Services User"]
        end
    end

    subgraph "External"
        ENTRA["Microsoft Entra ID"]
        GRAPH["Microsoft Graph API"]
        SP["SharePoint Online"]
    end

    ASP --> APP
    COSMOS --> DB --> CONT
    AI_SVC --> PROJECT
    PROJECT --> GPT_DEP
    PROJECT --> EMB_DEP
    MI_APP --> RBAC_COSMOS --> COSMOS
    MI_APP --> RBAC_AI --> AI_SVC
    APP --> ENTRA
    APP --> GRAPH --> SP

    style COSMOS fill:#e6f3ff
    style AI_SVC fill:#e6f3ff
    style APP fill:#e6f3ff
```

---

## 13. フロントエンド — コンポーネント構成

```mermaid
graph TD
    subgraph "index.html"
        LOGIN["ログイン画面<br/>#login-screen"]
        MAIN["メインアプリ<br/>#main-app"]
        HEADER["ヘッダー<br/>ロゴ | チャネル選択 | Deep Analysis トグル | EN/JP | ユーザー名"]
        LEFT["左ペイン: ファイル一覧<br/>#file-list + #drop-zone"]
        RIGHT["右ペイン: ファイル詳細<br/>#file-details"]
        MODAL["モーダル: フォローアップ質問<br/>#question-modal"]
        ANALYSIS_MODAL["モーダル: 分析結果表示<br/>#analysis-modal<br/>Markdown レンダリング (marked.js + DOMPurify)"]
        TOAST["トースト通知<br/>#toast-container"]
    end

    subgraph "JavaScript Modules"
        APP_JS["app.js — アプリ制御<br/>イベントハンドラ<br/>質問フロー制御<br/>アップロードポーリング"]
        AUTH_JS["auth.js — 認証<br/>MSAL.js 初期化<br/>トークン取得"]
        API_JS["api.js — API クライアント<br/>全エンドポイント呼び出し"]
        UI_JS["ui.js — UI 描画<br/>DOM 操作<br/>チャットUI<br/>分析結果モーダル"]
        CONFIG_JS["config.js — 設定<br/>MSAL Config<br/>API Base URL"]
        I18N_JS["i18n.js — 国際化<br/>EN/JP 切り替え"]
    end

    LOGIN -->|"ログイン成功"| MAIN
    MAIN --> HEADER
    MAIN --> LEFT
    MAIN --> RIGHT
    MAIN --> MODAL
    APP_JS --> AUTH_JS
    APP_JS --> API_JS
    APP_JS --> UI_JS
    AUTH_JS --> CONFIG_JS
    API_JS --> CONFIG_JS
```

---

## 14. エンドツーエンド — ユーザー操作の完全フロー

```mermaid
flowchart TD
    A([ユーザーがアプリにアクセス]) --> B[MSAL.js でログイン<br/>Entra ID 認証]
    B --> C[GET /api/me でユーザー情報取得]
    C --> D[GET /api/teams/channels で<br/>チーム・チャネル一覧取得]
    D --> E[ユーザーがチャネル選択]
    E --> F[GET /api/teams/.../files で<br/>ファイル一覧取得]
    F --> G{ユーザーの操作}

    G -->|ファイル選択| H[GET /api/documents/{docId}<br/>詳細表示]
    H --> I[Graph API からメタデータ取得<br/>+ Cosmos DB から質問・回答取得]
    I --> J[右ペインに詳細表示<br/>会話スレッド全文表示]

    G -->|PDF ドロップ| K[POST /api/teams/.../files]
    K --> L[SharePoint アップロード]
    L --> L2[HTTP 201 即座返却<br/>processingStatus: analyzing]
    L2 --> L3[フロントエンド: 5秒間隔ポーリング]
    L3 -.-> M[バックグラウンド:<br/>Content Understanding 分析]
    M -.-> N[バックグラウンド:<br/>question-generator-agent<br/>約 5 問の質問生成]
    L3 -->|processingStatus: completed| O[フォローアップモーダル表示]
    O --> P{ユーザーの選択}

    P -->|回答入力| Q[POST /api/documents/.../answer]
    Q --> R[answer-analysis-agent<br/>回答分析]
    R --> S{判定結果}
    S -->|sufficient| T[次の質問へ]
    S -->|insufficient<br/>deep-dive < 3| U[補足要求表示<br/>再入力可能]
    U --> P
    S -->|insufficient<br/>deep-dive ≥ 3| T

    P -->|スキップ| T
    T --> V{全質問完了?}
    V -->|No| O
    V -->|Yes| W[完了メッセージ → モーダル閉じ]
    W --> F
```
