# DOCS_MCP_SPEC — ドキュメント検索MCPサーバー実現仕様

## 1. 概要

本仕様では、以下の2つの機能を実現する。

1. **ベクトル化パイプライン**: ファイルアップロード後のフォローアップ質問完了時に、ドキュメント分析結果データおよびフォローアップ質問と回答データをベクトル化し、CosmosDB に保存する
2. **MCP サーバー**: CosmosDB に保存されたベクトルデータを検索するリモート MCP サーバーを、Azure Functions の MCP トリガー（Flex Consumption プラン）で構築する

---

## 2. アーキテクチャ

```
┌──────────────────────────────────────────────────────────────────────┐
│                         既存バックエンド (Flask)                       │
│                                                                      │
│  フォローアップ質問完了                                                │
│       │                                                              │
│       ▼                                                              │
│  [ベクトル化パイプライン]                                              │
│       │  Azure OpenAI Embeddings API                                 │
│       │  (text-embedding-3-small, 1536次元)                          │
│       ▼                                                              │
│  CosmosDB "documents" コンテナ                                        │
│   ├─ 既存フィールド (analysis, followUpQuestions, relationships 等)    │
│   ├─ contentVector: float32[1536]  ← NEW                             │
│   └─ qaVector: float32[1536]       ← NEW                            │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│              MCP サーバー (Azure Functions - Flex Consumption)         │
│                                                                      │
│  ┌─────────────────────┐  ┌─────────────────────┐                    │
│  │ search_documents    │  │ get_document_detail  │                    │
│  │ (ベクトル検索ツール) │  │ (詳細取得ツール)      │                    │
│  └─────────┬───────────┘  └─────────┬───────────┘                    │
│            │                         │                                │
│  ┌─────────────────────┐            │                                │
│  │ get_related_docs    │            │                                │
│  │ (関連文書取得ツール) │            │                                │
│  └─────────┬───────────┘            │                                │
│            │                         │                                │
│            ▼                         ▼                                │
│       CosmosDB (Managed ID 接続)                                      │
│       Azure OpenAI Embeddings (クエリベクトル化)                       │
└──────────────────────────────────────────────────────────────────────┘

MCP クライアント (GitHub Copilot, VS Code 等)
       │
       │ Streamable HTTP: /runtime/webhooks/mcp
       ▼
  Azure Functions MCP エンドポイント
```

---

## 3. ベクトル化パイプライン

### 3.1 トリガー条件

フォローアップ質問の完了を以下のいずれかの条件で判定する:

- **全質問が `sufficient` 判定を受けた場合** — `followUpQuestions` 内のすべての `agentValidation` が `"sufficient"` になった時点
- **最大深掘りラウンド (3回) に到達した場合** — 各質問の `conversationThread` 内の `role: "user"` メッセージが 3 件に到達した時点

既存の `answer_question` エンドポイント (`document_routes.py`) 内で、回答保存・バリデーション後にベクトル化完了条件をチェックし、条件を満たした場合にベクトル化処理をトリガーする。

#### 回答更新時の再ベクトル化

`PUT /api/documents/{doc_id}/questions/{q_id}/answer` エンドポイントで既存の回答が更新された場合、即座にベクトルデータ (`contentVector`, `qaVector`) の再生成を実行する。これにより、回答の修正やスキップ済み質問への追加回答が MCP サーバー経由のベクトル検索結果にリアルタイムで反映される。

### 3.2 ベクトル化対象データ

ベクトル化は2つのベクトルフィールドを生成する:

#### 3.2.1 `contentVector` — ドキュメント内容ベクトル

入力テキスト構成:

```
[Document Classification]
Title: {documentClassification.title}
Stage: {documentClassification.stage}
Summary: {documentClassification.summary}
Subsystem: {documentClassification.subsystem}
Module: {documentClassification.moduleName}
Product Family: {documentClassification.productFamily}
Document Number: {documentClassification.documentNumber}

[Extracted Content]
{analysis.extractedText}
```

#### 3.2.2 `qaVector` — フォローアップ質問・回答ベクトル

入力テキスト構成:

```
[Follow-up Questions and Answers]
Q1 ({followUpQuestions[0].perspective}): {followUpQuestions[0].question}
A1: {followUpQuestions[0].answer}

Q2 ({followUpQuestions[1].perspective}): {followUpQuestions[1].question}
A2: {followUpQuestions[1].answer}

...
```

各質問の最終回答 (`answer` フィールド) を使用する。`conversationThread` の全やり取りではなく、最終回答のみをベクトル化対象とする（トークン制限対策）。

