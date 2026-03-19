//#region src/tokenizer/charsets.ts
const operatorChars = new Set([
	";",
	"|",
	"&"
]);
const redirChars = new Set([">", "<"]);
const symbolChars = new Set([
	"(",
	")",
	"{",
	"}"
]);
const isDigit = (value) => value >= "0" && value <= "9";
const isNameChar = (c) => c >= "a" && c <= "z" || c >= "A" && c <= "Z" || c >= "0" && c <= "9" || c === "_";
const isNameStart = (c) => c >= "a" && c <= "z" || c >= "A" && c <= "Z" || c === "_";
const specialParams = new Set([
	"@",
	"*",
	"#",
	"?",
	"-",
	"$",
	"!"
]);

//#endregion
//#region src/tokenizer/scan-backtick.ts
function scanBacktick(source, pos) {
	let j = pos + 1;
	while (j < source.length && source.charAt(j) !== "`") {
		if (source.charAt(j) === "\\") j++;
		j++;
	}
	return {
		part: {
			type: "backtick",
			raw: source.slice(pos + 1, j)
		},
		end: j + 1
	};
}

//#endregion
//#region src/tokenizer/scan-expansion.ts
function scanExpansion(source, pos) {
	if (source.charAt(pos) !== "$") return null;
	const next = source.charAt(pos + 1);
	if (next === "(" && source.charAt(pos + 2) === "(") {
		let j = pos + 3;
		let depth = 0;
		while (j < source.length) {
			if (source.charAt(j) === ")" && source.charAt(j + 1) === ")" && depth === 0) break;
			if (source.charAt(j) === "(") depth++;
			if (source.charAt(j) === ")") depth--;
			j++;
		}
		return {
			part: {
				type: "arith-exp",
				raw: source.slice(pos + 3, j).trim()
			},
			end: j + 2
		};
	}
	if (next === "(") {
		let j = pos + 2;
		let depth = 1;
		while (j < source.length && depth > 0) {
			if (source.charAt(j) === "(") depth++;
			if (source.charAt(j) === ")") depth--;
			j++;
		}
		return {
			part: {
				type: "cmd-subst",
				raw: source.slice(pos + 2, j - 1)
			},
			end: j
		};
	}
	if (next === "{") {
		let j = pos + 2;
		let depth = 1;
		while (j < source.length && depth > 0) {
			if (source.charAt(j) === "{") depth++;
			if (source.charAt(j) === "}") depth--;
			j++;
		}
		const inner = source.slice(pos + 2, j - 1);
		let nameEnd = 0;
		let prefix = "";
		if (inner.charAt(0) === "!" || inner.charAt(0) === "#") {
			prefix = inner.charAt(0);
			nameEnd = 1;
		}
		while (nameEnd < inner.length && isNameChar(inner.charAt(nameEnd))) nameEnd++;
		const name = inner.slice(prefix ? 1 : 0, nameEnd);
		const rest = inner.slice(nameEnd);
		if (rest.length > 0) {
			const opMatch = rest.match(/^(:-|:=|:\+|:\?|-|\+|=|\?|##|%%|#|%|\/\/|\/)/);
			if (opMatch) {
				const op = opMatch[0];
				return {
					part: {
						type: "param",
						name,
						braced: true,
						op,
						value: rest.slice(op.length)
					},
					end: j
				};
			}
			return {
				part: {
					type: "param",
					name: inner,
					braced: true
				},
				end: j
			};
		}
		return {
			part: {
				type: "param",
				name,
				braced: true
			},
			end: j
		};
	}
	if (isNameStart(next)) {
		let j = pos + 2;
		while (j < source.length && isNameChar(source.charAt(j))) j++;
		return {
			part: {
				type: "param",
				name: source.slice(pos + 1, j),
				braced: false
			},
			end: j
		};
	}
	if (isDigit(next)) return {
		part: {
			type: "param",
			name: next,
			braced: false
		},
		end: pos + 2
	};
	if (specialParams.has(next)) return {
		part: {
			type: "param",
			name: next,
			braced: false
		},
		end: pos + 2
	};
	return null;
}

//#endregion
//#region src/tokenizer/scan-redir.ts
function tryRedirOp(source, pos) {
	if (source.startsWith("<<<", pos)) return {
		op: "<<<",
		len: 3
	};
	if (source.startsWith("&>>", pos)) return {
		op: "&>>",
		len: 3
	};
	if (source.startsWith("<<-", pos)) return {
		op: "<<-",
		len: 3
	};
	if (source.startsWith(">>", pos)) return {
		op: ">>",
		len: 2
	};
	if (source.startsWith(">&", pos)) return {
		op: ">&",
		len: 2
	};
	if (source.startsWith(">|", pos)) return {
		op: ">|",
		len: 2
	};
	if (source.startsWith("<>", pos)) return {
		op: "<>",
		len: 2
	};
	if (source.startsWith("<&", pos)) return {
		op: "<&",
		len: 2
	};
	if (source.startsWith("&>", pos)) return {
		op: "&>",
		len: 2
	};
	if (source.startsWith("<<", pos)) return {
		op: "<<",
		len: 2
	};
	if (source.charAt(pos) === ">") return {
		op: ">",
		len: 1
	};
	if (source.charAt(pos) === "<") return {
		op: "<",
		len: 1
	};
	return null;
}

//#endregion
//#region src/tokenizer/utils.ts
function tokenPartsText(parts) {
	return parts.map((p) => {
		if (p.type === "lit") return p.value;
		if (p.type === "sgl") return p.value;
		if (p.type === "dbl") return p.parts.map((dp) => dp.type === "lit" ? dp.value : "").join("");
		return "";
	}).join("");
}

//#endregion
//#region src/tokenizer/tokenize.ts
function tokenize(source, options = {}) {
	const tokens = [];
	let i = 0;
	let atBoundary = true;
	while (i < source.length) {
		const ch = source.charAt(i);
		if (ch === " " || ch === "	" || ch === "\r") {
			atBoundary = true;
			i += 1;
			continue;
		}
		if (ch === "\\" && source.charAt(i + 1) === "\n") {
			atBoundary = true;
			i += 2;
			continue;
		}
		if (ch === "\\" && source.charAt(i + 1) === "\r") {
			if (source.charAt(i + 2) === "\n") {
				atBoundary = true;
				i += 3;
				continue;
			}
		}
		if (ch === "\n") {
			tokens.push({
				type: "op",
				value: ";"
			});
			atBoundary = true;
			i += 1;
			const pendingHeredocs = [];
			for (let ti = 0; ti < tokens.length; ti++) {
				const t = tokens[ti];
				if (t && t.type === "redir" && (t.op === "<<" || t.op === "<<-") && !Object.hasOwn(t, "_collected")) {
					const delimTok = tokens[ti + 1];
					if (delimTok && delimTok.type === "word") {
						pendingHeredocs.push({
							strip: t.op === "<<-",
							delimiter: tokenPartsText(delimTok.parts)
						});
						t._collected = true;
					}
				}
			}
			for (const hd of pendingHeredocs) {
				let body = "";
				while (i < source.length) {
					let lineEnd = source.indexOf("\n", i);
					if (lineEnd === -1) lineEnd = source.length;
					const line = source.slice(i, lineEnd);
					const checkLine = hd.strip ? line.replace(/^\t+/, "") : line;
					i = lineEnd < source.length ? lineEnd + 1 : lineEnd;
					if (checkLine === hd.delimiter) break;
					const processedLine = hd.strip ? line.replace(/^\t+/, "") : line;
					body += `${processedLine}\n`;
				}
				tokens.push({
					type: "heredoc-body",
					content: body
				});
			}
			continue;
		}
		if (ch === "#" && atBoundary) {
			const start = i + 1;
			i += 1;
			while (i < source.length && source.charAt(i) !== "\n") i += 1;
			if (options.keepComments) tokens.push({
				type: "comment",
				text: source.slice(start, i)
			});
			continue;
		}
		if (ch === "!" && atBoundary) {
			tokens.push({
				type: "op",
				value: "!"
			});
			atBoundary = true;
			i += 1;
			continue;
		}
		if (isDigit(ch)) {
			let j = i;
			while (j < source.length && isDigit(source.charAt(j))) j += 1;
			const redir = tryRedirOp(source, j);
			if (redir) {
				tokens.push({
					type: "redir",
					op: redir.op,
					fd: source.slice(i, j)
				});
				i = j + redir.len;
				atBoundary = true;
				continue;
			}
		}
		if (ch === "(" && source.charAt(i + 1) === "(" && atBoundary) {
			let j = i + 2;
			let depth = 0;
			while (j < source.length) {
				const c = source.charAt(j);
				if (c === ")" && source.charAt(j + 1) === ")" && depth === 0) break;
				if (c === "(") depth++;
				if (c === ")") depth--;
				j++;
			}
			tokens.push({
				type: "arith-cmd",
				expr: source.slice(i + 2, j).trim()
			});
			i = j + 2;
			atBoundary = true;
			continue;
		}
		if ((ch === "<" || ch === ">") && source.charAt(i + 1) === "(" && atBoundary) {
			const op = ch;
			let j = i + 2;
			let depth = 1;
			while (j < source.length && depth > 0) {
				if (source.charAt(j) === "(") depth++;
				if (source.charAt(j) === ")") depth--;
				j++;
			}
			const raw = source.slice(i + 2, j - 1);
			tokens.push({
				type: "word",
				parts: [{
					type: "proc-subst",
					op,
					raw
				}]
			});
			i = j;
			atBoundary = false;
			continue;
		}
		{
			const redir = tryRedirOp(source, i);
			if (redir) {
				tokens.push({
					type: "redir",
					op: redir.op
				});
				i += redir.len;
				atBoundary = true;
				continue;
			}
		}
		if (symbolChars.has(ch)) {
			tokens.push({
				type: "symbol",
				value: ch
			});
			atBoundary = true;
			i += 1;
			continue;
		}
		if (source.startsWith("&&", i)) {
			tokens.push({
				type: "op",
				value: "&&"
			});
			atBoundary = true;
			i += 2;
			continue;
		}
		if (source.startsWith("||", i)) {
			tokens.push({
				type: "op",
				value: "||"
			});
			atBoundary = true;
			i += 2;
			continue;
		}
		if (operatorChars.has(ch)) {
			tokens.push({
				type: "op",
				value: ch
			});
			atBoundary = true;
			i += 1;
			continue;
		}
		const parts = [];
		let current = "";
		const flushLit = () => {
			if (current.length > 0) {
				parts.push({
					type: "lit",
					value: current
				});
				current = "";
			}
		};
		while (i < source.length) {
			const currentChar = source.charAt(i);
			if (currentChar === "\\" && source.charAt(i + 1) === "\n") {
				i += 2;
				continue;
			}
			if (currentChar === "\\" && source.charAt(i + 1) === "\r") {
				if (source.charAt(i + 2) === "\n") {
					i += 3;
					continue;
				}
			}
			if (currentChar === " " || currentChar === "	" || currentChar === "\r" || currentChar === "\n" || operatorChars.has(currentChar) || redirChars.has(currentChar) || symbolChars.has(currentChar)) break;
			if (currentChar === "'") {
				flushLit();
				i += 1;
				const start = i;
				while (i < source.length && source.charAt(i) !== "'") i += 1;
				if (i >= source.length) throw new Error("Unclosed single quote");
				parts.push({
					type: "sgl",
					value: source.slice(start, i)
				});
				i += 1;
				continue;
			}
			if (currentChar === "\"") {
				flushLit();
				i += 1;
				const dblParts = [];
				let dblBuf = "";
				const flushDblLit = () => {
					if (dblBuf.length > 0) {
						dblParts.push({
							type: "lit",
							value: dblBuf
						});
						dblBuf = "";
					}
				};
				let closed = false;
				while (i < source.length) {
					const dqChar = source.charAt(i);
					if (dqChar === "\\" && source.charAt(i + 1) === "\n") {
						i += 2;
						continue;
					}
					if (dqChar === "\\" && source.charAt(i + 1) === "\r") {
						if (source.charAt(i + 2) === "\n") {
							i += 3;
							continue;
						}
					}
					if (dqChar === "\\" && i + 1 < source.length) {
						dblBuf += dqChar + source.charAt(i + 1);
						i += 2;
						continue;
					}
					if (dqChar === "$") {
						flushDblLit();
						const exp = scanExpansion(source, i);
						if (exp) {
							dblParts.push(exp.part);
							i = exp.end;
							continue;
						}
						dblBuf += dqChar;
						i += 1;
						continue;
					}
					if (dqChar === "`") {
						flushDblLit();
						const bt = scanBacktick(source, i);
						dblParts.push(bt.part);
						i = bt.end;
						continue;
					}
					if (dqChar === "\"") {
						i += 1;
						closed = true;
						break;
					}
					dblBuf += dqChar;
					i += 1;
				}
				if (!closed) throw new Error("Unclosed double quote");
				flushDblLit();
				parts.push({
					type: "dbl",
					parts: dblParts
				});
				continue;
			}
			if (currentChar === "$") {
				flushLit();
				const exp = scanExpansion(source, i);
				if (exp) {
					parts.push(exp.part);
					i = exp.end;
					continue;
				}
				current += currentChar;
				i += 1;
				continue;
			}
			if (currentChar === "`") {
				flushLit();
				const bt = scanBacktick(source, i);
				parts.push(bt.part);
				i = bt.end;
				continue;
			}
			current += currentChar;
			i += 1;
		}
		flushLit();
		if (parts.length === 0) throw new Error("Unexpected character");
		tokens.push({
			type: "word",
			parts
		});
		atBoundary = false;
	}
	return tokens;
}

//#endregion
//#region src/parser/constants.ts
const DECL_KEYWORDS = new Set([
	"declare",
	"local",
	"export",
	"readonly",
	"typeset",
	"nameref"
]);

//#endregion
//#region src/parser/parser.ts
var Parser = class Parser {
	index = 0;
	comments = [];
	constructor(tokens, options = {}) {
		this.tokens = tokens;
		this.options = options;
	}
	parseProgram() {
		const body = [];
		this.skipSeparators();
		while (!this.isEof()) {
			body.push(this.parseStatement());
			this.skipSeparators();
		}
		const program = {
			type: "Program",
			body
		};
		if (this.options.keepComments && this.comments.length > 0) program.comments = this.comments;
		return program;
	}
	assertEof() {
		if (!this.isEof()) {
			const token = this.peek();
			const display = token ? token.type === "op" ? token.value : token.type === "redir" ? token.op : token.type === "symbol" ? token.value : token.type === "arith-cmd" ? "(( ... ))" : token.type === "heredoc-body" ? "<<heredoc>>" : token.type === "comment" ? `#${token.text}` : tokenPartsText(token.parts) : "";
			throw new Error(`Unexpected token: ${display}`);
		}
	}
	parseStatement() {
		let negated = false;
		if (this.matchOp("!")) {
			this.consume();
			negated = true;
		}
		const command = this.parseLogical();
		let background = false;
		if (this.matchOp("&")) {
			this.consume();
			background = true;
		}
		const statement = {
			type: "Statement",
			command
		};
		if (background) statement.background = true;
		if (negated) statement.negated = true;
		return statement;
	}
	parseLogical() {
		let leftCommand = this.parsePipeline();
		while (this.matchOp("&&") || this.matchOp("||")) {
			const opToken = this.consume();
			if (opToken.type !== "op") throw new Error("Expected logical operator");
			const rightCommand = this.parsePipeline();
			leftCommand = {
				type: "Logical",
				op: opToken.value === "&&" ? "and" : "or",
				left: {
					type: "Statement",
					command: leftCommand
				},
				right: {
					type: "Statement",
					command: rightCommand
				}
			};
		}
		return leftCommand;
	}
	parsePipeline() {
		const first = this.parseCommandAtom();
		if (!this.matchOp("|")) return first;
		const commands = [{
			type: "Statement",
			command: first
		}];
		while (this.matchOp("|")) {
			this.consume();
			const next = this.parseCommandAtom();
			commands.push({
				type: "Statement",
				command: next
			});
		}
		return {
			type: "Pipeline",
			commands
		};
	}
	parseCommandAtom() {
		if (this.matchKeyword("if")) return this.parseIfClause();
		if (this.matchKeyword("while")) return this.parseWhileClause(false);
		if (this.matchKeyword("until")) return this.parseWhileClause(true);
		if (this.matchKeyword("for")) return this.parseForOrCStyleLoop();
		if (this.matchKeyword("select")) return this.parseSelectClause();
		if (this.matchKeyword("case")) return this.parseCaseClause();
		if (this.matchKeyword("time")) return this.parseTimeClause();
		if (this.matchKeyword("coproc")) return this.parseCoprocClause();
		if (this.matchKeyword("[[")) return this.parseTestClause();
		if (this.matchKeyword("function") || this.looksLikeFuncDecl()) return this.parseFunctionDecl();
		if (this.matchArithCmd()) return this.consumeArithCmd();
		if (this.matchSymbol("(")) return this.parseSubshell();
		if (this.matchSymbol("{")) return this.parseBlock();
		if (this.matchDeclKeyword()) return this.parseDeclClause();
		if (this.matchKeyword("let")) return this.parseLetClause();
		return this.parseSimpleCommand();
	}
	parseSubshell() {
		this.consumeSymbol("(");
		const body = this.parseStatementList(")");
		this.consumeSymbol(")");
		return {
			type: "Subshell",
			body
		};
	}
	parseBlock() {
		this.consumeSymbol("{");
		const body = this.parseStatementList("}");
		this.consumeSymbol("}");
		return {
			type: "Block",
			body
		};
	}
	parseStatementList(endSymbol) {
		const body = [];
		this.skipSeparators();
		while (!this.matchSymbol(endSymbol)) {
			if (this.isEof()) throw new Error(`Unexpected end of input while looking for ${endSymbol}`);
			body.push(this.parseStatement());
			this.skipSeparators();
		}
		return body;
	}
	parseIfClause() {
		this.consumeKeyword("if");
		const cond = this.parseStatementsUntilKeyword(["then"]);
		this.consumeKeyword("then");
		const thenBranch = this.parseStatementsUntilKeyword([
			"else",
			"elif",
			"fi"
		]);
		let elseBranch;
		if (this.matchKeyword("elif")) elseBranch = [{
			type: "Statement",
			command: this.parseElifClause()
		}];
		else if (this.matchKeyword("else")) {
			this.consumeKeyword("else");
			elseBranch = this.parseStatementsUntilKeyword(["fi"]);
		}
		this.consumeKeyword("fi");
		return elseBranch ? {
			type: "IfClause",
			cond,
			then: thenBranch,
			else: elseBranch
		} : {
			type: "IfClause",
			cond,
			then: thenBranch
		};
	}
	parseElifClause() {
		this.consumeKeyword("elif");
		const cond = this.parseStatementsUntilKeyword(["then"]);
		this.consumeKeyword("then");
		const thenBranch = this.parseStatementsUntilKeyword([
			"else",
			"elif",
			"fi"
		]);
		let elseBranch;
		if (this.matchKeyword("elif")) elseBranch = [{
			type: "Statement",
			command: this.parseElifClause()
		}];
		else if (this.matchKeyword("else")) {
			this.consumeKeyword("else");
			elseBranch = this.parseStatementsUntilKeyword(["fi"]);
		}
		return elseBranch ? {
			type: "IfClause",
			cond,
			then: thenBranch,
			else: elseBranch
		} : {
			type: "IfClause",
			cond,
			then: thenBranch
		};
	}
	parseWhileClause(until) {
		this.consumeKeyword(until ? "until" : "while");
		const cond = this.parseStatementsUntilKeyword(["do"]);
		this.consumeKeyword("do");
		const body = this.parseStatementsUntilKeyword(["done"]);
		this.consumeKeyword("done");
		return until ? {
			type: "WhileClause",
			cond,
			body,
			until: true
		} : {
			type: "WhileClause",
			cond,
			body
		};
	}
	parseForOrCStyleLoop() {
		this.consumeKeyword("for");
		if (this.matchArithCmd()) return this.parseCStyleLoop();
		const nameToken = this.consume();
		if (nameToken.type !== "word") throw new Error("Expected loop variable name");
		const name = tokenPartsText(nameToken.parts);
		let items;
		if (this.matchKeyword("in")) {
			this.consumeKeyword("in");
			const collected = [];
			while (this.matchWord() && !this.matchKeyword("do")) {
				const itemToken = this.consume();
				if (itemToken.type !== "word") throw new Error("Expected loop item word");
				collected.push(this.wordFromParts(itemToken.parts));
			}
			if (collected.length > 0) items = collected;
		}
		if (this.matchOp(";")) this.consume();
		this.skipSeparators();
		this.consumeKeyword("do");
		const body = this.parseStatementsUntilKeyword(["done"]);
		this.consumeKeyword("done");
		return items ? {
			type: "ForClause",
			name,
			items,
			body
		} : {
			type: "ForClause",
			name,
			body
		};
	}
	parseCStyleLoop() {
		const token = this.consume();
		if (token.type !== "arith-cmd") throw new Error("Expected (( )) in c-style for");
		const parts = token.expr.split(";").map((s) => s.trim());
		const init = parts[0] || void 0;
		const cond = parts[1] || void 0;
		const post = parts[2] || void 0;
		if (this.matchOp(";")) this.consume();
		this.skipSeparators();
		this.consumeKeyword("do");
		const body = this.parseStatementsUntilKeyword(["done"]);
		this.consumeKeyword("done");
		const loop = {
			type: "CStyleLoop",
			body
		};
		if (init !== void 0) loop.init = init;
		if (cond !== void 0) loop.cond = cond;
		if (post !== void 0) loop.post = post;
		return loop;
	}
	parseSelectClause() {
		this.consumeKeyword("select");
		const nameToken = this.consume();
		if (nameToken.type !== "word") throw new Error("Expected select variable name");
		const name = tokenPartsText(nameToken.parts);
		let items;
		if (this.matchKeyword("in")) {
			this.consumeKeyword("in");
			const collected = [];
			while (this.matchWord() && !this.matchKeyword("do")) {
				const itemToken = this.consume();
				if (itemToken.type !== "word") throw new Error("Expected select item word");
				collected.push(this.wordFromParts(itemToken.parts));
			}
			if (collected.length > 0) items = collected;
		}
		if (this.matchOp(";")) this.consume();
		this.skipSeparators();
		this.consumeKeyword("do");
		const body = this.parseStatementsUntilKeyword(["done"]);
		this.consumeKeyword("done");
		return items ? {
			type: "SelectClause",
			name,
			items,
			body
		} : {
			type: "SelectClause",
			name,
			body
		};
	}
	parseFunctionDecl() {
		if (this.matchKeyword("function")) this.consumeKeyword("function");
		const nameToken = this.consume();
		if (nameToken.type !== "word") throw new Error("Expected function name");
		const name = tokenPartsText(nameToken.parts);
		if (this.matchSymbol("(")) {
			this.consumeSymbol("(");
			this.consumeSymbol(")");
		}
		if (this.matchSymbol("{")) return {
			type: "FunctionDecl",
			name,
			body: this.parseBlock().body
		};
		throw new Error("Expected function body block");
	}
	parseCaseClause() {
		this.consumeKeyword("case");
		const wordToken = this.consume();
		if (wordToken.type !== "word") throw new Error("Expected case word");
		const word = this.wordFromParts(wordToken.parts);
		this.consumeKeyword("in");
		const items = [];
		this.skipSeparators();
		while (!this.matchKeyword("esac")) {
			const patterns = [];
			while (!this.matchSymbol(")")) {
				if (this.matchWord()) {
					const patternToken = this.consume();
					if (patternToken.type !== "word") throw new Error("Expected case pattern");
					patterns.push(this.wordFromParts(patternToken.parts));
					continue;
				}
				if (this.matchOp("|")) {
					this.consume();
					continue;
				}
				throw new Error("Expected case pattern or )");
			}
			this.consumeSymbol(")");
			const body = this.parseCaseItemBody();
			items.push({
				type: "CaseItem",
				patterns,
				body
			});
			if (this.matchOp(";") && this.peekOp(";")) {
				this.consume();
				this.consume();
			}
			this.skipSeparators();
		}
		this.consumeKeyword("esac");
		return {
			type: "CaseClause",
			word,
			items
		};
	}
	parseTimeClause() {
		this.consumeKeyword("time");
		return {
			type: "TimeClause",
			command: this.parseStatement()
		};
	}
	parseTestClause() {
		this.consumeKeyword("[[");
		const words = [];
		while (!this.matchKeyword("]]")) {
			if (this.isEof()) throw new Error("Unclosed [[");
			const token = this.consume();
			if (token.type !== "word") throw new Error("Expected word in [[ ]]");
			words.push(this.wordFromParts(token.parts));
		}
		this.consumeKeyword("]]");
		return {
			type: "TestClause",
			expr: words
		};
	}
	matchArithCmd() {
		return this.peek()?.type === "arith-cmd";
	}
	consumeArithCmd() {
		const token = this.consume();
		if (token.type !== "arith-cmd") throw new Error("Expected arithmetic command");
		return {
			type: "ArithCmd",
			expr: token.expr
		};
	}
	parseCoprocClause() {
		this.consumeKeyword("coproc");
		if (this.matchWord() && this.peekToken(1)?.type === "symbol") {
			const nameToken = this.peek();
			if (nameToken?.type === "word" && this.peekToken(1)?.type === "symbol" && this.peekToken(1).value === "{") {
				const name = tokenPartsText(nameToken.parts);
				this.consume();
				return {
					type: "CoprocClause",
					name,
					body: this.parseStatement()
				};
			}
		}
		return {
			type: "CoprocClause",
			body: this.parseStatement()
		};
	}
	parseCaseItemBody() {
		const body = [];
		this.skipCaseSeparators();
		while (!this.matchKeyword("esac") && !this.isCaseItemEnd()) {
			body.push(this.parseStatement());
			if (this.isCaseItemEnd()) break;
			this.skipCaseSeparators();
		}
		return body;
	}
	isCaseItemEnd() {
		return this.matchOp(";") && this.peekOp(";");
	}
	parseStatementsUntilKeyword(endKeywords) {
		const body = [];
		this.skipSeparators();
		while (!this.matchKeywordIn(endKeywords)) {
			if (this.isEof()) throw new Error(`Unexpected end of input while looking for ${endKeywords.join(", ")}`);
			body.push(this.parseStatement());
			this.skipSeparators();
		}
		return body;
	}
	matchDeclKeyword() {
		const token = this.peek();
		if (token?.type !== "word" || token.parts.length !== 1) return false;
		const part = token.parts[0];
		return part?.type === "lit" && DECL_KEYWORDS.has(part.value);
	}
	parseDeclClause() {
		const variantToken = this.consume();
		if (variantToken.type !== "word") throw new Error("Expected decl keyword");
		const variant = tokenPartsText(variantToken.parts);
		const args = [];
		const assigns = [];
		const redirects = [];
		while (true) {
			if (this.matchRedir()) {
				const token = this.consume();
				if (token.type !== "redir") throw new Error("Expected redirect token");
				const targetToken = this.consume();
				if (targetToken.type !== "word") throw new Error("Redirect must be followed by a word");
				const target = this.wordFromParts(targetToken.parts);
				const redir = token.fd ? {
					type: "Redirect",
					op: token.op,
					fd: token.fd,
					target
				} : {
					type: "Redirect",
					op: token.op,
					target
				};
				redirects.push(redir);
				continue;
			}
			if (this.matchWord()) {
				const token = this.peek();
				if (!token || token.type !== "word") break;
				const assignment = this.tryParseAssignment(token.parts);
				if (assignment) {
					assigns.push(assignment);
					continue;
				}
				this.consume();
				args.push(this.wordFromParts(token.parts));
				continue;
			}
			break;
		}
		const decl = {
			type: "DeclClause",
			variant
		};
		if (args.length > 0) decl.args = args;
		if (assigns.length > 0) decl.assigns = assigns;
		if (redirects.length > 0) decl.redirects = redirects;
		return decl;
	}
	parseLetClause() {
		this.consumeKeyword("let");
		const exprs = [];
		const redirects = [];
		while (true) {
			if (this.matchRedir()) {
				const token = this.consume();
				if (token.type !== "redir") throw new Error("Expected redirect token");
				const targetToken = this.consume();
				if (targetToken.type !== "word") throw new Error("Redirect must be followed by a word");
				const target = this.wordFromParts(targetToken.parts);
				const redir = token.fd ? {
					type: "Redirect",
					op: token.op,
					fd: token.fd,
					target
				} : {
					type: "Redirect",
					op: token.op,
					target
				};
				redirects.push(redir);
				continue;
			}
			if (this.matchWord()) {
				const token = this.consume();
				if (token.type !== "word") break;
				exprs.push(this.wordFromParts(token.parts));
				continue;
			}
			break;
		}
		if (exprs.length === 0) throw new Error("let requires at least one expression");
		const clause = {
			type: "LetClause",
			exprs
		};
		if (redirects.length > 0) clause.redirects = redirects;
		return clause;
	}
	parseSimpleCommand() {
		const words = [];
		const assignments = [];
		const redirects = [];
		let sawWord = false;
		while (true) {
			if (this.matchWord()) {
				const token = this.peek();
				if (!token || token.type !== "word") throw new Error("Expected word token");
				if (!sawWord) {
					const assignment = this.tryParseAssignment(token.parts);
					if (assignment) {
						assignments.push(assignment);
						continue;
					}
				}
				this.consume();
				sawWord = true;
				words.push(this.wordFromParts(token.parts));
				continue;
			}
			if (this.matchRedir()) {
				const token = this.consume();
				if (token.type !== "redir") throw new Error("Expected redirect token");
				const targetToken = this.consume();
				if (targetToken.type !== "word") throw new Error("Redirect must be followed by a word");
				const target = this.wordFromParts(targetToken.parts);
				const redirect = token.fd ? {
					type: "Redirect",
					op: token.op,
					fd: token.fd,
					target
				} : {
					type: "Redirect",
					op: token.op,
					target
				};
				if (token.op === "<<" || token.op === "<<-") {
					this.skipSeparators();
					if (this.peek()?.type === "heredoc-body") {
						const bodyToken = this.consume();
						if (bodyToken.type === "heredoc-body") redirect.heredoc = {
							type: "Word",
							parts: [{
								type: "Literal",
								value: bodyToken.content
							}]
						};
					}
				}
				redirects.push(redirect);
				continue;
			}
			break;
		}
		if (words.length === 0 && assignments.length === 0 && redirects.length === 0) throw new Error("Expected a command word");
		const command = { type: "SimpleCommand" };
		if (words.length > 0) command.words = words;
		if (assignments.length > 0) command.assignments = assignments;
		if (redirects.length > 0) command.redirects = redirects;
		return command;
	}
	convertWordPart(part) {
		switch (part.type) {
			case "lit": return {
				type: "Literal",
				value: part.value
			};
			case "sgl": return {
				type: "SglQuoted",
				value: part.value
			};
			case "dbl": return {
				type: "DblQuoted",
				parts: part.parts.map((p) => this.convertWordPart(p))
			};
			case "param": {
				const paramExp = {
					type: "ParamExp",
					short: !part.braced,
					param: {
						type: "Literal",
						value: part.name
					}
				};
				if (part.op) paramExp.op = part.op;
				if (part.value !== void 0) paramExp.value = {
					type: "Word",
					parts: [{
						type: "Literal",
						value: part.value
					}]
				};
				return paramExp;
			}
			case "cmd-subst": return {
				type: "CmdSubst",
				stmts: new Parser(tokenize(part.raw)).parseProgram().body
			};
			case "arith-exp": return {
				type: "ArithExp",
				expr: part.raw
			};
			case "proc-subst": {
				const prog = new Parser(tokenize(part.raw)).parseProgram();
				return {
					type: "ProcSubst",
					op: part.op,
					stmts: prog.body
				};
			}
			case "backtick": return {
				type: "CmdSubst",
				stmts: new Parser(tokenize(part.raw)).parseProgram().body
			};
		}
	}
	wordFromParts(parts) {
		return {
			type: "Word",
			parts: parts.map((part) => this.convertWordPart(part))
		};
	}
	/**
	* Try to parse an assignment from the current token's parts.
	* If it returns an assignment, it has already consumed all relevant tokens
	* (the word, and optionally the array `(...)` symbols).
	* If it returns undefined, nothing was consumed.
	*/
	tryParseAssignment(parts) {
		if (parts.length !== 1) return void 0;
		const part = parts[0];
		if (!part || part.type !== "lit") return void 0;
		const raw = part.value;
		let append = false;
		let eqIndex = raw.indexOf("+=");
		if (eqIndex > 0) append = true;
		else eqIndex = raw.indexOf("=");
		if (eqIndex <= 0) return void 0;
		const name = raw.slice(0, eqIndex);
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return void 0;
		const afterEq = raw.slice(eqIndex + (append ? 2 : 1));
		const nextToken = this.peekToken(1);
		if (afterEq === "" && nextToken?.type === "symbol" && nextToken.value === "(") {
			this.consume();
			return this.parseArrayAssignment(name, append);
		}
		this.consume();
		const assignment = {
			type: "Assignment",
			name
		};
		if (append) assignment.append = true;
		if (afterEq.length > 0) assignment.value = {
			type: "Word",
			parts: [{
				type: "Literal",
				value: afterEq
			}]
		};
		return assignment;
	}
	parseArrayAssignment(name, append) {
		this.consumeSymbol("(");
		const elems = [];
		while (!this.matchSymbol(")")) {
			if (this.isEof()) throw new Error("Unclosed array expression");
			if (this.matchOp(";")) {
				this.consume();
				continue;
			}
			if (this.matchComment()) {
				this.consumeComment();
				continue;
			}
			const token = this.consume();
			if (token.type !== "word") throw new Error("Expected word in array expression");
			const indexMatch = tokenPartsText(token.parts).match(/^\[([^\]]+)\]=(.*)$/);
			if (indexMatch) {
				const indexStr = indexMatch[1];
				const valStr = indexMatch[2];
				const elem = {
					type: "ArrayElem",
					index: {
						type: "Word",
						parts: [{
							type: "Literal",
							value: indexStr
						}]
					}
				};
				if (valStr.length > 0) elem.value = {
					type: "Word",
					parts: [{
						type: "Literal",
						value: valStr
					}]
				};
				elems.push(elem);
			} else elems.push({
				type: "ArrayElem",
				value: this.wordFromParts(token.parts)
			});
		}
		this.consumeSymbol(")");
		const assignment = {
			type: "Assignment",
			name,
			array: {
				type: "ArrayExpr",
				elems
			}
		};
		if (append) assignment.append = true;
		return assignment;
	}
	skipSeparators() {
		while (this.matchOp(";") || this.matchComment()) if (this.matchComment()) this.consumeComment();
		else this.consume();
	}
	skipCaseSeparators() {
		while (this.matchOp(";") && !this.peekOp(";")) this.consume();
	}
	matchOp(value) {
		const token = this.peek();
		return token?.type === "op" && token.value === value;
	}
	matchWord() {
		return this.peek()?.type === "word";
	}
	matchRedir() {
		return this.peek()?.type === "redir";
	}
	matchKeyword(value) {
		const token = this.peek();
		if (token?.type !== "word" || token.parts.length !== 1) return false;
		const part = token.parts[0];
		return part?.type === "lit" && part.value === value;
	}
	matchKeywordIn(values) {
		return values.some((value) => this.matchKeyword(value));
	}
	looksLikeFuncDecl() {
		const name = this.peek();
		const next = this.peekToken(1);
		const nextNext = this.peekToken(2);
		const after = this.peekToken(3);
		return name?.type === "word" && next?.type === "symbol" && next.value === "(" && nextNext?.type === "symbol" && nextNext.value === ")" && after?.type === "symbol" && after.value === "{";
	}
	matchSymbol(value) {
		const token = this.peek();
		return token?.type === "symbol" && token.value === value;
	}
	consumeSymbol(value) {
		const token = this.consume();
		if (token.type !== "symbol" || token.value !== value) throw new Error(`Expected symbol ${value}`);
	}
	consumeKeyword(value) {
		const token = this.consume();
		if (token.type !== "word" || token.parts.length !== 1 || token.parts[0]?.type !== "lit" || token.parts[0].value !== value) throw new Error(`Expected keyword ${value}`);
	}
	consume() {
		if (this.isEof()) throw new Error("Unexpected end of input");
		const token = this.tokens[this.index];
		if (!token) throw new Error("Unexpected end of input");
		this.index += 1;
		return token;
	}
	peek() {
		return this.tokens[this.index];
	}
	peekToken(offset) {
		return this.tokens[this.index + offset];
	}
	peekOp(value) {
		const token = this.peekToken(1);
		return token?.type === "op" && token.value === value;
	}
	matchComment() {
		return this.peek()?.type === "comment";
	}
	consumeComment() {
		const token = this.consume();
		if (token.type === "comment") this.comments.push({
			type: "Comment",
			text: token.text
		});
	}
	isEof() {
		return this.index >= this.tokens.length;
	}
};

//#endregion
//#region src/parse.ts
function parse(source, options = {}) {
	const parser = new Parser(tokenize(source, options), options);
	const ast = parser.parseProgram();
	parser.assertEof();
	return { ast };
}

//#endregion
export { parse };
//# sourceMappingURL=index.js.map