import json
import logging

from azure.identity import DefaultAzureCredential
from azure.ai.contentunderstanding import ContentUnderstandingClient

from config import Config
from services.auth_service import retry_with_backoff

logger = logging.getLogger(__name__)

# Cosmos DB item size limit is 2 MB; keep extractedText well under that
_MAX_EXTRACTED_TEXT_CHARS = 800_000  # ~800 KB of UTF-8 text


def _extract_text_from_paragraphs(content) -> str:
    """Fallback: build text from paragraphs when markdown is unavailable."""
    paragraphs = getattr(content, "paragraphs", None)
    if not paragraphs:
        return ""
    parts = []
    for para in paragraphs:
        text = getattr(para, "content", "") or ""
        if text:
            parts.append(text)
    return "\n\n".join(parts)


def _extract_text_from_pages(content) -> str:
    """Fallback: build text from page lines when paragraphs are unavailable."""
    pages = getattr(content, "pages", None)
    if not pages:
        return ""
    parts = []
    for page in pages:
        lines = getattr(page, "lines", None) or []
        for line in lines:
            text = getattr(line, "content", "") or ""
            if text:
                parts.append(text)
        if lines:
            parts.append("")  # page break
    return "\n".join(parts)


def analyze_document(file_content: bytes, deep_analysis: bool = False) -> dict:
    """Analyze a PDF using Azure Content Understanding.
    
    Args:
        file_content: Raw PDF bytes.
        deep_analysis: If True, use prebuilt-documentSearch (with figure analysis).
                       If False, use prebuilt-document (faster).
    """
    credential = DefaultAzureCredential()
    client = ContentUnderstandingClient(
        endpoint=Config.CONTENT_UNDERSTANDING_ENDPOINT,
        credential=credential,
    )

    analyzer_id = "prebuilt-documentSearch" if deep_analysis else "prebuilt-document"
    logger.info("Using analyzer: %s (input size: %d bytes)", analyzer_id, len(file_content))

    def run_analysis(aid):
        poller = client.begin_analyze_binary(
            analyzer_id=aid,
            binary_input=file_content,
            content_type="application/pdf",
        )
        return poller.result()

    result = retry_with_backoff(lambda: run_analysis(analyzer_id), max_retries=3, base_delay=2.0)

    contents = result.contents or []
    logger.info("CU returned %d content element(s) with %s", len(contents), analyzer_id)

    # Fallback: if documentSearch returns empty contents, retry with prebuilt-document
    if not contents and analyzer_id == "prebuilt-documentSearch":
        logger.warning("prebuilt-documentSearch returned 0 contents, falling back to prebuilt-document")
        analyzer_id = "prebuilt-document"
        result = retry_with_backoff(lambda: run_analysis(analyzer_id), max_retries=3, base_delay=2.0)
        contents = result.contents or []
        logger.info("Fallback CU returned %d content element(s) with %s", len(contents), analyzer_id)

    text_parts = []
    figures = []
    tables = []
    key_value_pairs = []

    for i, content in enumerate(contents):
        kind = getattr(content, "kind", "unknown")
        has_md = content.markdown is not None
        md = content.markdown or ""
        page_range = ""
        if hasattr(content, "start_page_number") and hasattr(content, "end_page_number"):
            page_range = f" pages {content.start_page_number}-{content.end_page_number}"

        # Primary: use markdown
        if md:
            text_parts.append(md)
            logger.info("  content[%d] kind=%s%s: markdown=%d chars", i, kind, page_range, len(md))
        else:
            # Fallback 1: paragraphs
            para_text = _extract_text_from_paragraphs(content)
            if para_text:
                text_parts.append(para_text)
                logger.info("  content[%d] kind=%s%s: markdown=%s, fallback to paragraphs=%d chars",
                            i, kind, page_range, has_md, len(para_text))
            else:
                # Fallback 2: page lines
                lines_text = _extract_text_from_pages(content)
                if lines_text:
                    text_parts.append(lines_text)
                    logger.info("  content[%d] kind=%s%s: markdown=%s, paragraphs=0, fallback to lines=%d chars",
                                i, kind, page_range, has_md, len(lines_text))
                else:
                    logger.warning("  content[%d] kind=%s%s: no text extracted (markdown=%s, paragraphs=0, lines=0)",
                                   i, kind, page_range, has_md)

        # Extract figures (DocumentContent subclass)
        if hasattr(content, "figures") and content.figures:
            for fig in content.figures:
                fig_data = {
                    "figureId": getattr(fig, "id", ""),
                    "description": getattr(fig, "description", ""),
                }
                # Get page number from span offset if available
                if hasattr(fig, "source") and fig.source:
                    fig_data["source"] = str(fig.source)
                figures.append(fig_data)

        # Extract tables
        if hasattr(content, "tables") and content.tables:
            for table in content.tables:
                tables.append({
                    "rowCount": getattr(table, "row_count", 0),
                    "columnCount": getattr(table, "column_count", 0),
                })

        # Extract key-value pairs
        if hasattr(content, "key_value_pairs") and content.key_value_pairs:
            for kvp in content.key_value_pairs:
                key_value_pairs.append({
                    "key": kvp.key.content if kvp.key else "",
                    "value": kvp.value.content if kvp.value else "",
                })

    extracted_text = "\n\n".join(text_parts)

    # Truncate if too large to fit in Cosmos DB
    if len(extracted_text) > _MAX_EXTRACTED_TEXT_CHARS:
        logger.warning("Truncating extractedText from %d to %d chars", len(extracted_text), _MAX_EXTRACTED_TEXT_CHARS)
        extracted_text = extracted_text[:_MAX_EXTRACTED_TEXT_CHARS] + "\n\n[... truncated ...]"

    logger.info("Final extractedText: %d chars, figures: %d, tables: %d, kvps: %d",
                len(extracted_text), len(figures), len(tables), len(key_value_pairs))

    analysis = {
        "modelVersion": f"{analyzer_id}-v1",
        "extractedText": extracted_text,
        "figures": figures,
        "tables": tables,
        "keyValuePairs": key_value_pairs,
    }

    # Log approximate serialized size for Cosmos DB diagnostics
    approx_size = len(json.dumps(analysis, ensure_ascii=False))
    logger.info("Analysis dict approx size: %d bytes (%.1f KB)", approx_size, approx_size / 1024)

    return analysis
