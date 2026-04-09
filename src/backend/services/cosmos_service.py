import logging

from azure.cosmos import CosmosClient, PartitionKey
from azure.identity import DefaultAzureCredential

logger = logging.getLogger(__name__)


class CosmosService:
    def __init__(self, config: dict):
        self._endpoint = config.get("COSMOS_DB_ENDPOINT", "")
        self._db_name = config.get("COSMOS_DB_DATABASE", "manufacturing-docs")
        self._container_name = config.get("COSMOS_DB_CONTAINER", "documents")
        self._container = None
        self._initialized = False

        if not self._endpoint:
            logger.warning("Cosmos DB endpoint not configured")

    def _ensure_initialized(self):
        """Lazy initialization — only connect on first actual use."""
        if self._initialized:
            return
        if not self._endpoint:
            raise RuntimeError("Cosmos DB endpoint not configured")

        try:
            credential = DefaultAzureCredential()
            client = CosmosClient(self._endpoint, credential=credential)
            # Database and container are created via ARM (postprovision hook)
            # because disableKeyBasedMetadataWriteAccess blocks data-plane creates
            database = client.get_database_client(self._db_name)
            self._container = database.get_container_client(self._container_name)
            self._initialized = True
            logger.info("Cosmos DB initialized successfully")
        except Exception as e:
            logger.error("Cosmos DB initialization failed: %s", e)
            raise

    def upsert_document(self, document: dict) -> dict:
        self._ensure_initialized()
        return self._container.upsert_item(body=document)

    def get_document(self, doc_id: str, channel_id: str) -> dict | None:
        self._ensure_initialized()
        try:
            return self._container.read_item(item=doc_id, partition_key=channel_id)
        except Exception:
            return None

    def query_documents(self, channel_id: str) -> list:
        self._ensure_initialized()
        query = "SELECT * FROM c WHERE c.channelId = @channelId"
        params = [{"name": "@channelId", "value": channel_id}]
        items = self._container.query_items(
            query=query, parameters=params, partition_key=channel_id
        )
        return list(items)

    def find_by_drive_item_id(self, channel_id: str, drive_item_id: str) -> dict | None:
        self._ensure_initialized()
        query = "SELECT * FROM c WHERE c.channelId = @channelId AND c.driveItemId = @driveItemId"
        params = [
            {"name": "@channelId", "value": channel_id},
            {"name": "@driveItemId", "value": drive_item_id},
        ]
        items = list(self._container.query_items(
            query=query, parameters=params, partition_key=channel_id
        ))
        return items[0] if items else None

    def query_documents_by_status(self, statuses: list[str]) -> list:
        """Query documents with relationshipStatus in the given statuses (cross-partition)."""
        self._ensure_initialized()
        placeholders = ", ".join(f"@s{i}" for i in range(len(statuses)))
        query = f"SELECT * FROM c WHERE c.relationshipStatus IN ({placeholders})"
        params = [{"name": f"@s{i}", "value": s} for i, s in enumerate(statuses)]
        items = self._container.query_items(
            query=query, parameters=params, enable_cross_partition_query=True
        )
        return list(items)

    def delete_document(self, doc_id: str, channel_id: str) -> None:
        """Delete a document item from Cosmos DB."""
        self._ensure_initialized()
        self._container.delete_item(item=doc_id, partition_key=channel_id)
