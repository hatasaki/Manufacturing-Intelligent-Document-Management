import { msalConfig, loginRequest, apiScopes } from "./config.js";

let msalInstance = null;
let currentAccount = null;
let initialized = false;

export async function initAuth() {
    msalInstance = new msal.PublicClientApplication(msalConfig);
    initialized = true;

    // Handle redirect promise (for redirect flows)
    await msalInstance.handleRedirectPromise();

    const accounts = msalInstance.getAllAccounts();
    if (accounts.length > 0) {
        currentAccount = accounts[0];
    }
    return currentAccount;
}

export async function login() {
    if (!initialized) throw new Error("MSAL not initialized");
    try {
        const response = await msalInstance.loginPopup(loginRequest);
        currentAccount = response.account;
        return currentAccount;
    } catch (error) {
        console.error("Login failed:", error);
        throw error;
    }
}

export async function getAccessToken() {
    if (!currentAccount) {
        throw new Error("No account logged in");
    }
    try {
        const response = await msalInstance.acquireTokenSilent({
            ...apiScopes,
            account: currentAccount,
        });
        return response.accessToken;
    } catch (error) {
        // Fallback to popup if silent fails
        const response = await msalInstance.acquireTokenPopup(apiScopes);
        return response.accessToken;
    }
}

export function getAccount() {
    return currentAccount;
}