### 3.3 Embedding モデル

| 項目 | 値 |
|---|---|
| モデル | `text-embedding-3-small` |
| 次元数 | 1536 |
| プロバイダー | Azure OpenAI (Azure AI Foundry 経由) |
| 認証 | Managed Identity (`DefaultAzureCredential`) |

### 3.4 実装: `embedding_service.py`

新規サービスファイル `src/backend/services/embedding_service.py` を作成する。

```python
import logging
from openai import AzureOpenAI
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from config import Config

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536


def get_embedding(text: str) -> list[float]:
    """Generate embedding vector for the given text using Azure OpenAI."""
    token_provider = get_bearer_token_provider(
        DefaultAzureCredential(),
        "https://cognitiveservices.azure.com/.default",
    )
    client = AzureOpenAI(
        azure_endpoint=Config.AZURE_OPENAI_ENDPOINT,
        azure_ad_token_provider=token_provider,
        api_version="2024-06-01",
    )

    # Truncate to ~8000 tokens worth of text (approx 32000 chars)
    truncated = text[:32000]

    response = client.embeddings.create(
        input=truncated,
        model=EMBEDDING_MODEL,
        dimensions=EMBEDDING_DIMENSIONS,
    )
    return response.data[0].embedding


def build_content_text(doc: dict) -> str:
    """Build text for content vector from document analysis and classification."""
    parts = []
    classification = doc.get("documentClassification", {})
    if classification:
        parts.append("[Document Classification]")
        parts.append(f"Title: {classification.get('title', '')}")
        parts.append(f"Stage: {classification.get('stage', '')}")
        parts.append(f"Summary: {classification.get('summary', '')}")
        parts.append(f"Subsystem: {classification.get('subsystem', '')}")
        parts.append(f"Module: {classification.get('moduleName', '')}")
        parts.append(f"Product Family: {classification.get('productFamily', '')}")
        parts.append(f"Document Number: {classification.get('documentNumber', '')}")
        parts.append("")

    analysis = doc.get("analysis", {})
    if analysis:
        parts.append("[Extracted Content]")
        parts.append(analysis.get("extractedText", ""))

    return "\n".join(parts)


def build_qa_text(doc: dict) -> str:
    """Build text for Q&A vector from follow-up questions and answers."""
    parts = ["[Follow-up Questions and Answers]"]
    questions = doc.get("followUpQuestions", [])
    for i, q in enumerate(questions, 1):
        perspective = q.get("perspective", "")
        question = q.get("question", "")
        answer = q.get("answer", "")
        parts.append(f"Q{i} ({perspective}): {question}")
        parts.append(f"A{i}: {answer}")
        parts.append("")
    return "\n".join(parts)


def vectorize_document(doc: dict) -> dict:
    """Generate both content and Q&A vectors for a document.
    Returns the updated document with vector fields."""
    content_text = build_content_text(doc)
    qa_text = build_qa_text(doc)

    doc["contentVector"] = get_embedding(content_text)
    doc["qaVector"] = get_embedding(qa_text)

    return doc
```

### 3.5 Config 追加

`src/backend/config.py` に以下を追加:

```python
AZURE_OPENAI_ENDPOINT = os.environ.get("AZURE_OPENAI_ENDPOINT", "")
```

### 3.6 `document_routes.py` への組み込み

`answer_question` エンドポイント内で、回答保存後にベクトル化完了条件をチェックする:

```python
from services.embedding_service import vectorize_document

# --- 既存の回答保存・バリデーション処理の後 ---

# Check if all questions are completed (vectorization trigger)
all_completed = all(
    q.get("agentValidation") == "sufficient"
    or len([m for m in q.get("conversationThread", []) if m.get("role") == "user"]) >= 3
    for q in doc.get("followUpQuestions", [])
)

if all_completed and not doc.get("contentVector"):
    try:
        doc = vectorize_document(doc)
        doc["vectorizedAt"] = datetime.now(timezone.utc).isoformat()
        cosmos.upsert_document(doc)
        logger.info("Document %s vectorized successfully", doc_id)
    except Exception as e:
        logger.error("Vectorization failed for %s: %s", doc_id, e)
        # ベクトル化失敗は回答処理自体をブロックしない
```

### 3.7 CosmosDB コンテナ変更

#### 3.7.1 ベクトル検索機能の有効化

CosmosDB アカウントで `EnableNoSQLVectorSearch` ケイパビリティを有効化する必要がある:

