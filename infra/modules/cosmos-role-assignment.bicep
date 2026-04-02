@description('Cosmos DB account name')
param cosmosDbAccountName string

@description('Principal ID to assign the role to')
param principalId string

// Cosmos DB Built-in Data Contributor role (data plane)
var cosmosDataContributorRoleId = '00000000-0000-0000-0000-000000000002'

// Azure RBAC: DocumentDB Account Contributor (control plane — allows DB/container creation)
var cosmosAccountContributorRoleId = '5bd9cd88-fe45-4216-938b-f97437e15450'

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: cosmosDbAccountName
}

// Data plane RBAC: read/write items
resource dataRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, principalId, cosmosDataContributorRoleId)
  properties: {
    principalId: principalId
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    scope: cosmosAccount.id
  }
}

// Control plane RBAC: create databases/containers (needed when disableKeyBasedMetadataWriteAccess is true)
resource controlPlaneRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(cosmosAccount.id, principalId, cosmosAccountContributorRoleId)
  scope: cosmosAccount
  properties: {
    principalId: principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cosmosAccountContributorRoleId)
    principalType: 'ServicePrincipal'
  }
}
