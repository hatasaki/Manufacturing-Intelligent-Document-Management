// MSAL and API configuration
// These values are substituted during deployment by the postprovision hook.
// For local dev, replace manually.
export const msalConfig = {
    auth: {
        clientId: "__ENTRA_CLIENT_ID__",
        authority: "https://login.microsoftonline.com/__ENTRA_TENANT_ID__",
        redirectUri: window.location.origin,
    },
    cache: {
        cacheLocation: "sessionStorage",
        storeAuthStateInCookie: false,
    },
};

export const loginRequest = {
    scopes: [`api://__ENTRA_CLIENT_ID__/access_as_user`],
};

export const apiScopes = {
    scopes: [`api://__ENTRA_CLIENT_ID__/access_as_user`],
};

export const API_BASE = "/api";
