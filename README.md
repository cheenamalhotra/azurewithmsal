# Azure Auth with MSAL

VSCode Extension to test Azure Auth with MSAL

## Steps to reproduce:

- Clone the repository
- Open folder in VS Code
- Open terminal and execute below commands:
    ```
    yarn
    yarn run watch
    ```
- `F5` to run extension
- When a new window opens with extension loaded, open Command Palette (Ctrl + Shift + P) and run below command:
    ```
    "command": "azurewithmsal.azureLogin",
    "title": "AzMSAL: Login with an Azure Account"
    ```
- Open 'Azure Logs' from Output pane dropdown
- Running above command will prompt for login with Microsoft Account using MSAL.js