```bash
az cosmosdb update \
    --resource-group <RESOURCE_GROUP> \
    --name <COSMOS_ACCOUNT_NAME> \
    --capabilities EnableNoSQLVectorSearch
```

#### 3.7.2 `documents` コンテナのベクトルインデックス

CosmosDB NoSQL のベクトルインデックスはコンテナ作成時にのみ設定可能なため、`documents` コンテナ自体をベクトルインデックス付きで `postdeploy` フック（`scripts/create_vector_container.py`）により ARM REST API 経由で作成する。Bicep ではデータベースのみを定義し、コンテナは作成しない。

> **注意**: `EnableNoSQLVectorSearch` ケイパビリティの伝播に最大15分かかるため、スクリプトは自動リトライする。

**コンテナ構成:**

| 項目 | 値 |
|---|---|
| コンテナ名 | `documents` |
| パーティションキー | `/channelId` |
| ベクトルポリシー | `contentVector` (cosine, float32, 1536次元), `qaVector` (cosine, float32, 1536次元) |
| ベクトルインデックス | `quantizedFlat` (初期は1000件未満のため。データ増加後は `diskANN` へ移行検討) |

**ベクトルポリシー定義:**

```json
{
    "vectorEmbeddings": [
        {
            "path": "/contentVector",
            "dataType": "float32",
            "distanceFunction": "cosine",
            "dimensions": 1536
        },
        {
            "path": "/qaVector",
            "dataType": "float32",
            "distanceFunction": "cosine",
            "dimensions": 1536
        }
    ]
}
```

**インデックスポリシー:**

```json
{
    "indexingMode": "consistent",
    "automatic": true,
    "includedPaths": [
        { "path": "/*" }
    ],
    "excludedPaths": [
        { "path": "/\"_etag\"/?" },
        { "path": "/contentVector/*" },
        { "path": "/qaVector/*" }
    ],
    "vectorIndexes": [
        { "path": "/contentVector", "type": "quantizedFlat" },
        { "path": "/qaVector", "type": "quantizedFlat" }
    ]
}
```

**格納ドキュメント形式:**

```json
{
    "id": "<document-id>",
    "channelId": "<channel-id>",
    "fileName": "<file-name>",
    "contentVector": [0.012, -0.034, ...],
    "qaVector": [0.056, -0.078, ...],
    "vectorizedAt": "2026-04-08T12:00:00Z"
}
```

#### 3.7.3 コンテナ作成 (`scripts/create_vector_container.py`)

Bicep ではデータベースのみを定義し、`documents` コンテナは `postdeploy` フックで ARM REST API 経由で作成する:

```bash
# postdeploy フックで自動実行される
python scripts/create_vector_container.py
```

スクリプトはコンテナの存在を確認し、未作成の場合はベクトルインデックス付きで作成する。`EnableNoSQLVectorSearch` の伝播待ちを含む自動リトライ機能あり。

### 3.8 ベクトルデータ書き込みフロー

ベクトル化完了時に、`documents` コンテナのドキュメントに `contentVector`、`qaVector`、`vectorizedAt` フィールドを追加して更新する。MCP サーバーの `search_documents` ツールは同じコンテナに対して `VectorDistance()` クエリを実行する。

ベクトル化は以下の2箇所でトリガーされる:
1. `answer_question` エンドポイント — 全質問の回答完了時（`_try_vectorize`）
2. `complete-questions` エンドポイント — 質問フロー終了時（スキップ含む）

---

## 4. MCP サーバー (Azure Functions)

### 4.1 プロジェクト構成

```
src/
  mcp-server/
    function_app.py          # MCP ツール定義
    host.json                # Functions ホスト設定 + MCP 設定
    requirements.txt         # Python 依存パッケージ
    local.settings.json      # ローカル開発用設定 (git ignore)
```

### 4.2 host.json

```json
{
    "version": "2.0",
    "logging": {
        "applicationInsights": {
            "samplingSettings": {
                "isEnabled": true,
                "excludedTypes": "Request"
            }
        }
    },
    "extensionBundle": {
        "id": "Microsoft.Azure.Functions.ExtensionBundle",
        "version": "[4.*, 5.0.0)"
    },
    "extensions": {
        "mcp": {
            "serverName": "manufacturing-docs-mcp",
            "serverVersion": "1.0.0",
            "instructions": "Manufacturing document management MCP server. Provides tools to search documents by semantic similarity, retrieve document details and follow-up Q&A, and explore document relationships (upstream/downstream dependencies)."
        }
    }
}
```

