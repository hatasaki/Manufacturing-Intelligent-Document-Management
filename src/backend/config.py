import os


class Config:
    # Entra ID
    ENTRA_CLIENT_ID = os.environ.get("ENTRA_CLIENT_ID", "")
    ENTRA_CLIENT_SECRET = os.environ.get("ENTRA_CLIENT_SECRET", "")
    ENTRA_TENANT_ID = os.environ.get("ENTRA_TENANT_ID", "")
    ENTRA_AUTHORITY = f"https://login.microsoftonline.com/{ENTRA_TENANT_ID}"
    GRAPH_SCOPES = ["User.Read", "Team.ReadBasic.All", "Channel.ReadBasic.All",
                    "Files.ReadWrite.All", "Sites.ReadWrite.All"]

    # Cosmos DB
    COSMOS_DB_ENDPOINT = os.environ.get("COSMOS_DB_ENDPOINT", "")
    COSMOS_DB_DATABASE = os.environ.get("COSMOS_DB_DATABASE", "manufacturing-docs")
    COSMOS_DB_CONTAINER = os.environ.get("COSMOS_DB_CONTAINER", "documents")

    # Azure AI Foundry
    FOUNDRY_PROJECT_ENDPOINT = os.environ.get("FOUNDRY_PROJECT_ENDPOINT", "")

    # Content Understanding
    CONTENT_UNDERSTANDING_ENDPOINT = os.environ.get("CONTENT_UNDERSTANDING_ENDPOINT", "")
