/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILoggerCallback, LogLevel as MsalLogLevel } from "@azure/msal-common";
import { Configuration, PublicClientApplication } from '@azure/msal-node';
import { AccountStore } from '../accountStore';
import * as Constants from '../constants/constants';
import { AzureController } from '../controllers/azureController';
import { AzureAuthType, IAADResource, IAccount, IToken } from '../models/contracts/azure';
import { getAzureActiveDirectoryConfig } from '../utils';
import { HttpClientCurrent } from './httpClientCurrent';
import { MsalAzureAuth } from './msalAzureAuth';
import { MsalAzureCodeGrant } from './msalAzureCodeGrant';
import { MsalAzureDeviceCode } from './msalAzureDeviceCode';
import { MsalCachePluginProvider } from './msalCachePlugin';

export class MsalAzureController extends AzureController {
	private _authMappings = new Map<AzureAuthType, MsalAzureAuth>();
	private _cachePluginProvider: MsalCachePluginProvider | undefined = undefined;
	protected clientApplication: PublicClientApplication | undefined;

	private getLoggerCallback(): ILoggerCallback {
		return (level: number, message: string, containsPii: boolean) => {
			if (!containsPii) {
				switch (level) {
					case MsalLogLevel.Error:
						this.logger.error(message);
						break;
					case MsalLogLevel.Info:
						this.logger.info(message);
						break;
					case MsalLogLevel.Verbose:
					default:
						this.logger.verbose(message);
						break;
				}
			} else {
				this.logger.pii(message);
			}
		};
	}
	
	public async login(authType: AzureAuthType): Promise<IAccount | undefined> {
		let azureAuth = await this.getAzureAuthInstance(authType);
		let response = await azureAuth!.startLogin();
		return response ? response as IAccount : undefined;
	}

	private async getAzureAuthInstance(authType: AzureAuthType): Promise<MsalAzureAuth | undefined> {
		if (!this._authMappings.has(authType)) {
			await this.handleAuthMapping();
		}
		return this._authMappings.get(authType);
	}

	public async getAccountSecurityToken(account: IAccount, tenantId: string, settings: IAADResource): Promise<IToken | undefined> {
		let azureAuth = await this.getAzureAuthInstance(account.properties.azureAuthType);
		if (azureAuth) {
			this.logger.piiSantized(`Getting account security token for ${JSON.stringify(account?.key)} (tenant ${tenantId}). Auth Method = ${AzureAuthType[account?.properties.azureAuthType]}`, [], []);
			tenantId = tenantId || account.properties.owningTenant.id;
			let result = await azureAuth.getToken(account, tenantId, settings);
			if (!result || !result.account || !result.account.idTokenClaims) {
				this.logger.error(`MSAL: getToken call failed`);
				throw Error('Failed to get token');
			} else {
				const token: IToken = {
					key: result.account.homeAccountId,
					token: result.accessToken,
					tokenType: result.tokenType,
					expiresOn: result.account.idTokenClaims.exp
				};
				return token;
			}
		} else {
			account.isStale = true;
			this.logger.error(`_getAccountSecurityToken: Authentication method not found for account ${account.displayInfo.displayName}`);
			throw Error('Failed to get authentication method, please remove and re-add the account');
		}
	}

	public async refreshAccessToken(account: IAccount, accountStore: AccountStore, tenantId: string | undefined,
		settings: IAADResource): Promise<IToken | undefined> {
		try {
			let token: IToken | undefined;
			let azureAuth = await this.getAzureAuthInstance(getAzureActiveDirectoryConfig()!);
			let newAccount = await azureAuth!.refreshAccessToken(account, tenantId!, settings);
			if (newAccount!.isStale === true) {
				return undefined;
			}
			await accountStore.addAccount(newAccount!);

			token = await this.getAccountSecurityToken(
				account, tenantId!, settings
			);
			return token;
		} catch (ex: any) {
			this._vscodeWrapper.showErrorMessage(ex);
		}
	}

	public async removeAccount(account: IAccount): Promise<void> {
		let azureAuth = await this.getAzureAuthInstance(account.properties.azureAuthType);
		await azureAuth!.clearCredentials(account);
	}

	public async handleAuthMapping(): Promise<void> {
		if (!this.clientApplication) {
			let storagePath = await this.findOrMakeStoragePath();
			this._cachePluginProvider = new MsalCachePluginProvider(Constants.msalCacheFileName, storagePath!, this.logger);
			const msalConfiguration: Configuration = {
				auth: {
					clientId: this._providerSettings.clientId,
					authority: 'https://login.windows.net/common'
				},
				system: {
					loggerOptions: {
						loggerCallback: this.getLoggerCallback(),
						logLevel: MsalLogLevel.Trace,
						piiLoggingEnabled: true
					},
					networkClient: new HttpClientCurrent()
				},
				cache: {
					cachePlugin: this._cachePluginProvider?.getCachePlugin()
				}
			};
			this.clientApplication = new PublicClientApplication(msalConfiguration);
		}

		this._authMappings.clear();

		const configuration = getAzureActiveDirectoryConfig();

		if (configuration === AzureAuthType.AuthCodeGrant) {
			this._authMappings.set(AzureAuthType.AuthCodeGrant, new MsalAzureCodeGrant(
				this._providerSettings, this.context, this.clientApplication, this._vscodeWrapper, this.logger));
		} else if (configuration === AzureAuthType.DeviceCode) {
			this._authMappings.set(AzureAuthType.DeviceCode, new MsalAzureDeviceCode(
				this._providerSettings, this.context, this.clientApplication, this._vscodeWrapper, this.logger));
		}
	}
}
