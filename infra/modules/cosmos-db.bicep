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

// Database and container are created at app startup via SDK using Managed Identity (RBAC)
// because disableKeyBasedMetadataWriteAccess prevents ARM from creating them

output endpoint string = cosmosAccount.properties.documentEndpoint
output name string = cosmosAccount.name
output id string = cosmosAccount.id
