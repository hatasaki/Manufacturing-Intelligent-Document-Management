@description('Name of the App Service')
param name string

@description('Location for the App Service')
param location string

@description('Tags for the resource')
param tags object = {}

@description('App Service Plan resource ID')
param appServicePlanId string

@description('Cosmos DB endpoint')
param cosmosDbEndpoint string

@description('Cosmos DB database name')
param cosmosDbName string

@description('Cosmos DB container name')
param cosmosContainerName string

@description('Entra ID client ID')
param entraClientId string

@secure()
@description('Entra ID client secret')
param entraClientSecret string

@description('Entra ID tenant ID')
param entraTenantId string

@description('Azure AI Foundry project endpoint')
param foundryProjectEndpoint string

@description('Content Understanding endpoint')
param contentUnderstandingEndpoint string

@description('Azure OpenAI endpoint for embeddings')
param azureOpenAiEndpoint string

resource appService 'Microsoft.Web/sites@2023-12-01' = {
  name: name
  location: location
  tags: union(tags, { 'azd-service-name': 'backend' })
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlanId
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'PYTHON|3.10'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appCommandLine: 'gunicorn --bind=0.0.0.0 --timeout 600 app:app'
      cors: {
        allowedOrigins: ['https://${name}.azurewebsites.net']
      }
      appSettings: [
        { name: 'COSMOS_DB_ENDPOINT', value: cosmosDbEndpoint }
        { name: 'COSMOS_DB_DATABASE', value: cosmosDbName }
        { name: 'COSMOS_DB_CONTAINER', value: cosmosContainerName }
        { name: 'ENTRA_CLIENT_ID', value: entraClientId }
        { name: 'ENTRA_CLIENT_SECRET', value: entraClientSecret }
        { name: 'ENTRA_TENANT_ID', value: entraTenantId }
        { name: 'FOUNDRY_PROJECT_ENDPOINT', value: foundryProjectEndpoint }
        { name: 'CONTENT_UNDERSTANDING_ENDPOINT', value: contentUnderstandingEndpoint }
        { name: 'AZURE_OPENAI_ENDPOINT', value: azureOpenAiEndpoint }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true' }
        { name: 'WEBSITES_CONTAINER_START_TIME_LIMIT', value: '600' }
      ]
    }
  }
}

output url string = 'https://${appService.properties.defaultHostName}'
output name string = appService.name
output identityPrincipalId string = appService.identity.principalId

// Disable basic auth for SCM — org policy requires Managed Identity only
resource scmBasicAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: appService
  name: 'scm'
  properties: {
    allow: false
  }
}

// Disable basic auth for FTP — org policy requires Managed Identity only
resource ftpBasicAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: appService
  name: 'ftp'
  properties: {
    allow: false
  }
}
