@description('Name of the Cosmos DB account')
param name string

@description('Location for the Cosmos DB account')
param location string

@description('Tags for the resource')
param tags object = {}

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: name
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    capabilities: [
      {
        name: 'EnableServerless'
      }
      {
        name: 'EnableNoSQLVectorSearch'
      }
    ]
    // Disable key-based authentication — Managed Identity (RBAC) only
    disableLocalAuth: true
    // Allow RBAC Data Contributor to create databases/containers via SDK
    disableKeyBasedMetadataWriteAccess: false
    // Allow access from Azure services (App Service)
    publicNetworkAccess: 'Enabled'
    isVirtualNetworkFilterEnabled: false
    ipRules: []
  }
}

// Database
resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: 'manufacturing-docs'
  properties: {
    resource: {
      id: 'manufacturing-docs'
    }
  }
}

// NOTE: The documents container (with vector embedding policies) is created
// by postdeploy hook (scripts/create_vector_container.py) via ARM REST API.
// This is because EnableNoSQLVectorSearch capability can take up to 15 minutes
// to propagate after account creation. The script retries automatically.

output endpoint string = cosmosAccount.properties.documentEndpoint
output name string = cosmosAccount.name
output id string = cosmosAccount.id
