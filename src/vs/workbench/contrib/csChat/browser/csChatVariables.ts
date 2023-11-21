/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { onUnexpectedExternalError } from 'vs/base/common/errors';
import { Iterable } from 'vs/base/common/iterator';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ICSChatWidgetService } from 'vs/workbench/contrib/csChat/browser/csChat';
import { ChatDynamicReferenceModel } from 'vs/workbench/contrib/csChat/browser/contrib/csChatDynamicReferences';
import { IChatModel } from 'vs/workbench/contrib/csChat/common/csChatModel';
import { IParsedChatRequest, ChatRequestVariablePart, ChatRequestDynamicReferencePart } from 'vs/workbench/contrib/csChat/common/csChatParserTypes';
import { ICSChatVariablesService, ICSChatRequestVariableValue, ICSChatVariableData, IChatVariableResolver, IChatVariableResolveResult, IDynamicReference } from 'vs/workbench/contrib/csChat/common/csChatVariables';

interface IChatData {
	data: ICSChatVariableData;
	resolver: IChatVariableResolver;
}

export class ChatVariablesService implements ICSChatVariablesService {
	declare _serviceBrand: undefined;

	private _resolver = new Map<string, IChatData>();

	constructor(
		@ICSChatWidgetService private readonly chatWidgetService: ICSChatWidgetService
	) {
	}

	async resolveVariables(prompt: IParsedChatRequest, model: IChatModel, token: CancellationToken): Promise<IChatVariableResolveResult> {
		const resolvedVariables: Record<string, ICSChatRequestVariableValue[]> = {};
		const jobs: Promise<any>[] = [];

		const parsedPrompt: string[] = [];
		prompt.parts
			.forEach((part, i) => {
				if (part instanceof ChatRequestVariablePart) {
					const data = this._resolver.get(part.variableName.toLowerCase());
					if (data) {
						jobs.push(data.resolver(prompt.text, part.variableArg, model, token).then(value => {
							if (value) {
								resolvedVariables[part.variableName] = value;
								parsedPrompt[i] = `[${part.text}](values:${part.variableName})`;
							} else {
								parsedPrompt[i] = part.promptText;
							}
						}).catch(onUnexpectedExternalError));
					}
				} else if (part instanceof ChatRequestDynamicReferencePart) {
					// Maybe the dynamic reference should include a full IChatRequestVariableValue[] at the time it is inserted?
					resolvedVariables[part.referenceText] = [{ level: 'full', value: JSON.stringify({ uri: part.data.uri.toString(), range: part.data.range }) }];
					parsedPrompt[i] = part.promptText;
				} else {
					parsedPrompt[i] = part.promptText;
				}
			});

		await Promise.allSettled(jobs);

		return {
			variables: resolvedVariables,
			prompt: parsedPrompt.join('').trim()
		};
	}

	hasVariable(name: string): boolean {
		return this._resolver.has(name.toLowerCase());
	}

	getVariables(): Iterable<Readonly<ICSChatVariableData>> {
		const all = Iterable.map(this._resolver.values(), data => data.data);
		return Iterable.filter(all, data => !data.hidden);
	}

	getDynamicReferences(sessionId: string): ReadonlyArray<IDynamicReference> {
		// This is slightly wrong... the parser pulls dynamic references from the input widget, but there is no guarantee that message came from the input here.
		// Need to ...
		// - Parser takes list of dynamic references (annoying)
		// - Or the parser is known to implicitly act on the input widget, and we need to call it before calling the chat service (maybe incompatible with the future, but easy)
		const widget = this.chatWidgetService.getWidgetBySessionId(sessionId);
		if (!widget || !widget.viewModel || !widget.supportsFileReferences) {
			return [];
		}

		const model = widget.getContrib<ChatDynamicReferenceModel>(ChatDynamicReferenceModel.ID);
		if (!model) {
			return [];
		}

		return model.references;
	}

	registerVariable(data: ICSChatVariableData, resolver: IChatVariableResolver): IDisposable {
		const key = data.name.toLowerCase();
		if (this._resolver.has(key)) {
			throw new Error(`A chat variable with the name '${data.name}' already exists.`);
		}
		this._resolver.set(key, { data, resolver });
		return toDisposable(() => {
			this._resolver.delete(key);
		});
	}
}