### 4.3 requirements.txt

```
azure-functions>=2.0.0
azure-cosmos>=4.7.0
azure-identity>=1.17.0
openai>=1.35.0
```

### 4.4 function_app.py — MCP ツール実装

```python
import json
import logging
import os

import azure.functions as func
from azure.cosmos import CosmosClient
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI

app = func.FunctionApp()

# ─── Configuration ────────────────────────────────────────────────
COSMOS_ENDPOINT = os.environ["COSMOS_DB_ENDPOINT"]
COSMOS_DATABASE = os.environ.get("COSMOS_DB_DATABASE", "manufacturing-docs")
COSMOS_CONTAINER = os.environ.get("COSMOS_DB_CONTAINER", "documents")
AZURE_OPENAI_ENDPOINT = os.environ["AZURE_OPENAI_ENDPOINT"]
CHANNEL_ID = unquote(os.environ["CHANNEL_ID"])
EMBEDDING_MODEL = "text-embedding-3-large"
EMBEDDING_DIMENSIONS = 1536

logger = logging.getLogger(__name__)

# ─── Shared Clients (lazy init) ──────────────────────────────────
_cosmos_client = None
_container = None


def _get_container():
    """Lazy-init Cosmos DB client using Managed Identity."""
    global _cosmos_client, _container
    if _container is None:
        credential = DefaultAzureCredential()
        _cosmos_client = CosmosClient(COSMOS_ENDPOINT, credential=credential)
        db = _cosmos_client.get_database_client(COSMOS_DATABASE)
        _container = db.get_container_client(COSMOS_CONTAINER)
    return _container


def _get_query_embedding(query: str) -> list[float]:
    """Generate embedding for a search query."""
    token_provider = get_bearer_token_provider(
        DefaultAzureCredential(),
        "https://cognitiveservices.azure.com/.default",
    )
    client = AzureOpenAI(
        azure_endpoint=AZURE_OPENAI_ENDPOINT,
        azure_ad_token_provider=token_provider,
        api_version="2024-06-01",
    )
    response = client.embeddings.create(
        input=query[:8000],
        model=EMBEDDING_MODEL,
        dimensions=EMBEDDING_DIMENSIONS,
    )
    return response.data[0].embedding


# ─── Tool 1: search_documents ────────────────────────────────────
@app.mcp_tool()
@app.mcp_tool_property(
    arg_name="query",
    property_type="string",
    description="Search query text to find relevant documents by semantic similarity.",
    is_required=True,
)
@app.mcp_tool_property(
    arg_name="top_n",
    property_type="integer",
    description="Number of results to return (default: 10, max: 50).",
)
def search_documents(query: str, top_n: int = 10) -> str:
    """Search documents by semantic similarity. Returns a list of matching
    document file names and IDs ranked by relevance. The search covers both
    document content and follow-up Q&A data."""
    container = _get_container()
    query_vector = _get_query_embedding(query)
    top_n = min(max(top_n or 10, 1), 50)

    sql = """
    SELECT TOP @topN
        c.id,
        c.channelId,
        c.fileName,
        VectorDistance(c.contentVector, @queryVector) AS contentScore,
        VectorDistance(c.qaVector, @queryVector) AS qaScore
    FROM c
    WHERE c.channelId = @channelId
    ORDER BY VectorDistance(c.contentVector, @queryVector)
    """
    params = [
        {"name": "@topN", "value": top_n},
        {"name": "@queryVector", "value": query_vector},
        {"name": "@channelId", "value": CHANNEL_ID},
    ]

    items = list(container.query_items(
        query=sql,
        parameters=params,
        partition_key=CHANNEL_ID,
    ))

    results = []
    for item in items:
        results.append({
            "documentId": item["id"],
            "channelId": item["channelId"],
            "fileName": item.get("fileName", ""),
            "contentSimilarity": item.get("contentScore"),
            "qaSimilarity": item.get("qaScore"),
        })

    return json.dumps({"results": results, "count": len(results)}, ensure_ascii=False)


# ─── Tool 2: get_document_detail ─────────────────────────────────
@app.mcp_tool()
@app.mcp_tool_property(
    arg_name="document_id",
    property_type="string",
    description="The ID of the document to retrieve.",
    is_required=True,
)
def get_document_detail(document_id: str) -> str:
    """Retrieve full document content including analysis results and
    follow-up questions with answers for a specific document ID."""
    container = _get_container()

    try:
        doc = container.read_item(item=document_id, partition_key=CHANNEL_ID)
    except Exception:
        return json.dumps({"error": "Document not found"}, ensure_ascii=False)

    analysis = doc.get("analysis", {})
    classification = doc.get("documentClassification", {})
    follow_up = doc.get("followUpQuestions", [])

    qa_list = []
    for q in follow_up:
        qa_list.append({
            "questionId": q.get("questionId", ""),
            "question": q.get("question", ""),
            "perspective": q.get("perspective", ""),
            "answer": q.get("answer", ""),
            "validation": q.get("agentValidation", ""),
            "conversationThread": q.get("conversationThread", []),
        })

    result = {
        "documentId": doc["id"],
        "channelId": doc.get("channelId", ""),
        "fileName": doc.get("fileName", ""),
        "classification": {
            "stage": classification.get("stage", ""),
            "title": classification.get("title", ""),
            "summary": classification.get("summary", ""),
            "documentNumber": classification.get("documentNumber", ""),
            "subsystem": classification.get("subsystem", ""),
            "moduleName": classification.get("moduleName", ""),
            "productFamily": classification.get("productFamily", ""),
        },
        "analysis": {
            "extractedText": analysis.get("extractedText", ""),
            "figures": analysis.get("figures", []),
            "tables": analysis.get("tables", []),
            "keyValuePairs": analysis.get("keyValuePairs", []),
        },
        "followUpQA": qa_list,
    }

    return json.dumps(result, ensure_ascii=False)


# ─── Tool 3: get_related_documents ───────────────────────────────
@app.mcp_tool()
@app.mcp_tool_property(
    arg_name="document_id",
    property_type="string",
    description="The ID of the document to find related documents for.",
    is_required=True,
)
def get_related_documents(document_id: str) -> str:
    """Retrieve upstream and downstream related documents for the specified
    document ID. Returns dependency and reference relationships with
    file names and document IDs."""
    container = _get_container()

    try:
        doc = container.read_item(item=document_id, partition_key=CHANNEL_ID)
    except Exception:
        return json.dumps({"error": "Document not found"}, ensure_ascii=False)

    relationships = doc.get("relationships", [])

    upstream = []
    downstream = []
    for rel in relationships:
        target_id = rel.get("targetDocId", "")
        rel_type = rel.get("relationshipType", "")
        confidence = rel.get("confidence", "")
        reason = rel.get("reason", "")

        # Resolve target document's fileName
        target_file_name = ""
        try:
            target_doc = docs_container.read_item(
                item=target_id, partition_key=CHANNEL_ID
            )
            target_file_name = target_doc.get("fileName", "")
        except Exception:
            pass

        entry = {
            "documentId": target_id,
            "fileName": target_file_name,
            "relationshipType": rel_type,
            "confidence": confidence,
            "reason": reason,
        }

        if rel_type in ("depends_on", "refers_to"):
            upstream.append(entry)
        elif rel_type in ("depended_by", "referred_by"):
            downstream.append(entry)
        else:
            downstream.append(entry)

    result = {
        "documentId": doc["id"],
        "fileName": doc.get("fileName", ""),
        "channelId": doc.get("channelId", ""),
        "upstream": upstream,
        "downstream": downstream,
    }

    return json.dumps(result, ensure_ascii=False)
```

