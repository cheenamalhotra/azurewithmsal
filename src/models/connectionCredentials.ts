/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConnectionDetails, IConnectionInfo } from 'vscode-mssql';
import * as LocalizedConstants from '../constants/localizedConstants';
import { AuthenticationTypes, IConnectionProfile } from './interfaces';
import * as utils from './utils';

// Concrete implementation of the IConnectionCredentials interface
export class ConnectionCredentials implements IConnectionInfo {
	public server: string | undefined;
	public database: string | undefined;
	public user: string | undefined;
	public password: string | undefined;
	public email: string | undefined;
	public accountId: string | undefined;
	public tenantId: string | undefined;
	public port: number | undefined;
	public authenticationType: string | undefined;
	public azureAccountToken: string | undefined;
	public expiresOn: number | undefined;
	public encrypt: string | boolean | undefined;
	public trustServerCertificate: boolean | undefined;
	public hostNameInCertificate: string | undefined;
	public persistSecurityInfo: boolean | undefined;
	public connectTimeout: number | undefined;
	public commandTimeout: number | undefined;
	public connectRetryCount: number | undefined;
	public connectRetryInterval: number | undefined;
	public applicationName: string | undefined;
	public workstationId: string | undefined;
	public applicationIntent: string | undefined;
	public currentLanguage: string | undefined;
	public pooling: boolean | undefined;
	public maxPoolSize: number | undefined;
	public minPoolSize: number | undefined;
	public loadBalanceTimeout: number | undefined;
	public replication: boolean | undefined;
	public attachDbFilename: string | undefined;
	public failoverPartner: string | undefined;
	public multiSubnetFailover: boolean | undefined;
	public multipleActiveResultSets: boolean | undefined;
	public packetSize: number | undefined;
	public typeSystemVersion: string | undefined;
	public connectionString: string | undefined;


	/**
	 * Create a connection details contract from connection credentials.
	 */
	public static createConnectionDetails(credentials: IConnectionInfo): ConnectionDetails {
		let details: ConnectionDetails = {
			options: {}
		};

		details.options['connectionString'] = credentials.connectionString;
		details.options['server'] = credentials.server;
		if (credentials.port && details.options['server'].indexOf(',') === -1) {
			// Port is appended to the server name in a connection string
			details.options['server'] += (',' + credentials.port);
		}
		details.options['database'] = credentials.database;
		details.options['databaseDisplayName'] = credentials.database;
		details.options['user'] = credentials.user || credentials.email;
		details.options['password'] = credentials.password;
		details.options['authenticationType'] = credentials.authenticationType;
		details.options['azureAccountToken'] = credentials.azureAccountToken;
		details.options['encrypt'] = credentials.encrypt;
		details.options['trustServerCertificate'] = credentials.trustServerCertificate;
		details.options['hostNameInCertificate'] = credentials.hostNameInCertificate;
		details.options['persistSecurityInfo'] = credentials.persistSecurityInfo;
		details.options['connectTimeout'] = credentials.connectTimeout;
		details.options['commandTimeout'] = credentials.commandTimeout;
		details.options['connectRetryCount'] = credentials.connectRetryCount;
		details.options['connectRetryInterval'] = credentials.connectRetryInterval;
		details.options['applicationName'] = credentials.applicationName;
		details.options['workstationId'] = credentials.workstationId;
		details.options['applicationIntent'] = credentials.applicationIntent;
		details.options['currentLanguage'] = credentials.currentLanguage;
		details.options['pooling'] = credentials.pooling;
		details.options['maxPoolSize'] = credentials.maxPoolSize;
		details.options['minPoolSize'] = credentials.minPoolSize;
		details.options['loadBalanceTimeout'] = credentials.loadBalanceTimeout;
		details.options['replication'] = credentials.replication;
		details.options['attachDbFilename'] = credentials.attachDbFilename;
		details.options['failoverPartner'] = credentials.failoverPartner;
		details.options['multiSubnetFailover'] = credentials.multiSubnetFailover;
		details.options['multipleActiveResultSets'] = credentials.multipleActiveResultSets;
		details.options['packetSize'] = credentials.packetSize;
		details.options['typeSystemVersion'] = credentials.typeSystemVersion;

		return details;
	}

	// Detect if a given value is a server name or a connection string, and assign the result accordingly
	private static processServerOrConnectionString(value: string, credentials: IConnectionInfo): void {
		// If the value contains a connection string server name key, assume it is a connection string
		const dataSourceKeys = ['data source=', 'server=', 'address=', 'addr=', 'network address='];
		let isConnectionString = dataSourceKeys.some(key => value.toLowerCase().indexOf(key) !== -1);

		if (isConnectionString) {
			credentials.connectionString = value;
		} else {
			credentials.server = value;
		}
	}

	private static shouldPromptForUser(credentials: IConnectionInfo): boolean {
		return utils.isEmpty(credentials.user) && ConnectionCredentials.isPasswordBasedCredential(credentials);
	}

	// Prompt for password if this is a password based credential and the password for the profile was empty
	// and not explicitly set as empty. If it was explicitly set as empty, only prompt if pw not saved
	public static shouldPromptForPassword(credentials: IConnectionInfo): boolean {
		let isSavedEmptyPassword: boolean | undefined = (<IConnectionProfile>credentials).emptyPasswordInput
			&& (<IConnectionProfile>credentials).savePassword;

		return utils.isEmpty(credentials.password)
			&& ConnectionCredentials.isPasswordBasedCredential(credentials)
			&& !isSavedEmptyPassword;

	}

	public static isPasswordBasedCredential(credentials: IConnectionInfo): boolean {
		// TODO consider enum based verification and handling of AD auth here in the future
		let authenticationType = credentials.authenticationType;
		if (typeof credentials.authenticationType === 'undefined') {
			authenticationType = utils.authTypeToString(AuthenticationTypes.SqlLogin);
		}
		return authenticationType === utils.authTypeToString(AuthenticationTypes.SqlLogin);
	}

	public static isPasswordBasedConnectionString(connectionString: string): boolean {
		const connString = connectionString.toLowerCase();
		return connString.includes('user') &&
			connString.includes('password') &&
			!connString.includes('Integrated Security');
	}

	// Validates a string is not empty, returning undefined if true and an error message if not
	protected static validateRequiredString(property: string, value: string): string | undefined {
		if (utils.isEmpty(value)) {
			return property + LocalizedConstants.msgIsRequired;
		}
		return undefined;
	}
}

