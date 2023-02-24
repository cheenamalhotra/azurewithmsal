// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { MainController } from './controllers/mainController';
import VscodeWrapper from './controllers/vscodeWrapper';

let controller: MainController;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	controller = new MainController(context, new VscodeWrapper());
	controller.activate();
}

// This method is called when your extension is deactivated
export function deactivate() {
	controller.dispose();
}
