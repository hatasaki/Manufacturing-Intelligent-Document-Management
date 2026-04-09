import logging

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI

from config import Config

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-large"
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