### 4.5 MCP ツール仕様

#### Tool 1: `search_documents`

| 項目 | 内容 |
|---|---|
| 名前 | `search_documents` |
| 説明 | クエリテキストによるドキュメントのベクトル検索。ドキュメント内容とフォローアップ質問・回答の両方を検索対象とする。検索対象チャネルは環境変数 `CHANNEL_ID` で指定 |
| 入力パラメータ | `query` (string, **必須**): 検索クエリテキスト |
| | `top_n` (integer, 任意): 返却件数 (デフォルト: 10, 最大: 50) |
| 出力 | `{ results: [{ documentId, channelId, fileName, contentSimilarity, qaSimilarity }], count }` |

#### Tool 2: `get_document_detail`

| 項目 | 内容 |
|---|---|
| 名前 | `get_document_detail` |
| 説明 | 指定ドキュメントIDの分析結果（抽出テキスト、図表、KVペア）とフォローアップ質問・回答の詳細を返却。チャネルは環境変数 `CHANNEL_ID` で指定 |
| 入力パラメータ | `document_id` (string, **必須**): ドキュメントID |
| 出力 | `{ documentId, fileName, classification, analysis, followUpQA }` |

#### Tool 3: `get_related_documents`

| 項目 | 内容 |
|---|---|
| 名前 | `get_related_documents` |
| 説明 | 指定ドキュメントIDの依存・参照関係にある上流/下流ドキュメントのリストを返却。チャネルは環境変数 `CHANNEL_ID` で指定 |
| 入力パラメータ | `document_id` (string, **必須**): ドキュメントID |
| 出力 | `{ documentId, fileName, upstream: [{ documentId, fileName, relationshipType, confidence, reason }], downstream: [...] }` |

