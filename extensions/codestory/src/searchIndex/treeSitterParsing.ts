/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


// Create a tree-sitter parser collection which loads the relevant wasm files
// as required or says that they don't exist
import * as path from 'path';
import * as fs from 'fs';
import { CodeSnippetInformation, Span } from '../utilities/types';
const Parser = require('web-tree-sitter');

const extensionToLanguageMap: Map<string, string> = new Map([
	['go', 'golang'],
	['py', 'python'],
	['js', 'typescript'],
	['ts', 'typescript'],
	['tsx', 'typescript'],
	['jsx', 'typescript'],
	['rb', 'ruby'],
	['cpp', 'cpp'],
]);

export class TreeSitterParserCollection {
	private _treeSitterParsers: Map<string, any>;
	private _triedToInitialize: Map<string, boolean>;
	constructor() {
		this._treeSitterParsers = new Map();
		this._triedToInitialize = new Map();
	}

	async addParserForExtension(fileExtension: string): Promise<void> {
		this._triedToInitialize.set(fileExtension, true);
		if (this._treeSitterParsers.has(fileExtension)) {
			return;
		}
		const language = extensionToLanguageMap.get(fileExtension);
		if (!language) {
			return;
		}
		try {
			await Parser.init();
			const parser = new Parser();
			const filePath = path.join(__dirname, 'treeSitterWasm', (`tree-sitter-${language}.wasm`));
			const languageParser = await Parser.Language.load(filePath);
			parser.setLanguage(languageParser);
			this._treeSitterParsers.set(fileExtension, parser);
		} catch (e) {
			console.log(e);
		}
	}

	async getParserForExtension(fileExtension: string): Promise<any | null> {
		if (!this._triedToInitialize.has(fileExtension)) {
			await this.addParserForExtension(fileExtension);
		}
		return this._treeSitterParsers.get(fileExtension);
	}
}

function nonWhitespaceLen(s: string): number {
	return s.replace(/\s/g, '').length;
}

function getLineNumber(index: number, sourceCode: string): number {
	let totalChars = 0;
	const lines = sourceCode.split('\n');
	for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
		totalChars += lines[lineNumber].length;
		if (totalChars > index) {
			return lineNumber;
		}
	}
	return lines.length;
}

// This is the most important function here, where we generate spans from the
// code using tree-sitter to power the search
function chunkTree(tree: any, sourceCode: string, MAX_CHARS = 512 * 3, coalesce = 50): Span[] {
	// 1. Recursively form chunks based on the last post(https://docs.sweep.dev/blogs/chunking-2m-files)
	function chunkNode(node: any): {
		chunks: Span[];
		currentChunk: Span;
	} {
		const chunks: Span[] = [];
		let currentChunk: Span = new Span(node.startIndex, node.startIndex);
		const nodeChildren = node.children;
		for (const child of nodeChildren) {
			if (child.endIndex - child.startIndex > MAX_CHARS) {
				chunks.push(currentChunk);
				currentChunk = new Span(child.endIndex, child.endIndex);
				chunks.push(...chunkNode(child).chunks);
			} else if (child.endIndex - child.startIndex + (currentChunk.end - currentChunk.start) > MAX_CHARS) {
				chunks.push(currentChunk);
				currentChunk = new Span(child.startIndex, child.endIndex);
			} else {
				currentChunk = new Span(currentChunk.start, child.endIndex);
			}
		}
		console.log(currentChunk.start, currentChunk.end);
		chunks.push(currentChunk);
		return {
			chunks,
			currentChunk
		};
	}

	const chunkNodeOutput = chunkNode(tree.rootNode);
	const chunks = chunkNodeOutput.chunks;
	// const currentChunk = chunkNodeOutput.currentChunk;

	// 2. Filling in the gaps
	if (chunks.length === 0) {
		return [];
	}
	if (chunks.length < 2) {
		return [new Span(0, chunks[0].end - chunks[0].start)];
	}
	for (let i = 0; i < chunks.length - 1; i++) {
		chunks[i].end = chunks[i + 1].start;
	}

	// 3. Combining small chunks with bigger ones
	const newChunks = [];
	let currentChunk: Span = new Span(0, 0);
	for (const chunk of chunks) {
		currentChunk = new Span(currentChunk.start, chunk.end);
		if (nonWhitespaceLen(currentChunk.extract(sourceCode)) > coalesce && sourceCode.slice(currentChunk.start, currentChunk.end).includes('\n')) {
			newChunks.push(currentChunk);
			currentChunk = new Span(chunk.end, chunk.end);
		}
	}
	if (currentChunk.end - currentChunk.start > 0) {
		newChunks.push(currentChunk);
	}

	// 4. Changing line numbers and Eliminating empty chunks
	const lineChunks = newChunks.map(chunk => {
		return new Span(
			getLineNumber(chunk.start, sourceCode),
			getLineNumber(chunk.end, sourceCode),
		);
	}).filter(chunk => chunk.end - chunk.start > 0);

	// 5. Coalescing last chunk if it's too small
	if (lineChunks.length > 0 && lineChunks[lineChunks.length - 1].end - lineChunks[lineChunks.length - 1].start < coalesce) {
		lineChunks[lineChunks.length - 2].end = lineChunks[lineChunks.length - 1].end;
		lineChunks.pop();
	}

	return lineChunks;
}


