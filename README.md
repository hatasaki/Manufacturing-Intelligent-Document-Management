# Manufacturing Intelligent Document Management

Manufacturing document management web app with Teams/SharePoint integration, AI-powered follow-up questions to extract implicit knowledge, and automated document traceability (upstream/downstream dependency tracking).

## Architecture

- **Frontend**: JavaScript (MSAL.js for auth, ES Modules)
- **Backend**: Python / Flask
- **Database**: Azure Cosmos DB (NoSQL)
- **Document Analysis**: Azure Content Understanding (Foundry Tools)
- **AI Agents**: Microsoft Foundry Agent Service (4 agents)
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
- **Model deployments** (gpt-4.1-mini, text-embedding-3-large)
- **Foundry Agents**:
  - `question-generator-agent` — Follow-up question generation
  - `answer-analysis-agent` — Answer sufficiency evaluation
  - `doc-classifier-agent` — Document classification (6 process stages)
  - `relationship-analyzer-agent` — Upstream/downstream dependency analysis
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
│   ├── abbreviations.json
│   └── modules/
│       ├── ai-foundry.bicep
│       ├── ai-foundry-role-assignment.bicep
│       ├── app-service.bicep
│       ├── app-service-plan.bicep
│       ├── cosmos-db.bicep
│       └── cosmos-role-assignment.bicep
├── scripts/
│   └── create_agents.py    # Foundry Agent creation (postprovision hook)
├── src/
│   ├── backend/            # Flask API
│   │   ├── app.py
│   │   ├── config.py
│   │   ├── requirements.txt
│   │   ├── routes/
│   │   │   ├── auth_routes.py
│   │   │   ├── teams_routes.py
│   │   │   ├── document_routes.py
│   │   │   └── relationship_routes.py
│   │   └── services/
│   │       ├── auth_service.py
│   │       ├── graph_service.py
│   │       ├── cosmos_service.py
│   │       ├── content_understanding_service.py
│   │       ├── agent_service.py
│   │       └── relationship_service.py
│   └── frontend/           # JavaScript SPA
│       ├── index.html
│       ├── css/styles.css
│       └── js/
│           ├── app.js
│           ├── api.js
│           ├── auth.js
│           ├── config.js
│           ├── i18n.js
│           └── ui.js
└── docs/
    ├── APP_SPEC.md          # Application specification
    ├── ARCHITECTURE.md      # Architecture & flow diagrams
    └── RELATIONSHIP_SPEC.md # Document traceability specification
```