**関係タイプ:**

| relationshipType | 方向 | 説明 |
|---|---|---|
| `depends_on` | 上流 | 当該ドキュメントが依存する上流ドキュメント |
| `refers_to` | 上流 | 当該ドキュメントが参照する文書 |
| `depended_by` | 下流 | 当該ドキュメントに依存する下流ドキュメント |
| `referred_by` | 下流 | 当該ドキュメントを参照する文書 |

---

## 5. インフラストラクチャ (Azure リソース)

### 5.1 Azure Functions (Flex Consumption)

#### 5.1.1 リソース構成

| 項目 | 値 |
|---|---|
| プラン | Flex Consumption |
| ランタイム | Python 3.11 |
| インスタンスメモリ | 2048 MB (デフォルト) |
| OS | Linux (Flex Consumption は Linux のみ) |

#### 5.1.2 Managed Identity 接続要件

Flex Consumption プランでは、以下の接続をすべて Managed Identity で行う:

**a) Functions ホストストレージ (AzureWebJobsStorage)**

`AzureWebJobsStorage` にはキー文字列ではなく Managed Identity 接続を使用する。`AzureWebJobsStorage__accountName` アプリ設定で接続する:

```
AzureWebJobsStorage__accountName = <STORAGE_ACCOUNT_NAME>
```

必要なロール:
- `Storage Blob Data Owner` — デプロイメントパッケージの読み書き
- `Storage Queue Data Contributor` — MCP 拡張機能の SSE トランスポート用
- `Storage Queue Data Message Processor` — MCP 拡張機能の SSE トランスポート用
- `Storage Table Data Contributor` — Functions ランタイム内部管理用

**b) デプロイメントストレージ**

Flex Consumption のデプロイメントパッケージは Blob Storage コンテナに保存される。Managed Identity 認証にする場合:

```bash
az functionapp create \
    --resource-group <RG> \
    --name <APP_NAME> \
    --storage <STORAGE_NAME> \
    --runtime python \
    --runtime-version 3.11 \
    --flexconsumption-location <REGION> \
    --deployment-storage-auth-type SystemAssignedIdentity
```

必要なロール:
- `Storage Blob Data Contributor` — デプロイメントストレージへの読み書き

**c) CosmosDB 接続**

環境変数 `COSMOS_DB_ENDPOINT` のみを設定し、キーは使用しない。`DefaultAzureCredential` で接続する。

必要なロール:
- `Cosmos DB Built-in Data Reader` — MCP サーバーは読み取り専用

**d) Azure OpenAI 接続**

`DefaultAzureCredential` から `get_bearer_token_provider` でトークンを取得する。

必要なロール:
- `Cognitive Services OpenAI User` — Embeddings API 呼び出し

### 5.2 Bicep: Azure Functions リソース定義

`infra/modules/mcp-function.bicep` を新規作成する:

```bicep
@description('Name of the Function App')
param name string

@description('Location for the Function App')
param location string

@description('Tags for the resource')
param tags object = {}

@description('Storage account name for AzureWebJobsStorage')
param storageAccountName string

@description('Cosmos DB endpoint')
param cosmosDbEndpoint string

@description('Azure OpenAI endpoint')
param azureOpenAiEndpoint string

@description('Application Insights connection string')
param appInsightsConnectionString string

@description('Teams channel ID for document search scope')
param channelId string

// Storage Account reference
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

// Flex Consumption Plan
resource flexPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: '${name}-plan'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    tier: 'FlexConsumption'
    name: 'FC1'
  }
  properties: {
    reserved: true
  }
}

// Function App
resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: name
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: flexPlan.id
    siteConfig: {
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storageAccountName }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
        { name: 'COSMOS_DB_ENDPOINT', value: cosmosDbEndpoint }
        { name: 'AZURE_OPENAI_ENDPOINT', value: azureOpenAiEndpoint }
        { name: 'CHANNEL_ID', value: channelId }
      ]
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storageAccount.properties.primaryEndpoints.blob}deployments'
          authentication: {
            type: 'SystemAssignedIdentity'
          }
        }
      }
      scaleAndConcurrency: {
        instanceMemoryMB: 2048
        maximumInstanceCount: 100
      }
      runtime: {
        name: 'python'
        version: '3.11'
      }
    }
  }
}

// ─── Role Assignments ────────────────────────────────────────────

// Storage Blob Data Owner for AzureWebJobsStorage + deployment
resource storageBlobDataOwner 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storageAccount
  name: guid(storageAccount.id, functionApp.id, 'StorageBlobDataOwner')
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
    )
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Storage Queue Data Contributor (MCP SSE transport)
resource storageQueueContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storageAccount
  name: guid(storageAccount.id, functionApp.id, 'StorageQueueDataContributor')
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
    )
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Storage Queue Data Message Processor (MCP SSE transport)
resource storageQueueProcessor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storageAccount
  name: guid(storageAccount.id, functionApp.id, 'StorageQueueDataMessageProcessor')
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '8a0f0c08-91a1-4084-bc3d-661d67233fed'
    )
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output functionAppName string = functionApp.name
output functionAppId string = functionApp.id
output principalId string = functionApp.identity.principalId
output defaultHostName string = functionApp.properties.defaultHostName
```

