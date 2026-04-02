@description('AI Services account name')
param aiServicesName string

@description('Principal ID to assign the role to')
param principalId string

// Cognitive Services User role — allows calling inference endpoints and agents
var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'

resource aiServices 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: aiServicesName
}

resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(aiServices.id, principalId, cognitiveServicesUserRoleId)
  scope: aiServices
  properties: {
    principalId: principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
    principalType: 'ServicePrincipal'
  }
}

