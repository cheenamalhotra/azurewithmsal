/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as AzureConstants from '../constants';
import * as LocalizedConstants from '../constants/localizedConstants';
import * as utils from '../models/utils';
import * as azureUtils from '../utils';

import { Subscription } from '@azure/arm-subscriptions';
import { promises as fs } from 'fs';
import { IAzureAccountSession } from 'vscode-mssql';
import { AccountStore } from '../accountStore';
import VscodeWrapper from '../controllers/vscodeWrapper';
import { AuthLibrary, AzureAuthType, IAADResource, IAccount, IProviderSettings, ITenant, IToken } from '../models/contracts/azure';
import { IConnectionProfile } from '../models/interfaces';
import { Logger, LogLevel } from '../models/logger';
import providerSettings from '../providerSettings';

export abstract class AzureController {
	protected _providerSettings: IProviderSettings;
	protected _credentialStoreInitialized = false;

	constructor(
		protected context: vscode.ExtensionContext,
		protected logger: Logger,
		protected _authLibrary: AuthLibrary,
		protected _vscodeWrapper: VscodeWrapper,
		protected _subscriptionClientFactory: azureUtils.SubscriptionClientFactory = azureUtils.defaultSubscriptionClientFactory) {
		if (!logger) {
			let logLevel: LogLevel = LogLevel[utils.getConfigTracingLevel() as keyof typeof LogLevel];
			let pii = utils.getConfigPiiLogging();
			let _channel = this._vscodeWrapper.createOutputChannel(LocalizedConstants.azureLogChannelName);
			this.logger = new Logger(text => _channel.append(text), logLevel, pii ?? false);
		}
		this._providerSettings = providerSettings;
		vscode.workspace.onDidChangeConfiguration((changeEvent) => {
			const impactsProvider = changeEvent.affectsConfiguration(AzureConstants.accountsAzureAuthSection);
			if (impactsProvider === true) {
				this.handleAuthMapping();
			}
		});
	}

	public abstract login(authType: AzureAuthType): Promise<IAccount | undefined>;

	public abstract getAccountSecurityToken(account: IAccount, tenantId: string | undefined, settings: IAADResource): Promise<IToken | undefined>;

	public abstract refreshAccessToken(account: IAccount, accountStore: AccountStore,
		tenantId: string | undefined, settings: IAADResource): Promise<IToken | undefined>;

	public abstract removeAccount(account: IAccount): Promise<void>;

	public abstract handleAuthMapping(): void;

	public async addAccount(accountStore: AccountStore): Promise<IAccount> {
		let config = azureUtils.getAzureActiveDirectoryConfig();
		let account = await this.login(config!);
		await accountStore.addAccount(account!);
		this.logger.verbose('Account added successfully.');
		return account!;
	}

	/**
	 * Gets the token for given account and updates the connection profile with token information needed for AAD authentication
	 */
	public async populateAccountProperties(profile: IConnectionProfile, accountStore: AccountStore, settings: IAADResource): Promise<IConnectionProfile> {
		let account = await this.addAccount(accountStore);

		const token = await this.getAccountSecurityToken(
			account, profile.tenantId, settings
		);

		if (!token) {
			let errorMessage = LocalizedConstants.msgGetTokenFail;
			this.logger.error(errorMessage);
			this._vscodeWrapper.showErrorMessage(errorMessage);
		} else {
			profile.azureAccountToken = token.token;
			profile.expiresOn = token.expiresOn;
			profile.email = account.displayInfo.email;
			profile.accountId = account.key.id;
		}

		return profile;
	}

	public async refreshTokenWrapper(profile: IConnectionProfile, accountStore: AccountStore, accountAnswer: IAccount, settings: IAADResource): Promise<IConnectionProfile | undefined> {
		let account = accountStore.getAccount(accountAnswer.key.id);
		if (!account) {
			await this._vscodeWrapper.showErrorMessage(LocalizedConstants.msgAccountNotFound);
			throw new Error(LocalizedConstants.msgAccountNotFound);
		}
		let azureAccountToken = await this.refreshAccessToken(account, accountStore, profile.tenantId, settings);
		if (!azureAccountToken) {
			let errorMessage = LocalizedConstants.msgAccountRefreshFailed;
			return this._vscodeWrapper.showErrorMessage(errorMessage, LocalizedConstants.refreshTokenLabel).then(async result => {
				if (result === LocalizedConstants.refreshTokenLabel) {
					let refreshedProfile = await this.populateAccountProperties(profile, accountStore, settings);
					return refreshedProfile;
				} else {
					return undefined;
				}
			});
		}

		profile.azureAccountToken = azureAccountToken.token;
		profile.expiresOn = azureAccountToken.expiresOn;
		profile.email = account.displayInfo.email;
		profile.accountId = account.key.id;
		return profile;
	}

