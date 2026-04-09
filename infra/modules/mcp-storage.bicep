@description('Name of the Storage Account')
param name string

@description('Location for the Storage Account')
param location string

@description('Tags for the resource')
param tags object = {}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: name
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    supportsHttpsTrafficOnly: true
    defaultToOAuthAuthentication: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    minimumTlsVersion: 'TLS1_2'
    // publicNetworkAccess must be Enabled for azd deploy to upload zip packages
    // and for the Functions runtime to access deployment blobs
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

output name string = storageAccount.name
output id string = storageAccount.id