### 5.3 Flex Consumption デプロイ時の注意事項

Flex Consumption プランには以下のデプロイ上の制限がある:

| 制約 | 詳細 |
|---|---|
| **デプロイメントスロット非対応** | Flex Consumption ではデプロイメントスロットが使用できない。ゼロダウンタイムデプロイにはローリングアップデート戦略を使用する |
| **zip デプロイ必須** | コードは zip パッケージとして Blob Storage にアップロードされ、マウントされて実行される |
| **Linux のみ** | Windows はサポートされない |
| **Python バージョン** | 3.10, 3.11, 3.12 のみサポート |
| **Extension Bundle 必須** | Non-C# アプリは `[4.0.0, 5.0.0)` 以降の Extension Bundle が必須 |
| **`azd deploy` の一時エラー** | 初回デプロイ時に `KuduSpecializer restart` エラーが発生する場合がある。`azd deploy` を再実行することで解消 |

**デプロイ手順:**

```bash
# 1. zip パッケージ作成
cd src/mcp-server
pip install -r requirements.txt --target .python_packages/lib/site-packages
zip -r ../../mcp-server.zip . -x ".venv/*" "__pycache__/*" "local.settings.json"

# 2. Azure CLI でデプロイ
az functionapp deployment source config-zip \
    --src ../../mcp-server.zip \
    --name <FUNCTION_APP_NAME> \
    --resource-group <RESOURCE_GROUP>
```

**または `azd` を使用する場合:**

`azure.yaml` にサービスを追加:

```yaml
services:
  # 既存のバックエンド
  backend:
    project: ./src/backend
    language: python
    host: appservice

  # 新規: MCP サーバー
  mcp-server:
    project: ./src/mcp-server
    language: python
    host: function
```

---

## 6. MCP クライアント接続設定

### 6.1 ローカル開発

```json
// .vscode/mcp.json
{
    "servers": {
        "local-mcp-docs": {
            "type": "http",
            "url": "http://localhost:7071/runtime/webhooks/mcp"
        }
    }
}
```

### 6.2 リモート (Azure)

```json
{
    "inputs": [
        {
            "type": "promptString",
            "id": "functions-mcp-key",
            "description": "Azure Functions MCP Extension System Key",
            "password": true
        },
        {
            "type": "promptString",
            "id": "functionapp-host",
            "description": "Function App hostname (e.g. my-func.azurewebsites.net)"
        }
    ],
    "servers": {
        "remote-mcp-docs": {
            "type": "http",
            "url": "https://${input:functionapp-host}/runtime/webhooks/mcp",
            "headers": {
                "x-functions-key": "${input:functions-mcp-key}"
            }
        }
    }
}
```

MCP Extension System Key の取得:

```bash
az functionapp keys list \
    --resource-group <RESOURCE_GROUP> \
    --name <APP_NAME> \
    --query systemKeys.mcp_extension \
    --output tsv
```

---

## 7. セキュリティ要件

| 要件 | 実装 |
|---|---|
| CosmosDB 認証 | Managed Identity のみ (`disableLocalAuth: true` 維持) |
| Functions ストレージ認証 | Managed Identity (`AzureWebJobsStorage__accountName`) |
| デプロイメントストレージ認証 | System Assigned Managed Identity |
| Azure OpenAI 認証 | Managed Identity (`DefaultAzureCredential` + `get_bearer_token_provider`) |
| MCP エンドポイント認証 | System Key (`mcp_extension`) がデフォルトで必須。Built-in MCP 認証 (Microsoft Entra) の追加も推奨 |
| RBAC 最小権限 | MCP サーバーの CosmosDB ロールは `Data Reader` のみ (書き込み不可) |

