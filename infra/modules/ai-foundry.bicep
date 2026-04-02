@description('Name of the AI Foundry resource')
param name string

@description('Location for the resource')
param location string

@description('Tags for the resource')
param tags object = {}

@description('Custom subdomain name for the resource')
param customSubDomainName string

// AI Services account (Foundry resource)
resource aiServices 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: name
  location: location
  tags: tags
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    customSubDomainName: customSubDomainName
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
    allowProjectManagement: true
  }
}

// Foundry Project
resource project 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: aiServices
  name: '${name}-project'
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {}
}

// Model deployment: gpt-4.1-mini
resource gpt41Deployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: aiServices
  name: 'gpt-41-mini'
  sku: {
    name: 'GlobalStandard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4.1-mini'
      version: '2025-04-14'
    }
  }
}

// Model deployment: text-embedding-3-large
resource embeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: aiServices
  name: 'text-embedding-3-large'
  dependsOn: [gpt41Deployment]
  sku: {
    name: 'GlobalStandard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'text-embedding-3-large'
      version: '1'
    }
  }
}

output endpoint string = aiServices.properties.endpoint
output name string = aiServices.name
output projectName string = project.name
output projectEndpoint string = '${aiServices.properties.endpoint}api/projects/${project.name}'
output contentUnderstandingEndpoint string = aiServices.properties.endpoint
output principalId string = aiServices.identity.principalId
