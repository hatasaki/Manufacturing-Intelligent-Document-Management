targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment that can be used as part of naming resource convention')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string

// App Service
@description('App Service Plan SKU')
param appServicePlanSku string = 'B1'

// Cosmos DB
@description('Cosmos DB database name')
param cosmosDatabaseName string = 'manufacturing-docs'

@description('Cosmos DB container name')
param cosmosContainerName string = 'documents'

// Entra ID
@description('Entra ID Application (client) ID')
param entraClientId string = ''

@secure()
@description('Entra ID Application client secret')
param entraClientSecret string = ''

@description('Entra ID Tenant ID')
param entraTenantId string = ''

var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }

resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: '${abbrs.resourcesResourceGroups}${environmentName}'
  location: location
  tags: tags
}

module cosmosDb './modules/cosmos-db.bicep' = {
  name: 'cosmos-db'
  scope: rg
  params: {
    name: '${abbrs.documentDBDatabaseAccounts}${resourceToken}'
    location: location
    tags: tags
  }
}

// AI Foundry resource + Project + Model deployments
module aiFoundry './modules/ai-foundry.bicep' = {
  name: 'ai-foundry'
  scope: rg
  params: {
    name: 'ai-${resourceToken}'
    location: location
    tags: tags
    customSubDomainName: 'ai-${resourceToken}'
  }
}

module appServicePlan './modules/app-service-plan.bicep' = {
  name: 'app-service-plan'
  scope: rg
  params: {
    name: '${abbrs.webServerFarms}${resourceToken}'
    location: location
    tags: tags
    sku: appServicePlanSku
  }
}

module appService './modules/app-service.bicep' = {
  name: 'app-service'
  scope: rg
  params: {
    name: '${abbrs.webSitesAppService}${resourceToken}'
    location: location
    tags: tags
    appServicePlanId: appServicePlan.outputs.id
    cosmosDbEndpoint: cosmosDb.outputs.endpoint
    cosmosDbName: cosmosDatabaseName
    cosmosContainerName: cosmosContainerName
    entraClientId: entraClientId
    entraClientSecret: entraClientSecret
    entraTenantId: entraTenantId
    foundryProjectEndpoint: aiFoundry.outputs.projectEndpoint
    contentUnderstandingEndpoint: aiFoundry.outputs.contentUnderstandingEndpoint
  }
}

// Grant App Service managed identity access to Cosmos DB
module cosmosRoleAssignment './modules/cosmos-role-assignment.bicep' = {
  name: 'cosmos-role-assignment'
  scope: rg
  params: {
    cosmosDbAccountName: cosmosDb.outputs.name
    principalId: appService.outputs.identityPrincipalId
  }
}

// Grant App Service managed identity Cognitive Services User role on AI Foundry
module aiFoundryRoleAssignment './modules/ai-foundry-role-assignment.bicep' = {
  name: 'ai-foundry-role-assignment'
  scope: rg
  params: {
    aiServicesName: aiFoundry.outputs.name
    principalId: appService.outputs.identityPrincipalId
  }
}

output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
output AZURE_RESOURCE_GROUP string = rg.name
output SERVICE_BACKEND_URL string = appService.outputs.url
output SERVICE_BACKEND_NAME string = appService.outputs.name
output AI_FOUNDRY_NAME string = aiFoundry.outputs.name
output AI_FOUNDRY_PROJECT_NAME string = aiFoundry.outputs.projectName
output AI_FOUNDRY_ENDPOINT string = aiFoundry.outputs.endpoint
output COSMOS_DB_ACCOUNT_NAME string = cosmosDb.outputs.name
