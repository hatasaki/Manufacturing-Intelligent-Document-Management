"""Create the documents container with vector indexes via ARM REST API (control plane).

Uses 'az rest' (ARM API) so only standard Azure RBAC (Contributor) is required.
No Cosmos DB data-plane RBAC needed. No Python package dependencies beyond stdlib.

Retries automatically to handle EnableNoSQLVectorSearch capability propagation
delay (up to 15 minutes on newly created accounts).

Required environment variables:
  COSMOS_DB_ACCOUNT_NAME  - Cosmos DB account name
  AZURE_RESOURCE_GROUP    - Resource group name
"""

import json
import os
import subprocess
import sys
import tempfile
import time


CONTAINER_BODY = {
    "properties": {
        "resource": {
            "id": "documents",
            "partitionKey": {
                "paths": ["/channelId"],
                "kind": "Hash",
                "version": 2,
            },
            "indexingPolicy": {
                "indexingMode": "consistent",
                "automatic": True,
                "includedPaths": [{"path": "/*"}],
                "excludedPaths": [
                    {"path": '/"_etag"/?'},
                    {"path": "/contentVector/*"},
                    {"path": "/qaVector/*"},
                ],
                "vectorIndexes": [
                    {"path": "/contentVector", "type": "quantizedFlat"},
                    {"path": "/qaVector", "type": "quantizedFlat"},
                ],
            },
            "vectorEmbeddingPolicy": {
                "vectorEmbeddings": [
                    {
                        "path": "/contentVector",
                        "dataType": "float32",
                        "distanceFunction": "cosine",
                        "dimensions": 1536,
                    },
                    {
                        "path": "/qaVector",
                        "dataType": "float32",
                        "distanceFunction": "cosine",
                        "dimensions": 1536,
                    },
                ]
            },
        }
    }
}


def az(*args):
    """Run an az cli command and return the CompletedProcess."""
    import shutil
    az_cmd = shutil.which("az") or "az"
    return subprocess.run(
        [az_cmd] + list(args),
        capture_output=True,
        text=True,
    )


def container_exists(cosmos_name, rg):
    """Check if documents container already exists."""
    result = az(
        "cosmosdb", "sql", "container", "show",
        "--account-name", cosmos_name,
        "--resource-group", rg,
        "--database-name", "manufacturing-docs",
        "--name", "documents",
    )
    return result.returncode == 0


def main():
    cosmos_name = os.environ.get("COSMOS_DB_ACCOUNT_NAME", "")
    rg = os.environ.get("AZURE_RESOURCE_GROUP", "")

    if not cosmos_name or not rg:
        print("ERROR: COSMOS_DB_ACCOUNT_NAME and AZURE_RESOURCE_GROUP must be set")
        sys.exit(1)

    # Skip if already exists
    if container_exists(cosmos_name, rg):
        print("documents container already exists, skipping")
        return

    # Get subscription ID
    sub_result = az("account", "show", "--query", "id", "-o", "tsv")
    sub_id = sub_result.stdout.strip()
    if not sub_id:
        print("ERROR: Could not determine subscription ID")
        sys.exit(1)

    url = (
        f"https://management.azure.com/subscriptions/{sub_id}"
        f"/resourceGroups/{rg}"
        f"/providers/Microsoft.DocumentDB/databaseAccounts/{cosmos_name}"
        f"/sqlDatabases/manufacturing-docs/containers/documents"
        f"?api-version=2024-05-15"
    )

    # Write body to temp file to avoid shell escaping issues
    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8",
    )
    json.dump(CONTAINER_BODY, tmp)
    tmp.close()

    try:
        max_retries = 20  # 20 * 45s = 15 minutes (matches max propagation time)
        for attempt in range(1, max_retries + 1):
            print(f"Creating documents container (attempt {attempt}/{max_retries})...")

            result = az("rest", "--method", "PUT", "--url", url, "--body", f"@{tmp.name}")
            if result.returncode != 0:
                stderr = result.stderr.strip()
                if stderr:
                    print(f"  az rest error: {stderr[:300]}")

            # Give ARM a moment then verify
            time.sleep(5)

            if container_exists(cosmos_name, rg):
                print("SUCCESS: documents container created")
                return

            if attempt < max_retries:
                print("  EnableNoSQLVectorSearch capability still propagating, retrying in 45s...")
                time.sleep(40)  # total ~45s per attempt
            else:
                print("ERROR: Failed to create documents container after all retries.")
                print("Please wait a few minutes and re-run: azd provision")
                sys.exit(1)
    finally:
        os.unlink(tmp.name)


if __name__ == "__main__":
    main()
