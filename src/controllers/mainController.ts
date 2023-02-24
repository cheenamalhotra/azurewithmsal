
import * as events from 'events';
import * as vscode from 'vscode';
import { AccountStore } from '../accountStore';
import { AuthLibrary, AzureAuthType } from '../models/contracts/azure';
import { Logger } from '../models/logger';
import { MsalAzureController } from '../msal/msalAzureController';
import { AzureAccountService } from '../services/azureAccountService';
import { AzureController } from './azureController';
import VscodeWrapper from './vscodeWrapper';

export class MainController implements vscode.Disposable {
    private _context: vscode.ExtensionContext;
    private _event: events.EventEmitter = new events.EventEmitter();
    private _initialized: boolean = false;
    private _azureController: AzureController;
    private _accountStore: AccountStore;
    private _accountService: AzureAccountService;

    constructor(context: vscode.ExtensionContext,
        private vscodeWrapper?: VscodeWrapper,
        private logger?: Logger) {
        if (!this.vscodeWrapper) {
            this.vscodeWrapper = new VscodeWrapper();
        }
		this._accountStore = new AccountStore(context, this.logger!);
        this._context = context;
        this._azureController = new MsalAzureController(context, this.logger!, AuthLibrary.MSAL, this.vscodeWrapper);
        this._accountService = new AzureAccountService(this._azureController, this._accountStore);
    }

	/**
	 * Initializes the extension
	 */
	public activate(): boolean {
		// initialize the language client then register the commands
		const didInitialize = this.initialize();
		if (didInitialize) {
            
			this.registerCommand("azurewithmsal.azureLogin");
			this._event.on("azurewithmsal.azureLogin", () => { this.runAndLogErrors(this.startLogin()); });
        }
        return this._initialized;
    }

    /**
     * Handles azurewithmsal.azureLogin
     */
    private async startLogin(): Promise<void> {
        await this._azureController.login(AzureAuthType.AuthCodeGrant);
    }
    
	/**
	 * Executes a callback and logs any errors raised
	 */
	private runAndLogErrors<T>(promise: Promise<T>): Promise<T | undefined> {
		return promise.catch(err => {
			this.vscodeWrapper!.showErrorMessage("Error: " + err);
			return undefined;
		});
	}

	/**
	 * Helper method to setup command registrations
	 */
	public registerCommand(command: string): void {
		const self = this;
		this._context.subscriptions.push(vscode.commands.registerCommand(command, () => self._event.emit(command)));
	}

	/**
	 * Initializes the extension
	 */
	public initialize(): boolean {
		this._initialized = true;
        return true;
    }

    dispose() {
        // dispose later
    }
}