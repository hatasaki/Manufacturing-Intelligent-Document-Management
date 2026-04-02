# Manufacturing Intelligent Document Management

Manufacturing document management web app with Teams/SharePoint integration and AI-powered follow-up questions to extract implicit knowledge.

## Architecture

- **Frontend**: JavaScript (MSAL.js for auth)
- **Backend**: Python / Flask
- **Database**: Azure Cosmos DB (NoSQL)
- **Document Analysis**: Azure Content Understanding (Foundry Tools)
- **AI Agents**: Microsoft Foundry Agent Service
- **Auth**: Microsoft Entra ID (PKCE + OBO)
- **File Storage**: Teams / SharePoint (Graph API)
- **Hosting**: Azure App Service

## Prerequisites

- [Azure Developer CLI (azd)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Python 3.10+](https://www.python.org/downloads/)
- Azure subscription
- Microsoft Entra ID app registration (SPA + Web API)

## Quick Start

### 1. Register Entra ID App

1. Azure Portal → **Microsoft Entra ID** → **App registrations** → **New registration**
2. Name: `Manufacturing Smart Doc Mgmt`
3. Supported account types: `Accounts in this organizational directory only`
4. Redirect URI: `Single-page application (SPA)` → (set after deploy)
5. After registration:
   - **Expose an API** → Set URI: `api://<client-id>` → Add scope: `access_as_user`
   - **API permissions** → Add delegated: `User.Read`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `Files.ReadWrite.All`, `Sites.ReadWrite.All` → Grant admin consent
   - **Certificates & secrets** → New client secret → copy value

### 2. Configure and Deploy

```bash
azd init

# Only Entra ID values need manual setup — everything else is auto-provisioned
azd env set ENTRA_CLIENT_ID <client id>
azd env set ENTRA_CLIENT_SECRET <client secret>
azd env set ENTRA_TENANT_ID <tenant id>

azd up
```

This automatically provisions:
- **Azure Cosmos DB** (Serverless, RBAC-only)
- **Microsoft Foundry** (AI Services + Project)
- **Model deployments** (gpt-4.1, text-embedding-3-large)
- **Foundry Agents** (question-generator-agent, answer-analysis-agent)
- **Azure App Service** (Python 3.10, Linux)
- **RBAC role assignments** (Cosmos DB Data Contributor, Cognitive Services User)

### 3. Set Redirect URI

After deploy, update the Entra ID app registration:
- **SPA redirect URI**: `https://<your-app>.azurewebsites.net` (printed in azd output)

## Local Development

```bash
cd src/backend
python -m venv .venv
.venv/Scripts/activate  # Windows
pip install -r requirements.txt

# Copy frontend to static folder
xcopy /E /I /Y ..\frontend static  # Windows
# cp -r ../frontend/* static/      # Linux/Mac

python app.py
```

## Project Structure

```
├── azure.yaml              # azd project definition
├── infra/                  # Bicep IaC
│   ├── main.bicep
│   ├── main.parameters.json
│   └── modules/
│       ├── app-service.bicep
│       ├── app-service-plan.bicep
│       ├── cosmos-db.bicep
│       └── cosmos-role-assignment.bicep
├── src/
│   ├── backend/            # Flask API
│   │   ├── app.py
│   │   ├── config.py
│   │   ├── requirements.txt
│   │   ├── routes/
│   │   └── services/
│   └── frontend/           # JavaScript SPA
│       ├── index.html
│       ├── css/
│       └── js/
└── docs/
    └── APP_SPEC.md
```
