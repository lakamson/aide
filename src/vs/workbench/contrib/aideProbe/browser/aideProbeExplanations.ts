/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MarkdownString } from 'vs/base/common/htmlContent';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { ICodeEditor, isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { MarkdownRenderer } from 'vs/editor/browser/widget/markdownRenderer/browser/markdownRenderer';
import { Position } from 'vs/editor/common/core/position';
import { IRange } from 'vs/editor/common/core/range';
import { ScrollType } from 'vs/editor/common/editorCommon';
import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { editorFindMatch, editorFindMatchForeground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ChatMarkdownRenderer } from 'vs/workbench/contrib/aideChat/browser/aideChatMarkdownRenderer';
import { AideProbeExplanationWidget } from 'vs/workbench/contrib/aideProbe/browser/aideProbeExplanationWidget';
import { IAideProbeBreakdownViewModel } from 'vs/workbench/contrib/aideProbe/browser/aideProbeViewModel';
import { symbolDecorationClass, symbolDecoration } from 'vs/workbench/contrib/aideProbe/browser/contrib/aideProbeDecorations';
import { IAideProbeService } from 'vs/workbench/contrib/aideProbe/common/aideProbeService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

export const IAideProbeExplanationService = createDecorator<IAideProbeExplanationService>('IAideProbeExplanationService');

export interface IAideProbeExplanationService {
	_serviceBrand: undefined;

	changeActiveBreakdown(content: IAideProbeBreakdownViewModel): void;
	clear(): void;
}

export class AideProbeExplanationService extends Disposable implements IAideProbeExplanationService {
	declare _serviceBrand: undefined;

	private readonly markdownRenderer: MarkdownRenderer;
	private explanationWidget: AideProbeExplanationWidget | undefined;
	private activeCodeEditor: ICodeEditor | undefined;

	constructor(
		@IAideProbeService private readonly aideProbeService: IAideProbeService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@IEditorService private readonly editorService: IEditorService,
		@IThemeService private readonly themeService: IThemeService
	) {
		super();

		this.markdownRenderer = this.instantiationService.createInstance(ChatMarkdownRenderer, undefined);

		this._register(this.themeService.onDidColorThemeChange(() => this.updateRegisteredDecorationTypes()));
		this._register(this.editorService.onDidActiveEditorChange(() => this.updateDecorations()));
		this.updateRegisteredDecorationTypes();
	}

	private async openCodeEditor(uri: URI, selection?: IRange): Promise<ICodeEditor | null> {
		const editor = await this.codeEditorService.openCodeEditor({
			resource: uri,
			options: { pinned: false, preserveFocus: true }
		}, null);

		if (editor && selection) {
			editor.revealLineNearTop(selection.startLineNumber || 1, ScrollType.Smooth);
		}

		return editor;
	}

	async changeActiveBreakdown(element: IAideProbeBreakdownViewModel): Promise<void> {
		const { uri } = element;
		this.explanationWidget?.hide();
		this.explanationWidget?.dispose();

		let codeEditor: ICodeEditor | null;
		let breakdownPosition: Position = new Position(1, 300);

		const symbol = await element.symbol;
		if (!symbol) {
			codeEditor = await this.openCodeEditor(uri);
		} else {
			breakdownPosition = new Position(symbol.range.startLineNumber - 1, symbol.range.startColumn);
			codeEditor = await this.openCodeEditor(uri, symbol.range);
		}

		if (codeEditor && symbol && breakdownPosition) {
			this.explanationWidget = this._register(this.instantiationService.createInstance(
				AideProbeExplanationWidget, codeEditor, this.markdownRenderer
			));
			await this.explanationWidget.setBreakdown(element);
			this.explanationWidget.show();
			this.explanationWidget.showProbingSymbols(symbol);
		}
	}

	private updateRegisteredDecorationTypes() {
		this.codeEditorService.removeDecorationType(symbolDecorationClass);

		const theme = this.themeService.getColorTheme();
		this.codeEditorService.registerDecorationType(symbolDecorationClass, symbolDecoration, {
			color: theme.getColor(editorFindMatchForeground)?.toString(),
			backgroundColor: theme.getColor(editorFindMatch)?.toString(),
			borderRadius: '3px'
		});
		this.updateDecorations();
	}

	private updateDecorations() {
		this.activeCodeEditor?.removeDecorationsByType(symbolDecoration);
		const activeSession = this.aideProbeService.getSession();
		if (!activeSession) {
			return;
		}

		const activeEditor = this.editorService.activeTextEditorControl;
		if (isCodeEditor(activeEditor)) {
			this.activeCodeEditor = activeEditor;
			const uri = activeEditor.getModel()?.uri;
			if (!uri) {
				return;
			}

			const matchingDefinitions = activeSession.response?.goToDefinitions.filter(definition => definition.uri.fsPath === uri.fsPath) ?? [];
			for (const decoration of matchingDefinitions) {
				activeEditor.setDecorationsByType(symbolDecorationClass, symbolDecoration, [
					{
						range: {
							...decoration.range,
							endColumn: decoration.range.endColumn + 1
						},
						hoverMessage: new MarkdownString(decoration.thinking),
					}
				]);
			}
		}
	}

	clear(): void {
		this.explanationWidget?.clear();
		this.explanationWidget?.hide();
		this.explanationWidget?.dispose();
		this.updateDecorations();
	}
}