	/**
	 * Returns Azure sessions with subscriptions, tenant and token for each given account
	 */
	public async getAccountSessions(account: IAccount): Promise<IAzureAccountSession[]> {
		let sessions: IAzureAccountSession[] = [];
		const tenants = <ITenant[]>account.properties.tenants;
		for (const tenantId of tenants.map(t => t.id)) {
			const token = await this.getAccountSecurityToken(account, tenantId, providerSettings.resources.azureManagementResource);
			const subClient = this._subscriptionClientFactory(token!);
			const newSubPages = await subClient.subscriptions.list();
			const array = await azureUtils.getAllValues<Subscription, IAzureAccountSession>(newSubPages, (nextSub) => {
				return {
					subscription: nextSub,
					tenantId: tenantId,
					account: account,
					token: token!
				};
			});
			sessions = sessions.concat(array);
		}

		return sessions.sort((a, b) => (a.subscription.displayName || '').localeCompare(b.subscription.displayName || ''));
	}

	/**
	 * Verifies if the token still valid, refreshes the token for given account
	 * @param session
	 */
	public async checkAndRefreshToken(
		session: IAzureAccountSession,
		accountStore: AccountStore): Promise<void> {
		if (session?.account && AzureController.isTokenInValid(session.token?.token, session.token.expiresOn)) {
			const token = await this.refreshAccessToken(session.account, accountStore, undefined,
				providerSettings.resources.azureManagementResource);
			session.token = token!;
			this.logger.verbose(`Access Token refreshed for account: ${session?.account?.key.id}`);
		} else {
			this.logger.verbose(`Access Token not refreshed for account: ${session?.account?.key.id}`);
		}
	}

	/**
	 * Returns true if token is invalid or expired
	 * @param token Token
	 * @param token expiry
	 */
	public static isTokenInValid(token: string, expiresOn?: number): boolean {
		return (!token || this.isTokenExpired(expiresOn));
	}

	/**
	 * Returns true if token is expired
	 * @param token expiry
	 */
	public static isTokenExpired(expiresOn?: number): boolean {
		if (!expiresOn) {
			return true;
		}
		const currentTime = new Date().getTime() / 1000;
		const maxTolerance = 2 * 60; // two minutes
		return (expiresOn - currentTime < maxTolerance);
	}

	// Generates storage path for Azure Account cache, e.g C:\users\<>\AppData\Roaming\Code\Azure Accounts\
	protected async findOrMakeStoragePath(): Promise<string | undefined> {
		let defaultOutputLocation = this.getDefaultOutputLocation();
		let storagePath = path.join(defaultOutputLocation, AzureConstants.azureAccountDirectory);

		try {
			await fs.mkdir(defaultOutputLocation, { recursive: true });
		} catch (e: any) {
			if (e.code !== 'EEXIST') {
				this.logger.error(`Creating the base directory failed... ${e}`);
				return undefined;
			}
		}

		try {
			await fs.mkdir(storagePath, { recursive: true });
		} catch (e: any) {
			if (e.code !== 'EEXIST') {
				this.logger.error(`Initialization of vscode-mssql storage failed: ${e}`);
				this.logger.error('Azure accounts will not be available');
				return undefined;
			}
		}

		this.logger.log('Initialized vscode-mssql storage.');
		return storagePath;
	}

	private getAppDataPath(): string {
		let platform = process.platform;
		switch (platform) {
			case 'win32': return process.env['APPDATA'] || path.join(process.env['USERPROFILE']!, 'AppData', 'Roaming');
			case 'darwin': return path.join(os.homedir(), 'Library', 'Application Support');
			case 'linux': return process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config');
			default: throw new Error('Platform not supported');
		}
	}

	private getDefaultOutputLocation(): string {
		return path.join(this.getAppDataPath(), AzureConstants.serviceName);
	}
}
