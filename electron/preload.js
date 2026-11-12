// Exposes the Google sign-in bridge to the app page. The page never sees refresh tokens.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atombookDesktop', {
  googleAuth: {
    signIn: (cfg) => ipcRenderer.invoke('google-auth:sign-in', cfg),
    getToken: (cfg) => ipcRenderer.invoke('google-auth:token', cfg),
    signOut: () => ipcRenderer.invoke('google-auth:sign-out'),
    hasSignedIn: () => ipcRenderer.invoke('google-auth:has'),
  },
});
