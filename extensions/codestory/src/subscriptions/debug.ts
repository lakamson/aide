/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { v4 as uuidv4 } from 'uuid';
import { commands, env } from 'vscode';
import { EmbeddingsSearch } from '../searchIndex/embeddingsSearch';
import { CodeGraph } from '../codeGraph/graph';
import { MessageHandlerData } from '@estruyf/vscode';
import { debuggingFlow } from '../llm/recipe/debugging';
import { ToolingEventCollection } from '../timeline/events/collection';
import logger from '../logger';
import { PromptState } from '../types';
import postHogClient from '../posthog/client';
import { ActiveFilesTracker } from '../activeChanges/activeFilesTracker';
import { CSChatProvider } from '../providers/chatprovider';
import { CodeSymbolsLanguageCollection } from '../languages/codeSymbolsLanguageCollection';
import { SearchIndexCollection } from '../searchIndex/collection';

export const debug = (
	csChatProvider: CSChatProvider,
	searchIndexCollection: SearchIndexCollection,
	codeSymbolsLanguageCollection: CodeSymbolsLanguageCollection,
	repoName: string,
	repoHash: string,
	workingDirectory: string,
	testSuiteRunCommand: string,
	activeFilesTracker: ActiveFilesTracker,
	uniqueUserId: string,
	agentCustomInstruction: string | null,
) => {
	const uniqueId = uuidv4();
	return commands.registerCommand(
		'codestory.debug',
		async ({ payload, ...message }: MessageHandlerData<PromptState>) => {
			logger.info('[CodeStory] Debugging');
			logger.info(payload);
			const toolingEventCollection = new ToolingEventCollection(
				`/tmp/${uniqueId}`,
				undefined,
				message.command,
			);
			try {
				postHogClient.capture({
					distinctId: uniqueUserId,
					event: 'debug_prompt_received',
					properties: {
						prompt: payload.prompt,
						repoName,
						repoHash,
					},
				});
				await debuggingFlow(
					payload.prompt,
					toolingEventCollection,
					searchIndexCollection,
					codeSymbolsLanguageCollection,
					workingDirectory,
					testSuiteRunCommand,
					activeFilesTracker,
					undefined,
					uniqueId,
					agentCustomInstruction,
				);
			} catch (e) {
				logger.info('[CodeStory] Debugging failed');
				logger.error(e);
			}
		}
	);
};
