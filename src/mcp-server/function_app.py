import json
import logging
import os
from urllib.parse import unquote

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
    description="Search query text to find relevant documents by semantic similarity.",
)
@app.mcp_tool_property(
    arg_name="top_n",
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
    description="The ID of the document to retrieve.",
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
    description="The ID of the document to find related documents for.",
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
            target_doc = container.read_item(
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