---

## 8. 環境変数

### 8.1 既存バックエンド (追加分)

| 変数名 | 説明 |
|---|---|
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI エンドポイント (Embedding 生成用) |

### 8.2 MCP サーバー (Azure Functions)

| 変数名 | 説明 |
|---|---|
| `AzureWebJobsStorage__accountName` | Functions ホストストレージアカウント名 (Managed Identity 接続) |
| `COSMOS_DB_ENDPOINT` | CosmosDB エンドポイント URL |
| `COSMOS_DB_DATABASE` | データベース名 (デフォルト: `manufacturing-docs`) |
| `COSMOS_DB_CONTAINER` | ドキュメントコンテナ名 (デフォルト: `documents`) |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI エンドポイント (クエリ embedding 用) |
| `CHANNEL_ID` | **必須** — 検索・取得対象の Teams チャネル ID（URL エンコード済みでも可、自動デコード）。全ツールでパーティションキーとして使用 |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Application Insights 接続文字列 |

---

## 9. データフロー全体図

```
[ユーザー: ファイルアップロード]
       │
       ▼
[Content Understanding 分析] → CosmosDB (processingStatus: analyzing)
       │
       ▼
[質問生成 Agent] → CosmosDB (processingStatus: completed)
       │
       ▼
[ユーザー: フォローアップ質問に回答]
       │  (3回深掘り or sufficient 判定)
       ▼
[全質問完了判定] ─── Yes ──→ [ベクトル化パイプライン]
                                    │
                               Azure OpenAI Embeddings
                                    │
                               ┌────┴────┐
                               ▼         ▼
                          contentVector  qaVector
                               │         │
                               ▼         ▼
                    CosmosDB "documents" コンテナ（ベクトルインデックス付き）
                               │
       ┌───────────────────────┘
       ▼
[MCP サーバー (Azure Functions)]
       │
       ├─ search_documents     → ベクトル検索 → ファイル名 + ID リスト
       ├─ get_document_detail  → ID 指定 → 分析結果 + Q&A 詳細
       └─ get_related_documents → ID 指定 → 上流/下流関係リスト
       │
       ▼
[MCP クライアント (GitHub Copilot / VS Code Agent 等)]
```

---

## 10. 実装順序

| フェーズ | タスク | 依存関係 |
|---|---|---|
| 1 | CosmosDB アカウントで `EnableNoSQLVectorSearch` 有効化 | なし |
| 2 | `documents` コンテナを `postdeploy` フックでベクトルインデックス付きで作成 | フェーズ 1 |
| 3 | `embedding_service.py` 作成、`config.py` に `AZURE_OPENAI_ENDPOINT` 追加 | なし |
| 4 | `document_routes.py` にベクトル化トリガーロジック + `complete-questions` エンドポイント組み込み | フェーズ 2, 3 |
| 5 | `src/mcp-server/` プロジェクト作成 (`function_app.py`, `host.json`, `requirements.txt`) | なし |
| 6 | `infra/modules/mcp-function.bicep` 作成、ロールアサインメント定義 | なし |
| 7 | Azure リソースプロビジョニング (Flex Consumption Function App + ロール) | フェーズ 6 |
| 8 | MCP サーバーデプロイ + ローカルテスト | フェーズ 5, 7 |
| 9 | E2E テスト (ファイルアップロード → ベクトル化 → MCP 検索) | フェーズ 4, 8 |

---

## 11. 参考リンク

- [Azure Functions MCP Bindings Overview](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-mcp)
- [MCP Tool Trigger for Azure Functions (Python)](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-mcp-tool-trigger?pivots=programming-language-python)
- [Remote MCP Functions Python Sample](https://github.com/Azure-Samples/remote-mcp-functions-python)
- [Azure Functions Flex Consumption Plan](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan)
- [Flex Consumption How-To](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-how-to)
- [Flex Consumption IaC Samples (Bicep)](https://github.com/Azure-Samples/azure-functions-flex-consumption-samples)
- [CosmosDB NoSQL Vector Search](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/vector-search)
- [CosmosDB Python Vector Index and Query](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-python-vector-index-query)
- [Azure OpenAI Embeddings](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/embeddings)