// If we can't parse it using tree-sitter, the best fallback is to use
// line-based chunking instead and get it to work.
// peak #m clowntown
const MAX_LINES_FOR_SPLIT = 30;
const MAX_OVERLAP = 15;

function lineBasedChunking(
	code: string,
	lineCount: number = MAX_LINES_FOR_SPLIT,
	overlap: number = MAX_OVERLAP,
): string[] {
	if (overlap >= lineCount) {
		throw new Error('Overlap should be smaller than lineCount.');
	}

	const lines = code.split('\n');
	const totalLines = lines.length;
	const chunks: string[] = [];

	let start = 0;
	while (start < totalLines) {
		const end = Math.min(start + lineCount, totalLines);
		const chunk = lines.slice(start, end).join('\n');
		chunks.push(chunk);
		start += lineCount - overlap;
	}

	return chunks;
}


export const chunkCodeFile = async (
	filePath: string,
	maxCharacters: number,
	coalesce: number,
	treeSitterParserCollection: TreeSitterParserCollection,
): Promise<CodeSnippetInformation[]> => {
	// Now we are going to pick the relevant tree-sitter library here and ship
	// that instead.
	// We want to get the tree-sitter wasm libraries for as many languages as we
	// can and keep them at the same place so we can do span based chunking
	// and power our search
	const fileExtension = path.extname(filePath).slice(1);
	const code = await fs.promises.readFile(filePath, 'utf-8');
	const parser = await treeSitterParserCollection.getParserForExtension(fileExtension);
	if (parser === null) {
		// we fallback to the naive model
		const chunks = lineBasedChunking(
			code,
			maxCharacters,
			coalesce,
		);
		const snippets: CodeSnippetInformation[] = [];
		for (let index = 0; index < chunks.length; index++) {
			snippets.push(new CodeSnippetInformation(
				chunks[index],
				index * 30,
				(index + 1) * 30,
				filePath,
				null,
				null,
				null,
				null,
			));
		}
		return snippets;
	} else {
		const parsedNode = parser.parse(code);
		const chunks = chunkTree(parsedNode, code, maxCharacters, coalesce);
		// convert this span to snippets now
		const snippets = chunks.map((chunk) => {
			return new CodeSnippetInformation(
				chunk.extractLines(code),
				chunk.start,
				chunk.end,
				filePath,
				null,
				null,
				null,
				null,
			);
		});
		return snippets;
	}
};


// void (async () => {
// 	const treeSitterParserCollection = new TreeSitterParserCollection();
// 	const snippets = await chunkCodeFile(
// 		'/Users/skcd/scratch/ide/extensions/codestory/src/searchIndex/treeSitterParsing.ts',
// 		1500,
// 		100,
// 		treeSitterParserCollection,
// 	);
// 	console.log(snippets);
// })();
