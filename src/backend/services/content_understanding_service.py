import logging

from azure.identity import DefaultAzureCredential
from azure.ai.contentunderstanding import ContentUnderstandingClient
from azure.ai.contentunderstanding.models import AnalysisInput

from config import Config
from services.auth_service import retry_with_backoff

logger = logging.getLogger(__name__)


def analyze_document(file_content: bytes) -> dict:
    """Analyze a PDF using Azure Content Understanding pre-built document model."""
    credential = DefaultAzureCredential()
    client = ContentUnderstandingClient(
        endpoint=Config.CONTENT_UNDERSTANDING_ENDPOINT,
        credential=credential,
    )

    def run_analysis():
        poller = client.begin_analyze(
            analyzer_id="prebuilt-documentSearch",
            inputs=[AnalysisInput(data=file_content, mime_type="application/pdf")],
        )
        return poller.result()

    result = retry_with_backoff(run_analysis, max_retries=3, base_delay=2.0)

    # Extract markdown text from the first content element
    extracted_text = ""
    figures = []
    tables = []
    key_value_pairs = []

    if result.contents:
        content = result.contents[0]
        extracted_text = getattr(content, "markdown", "") or ""

        # Extract figures if available (DocumentContent)
        if hasattr(content, "figures") and content.figures:
            for fig in content.figures:
                fig_data = {
                    "figureId": getattr(fig, "id", ""),
                    "description": getattr(fig, "description", ""),
                }
                if hasattr(fig, "bounding_regions") and fig.bounding_regions:
                    br = fig.bounding_regions[0]
                    fig_data["boundingBox"] = {
                        "page": getattr(br, "page_number", 1),
                    }
                figures.append(fig_data)

        # Extract tables if available
        if hasattr(content, "tables") and content.tables:
            for table in content.tables:
                tables.append({
                    "rowCount": getattr(table, "row_count", 0),
                    "columnCount": getattr(table, "column_count", 0),
                })

        # Extract key-value pairs if available
        if hasattr(content, "key_value_pairs") and content.key_value_pairs:
            for kvp in content.key_value_pairs:
                key_value_pairs.append({
                    "key": kvp.key.content if kvp.key else "",
                    "value": kvp.value.content if kvp.value else "",
                })

    analysis = {
        "modelVersion": "prebuilt-documentSearch-v1",
        "extractedText": extracted_text,
        "figures": figures,
        "tables": tables,
        "keyValuePairs": key_value_pairs,
    }

    return analysis
