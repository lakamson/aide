/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { OpenAI } from 'openai';
import { encode } from 'gpt-tokenizer';


const chatSystemPrompt = (agentCustomInstruction: string | null): string => {
	if (agentCustomInstruction) {
		return `
Your name is CodeStory bot. You are a brilliant and meticulous engineer assigned to help the user with any query they have. When you write code, the code works on the first try and is formatted perfectly. You can be asked to explain the code, in which case you should use the context you know to help the user out. You have the utmost care for the code that you write, so you do not make mistakes. Take into account the current repository\'s language, frameworks, and dependencies. You must always use markdown when referring to code symbols.
You are given some additional context about the codebase and instructions by the user below, follow them to better help the user
${agentCustomInstruction}
		`;
	} else {
		return 'Your name is CodeStory bot. You are a brilliant and meticulous engineer assigned to help the user with any query they have. When you write code, the code works on the first try and is formatted perfectly. You can be asked to explain the code, in which case you should use the context you know to help the user out. You have the utmost care for the code that you write, so you do not make mistakes. Take into account the current repository\'s language, frameworks, and dependencies. You must always use markdown when referring to code symbols.';
	}
};


type RoleString = 'system' | 'user' | 'assistant' | undefined;
type RoleStringForOpenai = 'system' | 'user' | 'assistant' | 'function';


const convertRoleToString = (role: RoleStringForOpenai): RoleString => {
	switch (role) {
		case 'system':
			return 'system';
		case 'user':
			return 'user';
		case 'assistant':
			return 'assistant';
		default:
			return undefined;
	}
};


export class CSChatState implements vscode.ChatAgentContext {
	history: OpenAI.Chat.CreateChatCompletionRequestMessage[];

	private _tokenLimit: number;
	private _agentCustomInstruction: string | null;

	constructor(agentCustomInstruction: string | null) {
		this.history = [];
		this._tokenLimit = 1000;
		this._agentCustomInstruction = agentCustomInstruction;
		this.addSystemPrompt(
			agentCustomInstruction,
		);
	}

	cleanupChatHistory(): void {
		// we want to do the following:
		// we want to have atleast 1k tokens for the completion
		// we will obviously need the system prompt so we will always keep that
		// after that going backwards we will store the messages(user + assistant) until we reach 6k tokens
		// we will then remove the rest of the messages
		const messages = this.history.map((message) => {
			return {
				role: convertRoleToString(message.role),
				content: message.content ?? '',
			};
		});
		const finalMessages: OpenAI.Chat.CreateChatCompletionRequestMessage[] = [];
		const maxTokenLimit = 6000;
		// Now we walk backwards
		let totalTokenCount = encode(chatSystemPrompt(this._agentCustomInstruction)).length;
		for (let index = messages.length - 1; index > 0; index--) {
			const message = messages[index];
			const messageTokenCount = encode(message.content).length;
			if (totalTokenCount + messageTokenCount > maxTokenLimit) {
				break;
			}
			totalTokenCount += messageTokenCount;
			finalMessages.push(this.history[index]);
		}
		finalMessages.push(
			{
				role: 'system',
				content: chatSystemPrompt(this._agentCustomInstruction),
			}
		);
		finalMessages.reverse();
		this.history = finalMessages;
	}

	getMessages(): OpenAI.Chat.CreateChatCompletionRequestMessage[] {
		return this.history;
	}

	getMessageLength(): number {
		return this.history.length;
	}

	addSystemPrompt(agentCustomInstruction: string | null): void {
		this.history.push({
			role: 'system',
			content: chatSystemPrompt(agentCustomInstruction),
		});
	}

	addUserMessage(message: string): void {
		this.history.push({
			role: 'user',
			content: message,
		});
	}

	removeLastMessage(): void {
		this.history.pop();
	}

	addCodeStoryMessage(message: string): void {
		this.history.push({
			role: 'assistant',
			content: message,
		});
	}

	addCodeContext(codeContext: string, extraSurroundingContext: string): void {
		this.history.push({
			role: 'user',
			content: `
The code in question is the following:
<code_context>
${codeContext}
</code_context>

The surrounding code for the code in question is the following:
<code_context_surrounding>
${extraSurroundingContext}
</code_context_surrounding>
			`,
		});
	}

	addExplainCodeContext(codeContext: string): void {
		this.history.push({
			role: 'user',
			content: codeContext,
		});
	}
}
