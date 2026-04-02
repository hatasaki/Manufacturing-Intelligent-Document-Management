@description('Name of the App Service Plan')
param name string

@description('Location for the App Service Plan')
param location string

@description('Tags for the resource')
param tags object = {}

@description('SKU name for the App Service Plan')
param sku string = 'B1'

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: name
  location: location
  tags: tags
  kind: 'linux'
  properties: {
    reserved: true
  }
  sku: {
    name: sku
  }
}

output id string = appServicePlan.id
output name string = appServicePlan.name
