export type ShellDialect = "posix" | "bash" | "mksh" | "zsh";
export type ParseOptions = {
    dialect?: ShellDialect;
    /** If true, keep comments as nodes/tokens in the output (future). */
    keepComments?: boolean;
};
export type Literal = {
    type: "Literal";
    value: string;
};
export type SglQuoted = {
    type: "SglQuoted";
    value: string;
};
export type DblQuoted = {
    type: "DblQuoted";
    parts: WordPart[];
};
export type ParamExp = {
    type: "ParamExp";
    short: boolean;
    param: Literal;
    op?: string;
    value?: Word;
};
export type CmdSubst = {
    type: "CmdSubst";
    stmts: Statement[];
};
export type ArithExp = {
    type: "ArithExp";
    expr: string;
};
export type ProcSubst = {
    type: "ProcSubst";
    op: "<" | ">";
    stmts: Statement[];
};
export type WordPart = Literal | SglQuoted | DblQuoted | ParamExp | CmdSubst | ArithExp | ProcSubst;
export type Word = {
    type: "Word";
    parts: WordPart[];
};
export type Assignment = {
    type: "Assignment";
    name: string;
    append?: boolean;
    value?: Word;
    array?: ArrayExpr;
};
export type ArrayElem = {
    type: "ArrayElem";
    index?: Word;
    value?: Word;
};
export type ArrayExpr = {
    type: "ArrayExpr";
    elems: ArrayElem[];
};
export type RedirOp = ">" | "<" | ">>" | ">|" | ">&" | "<&" | "<>" | "&>" | "&>>" | "<<<" | "<<" | "<<-";
export type Redirect = {
    type: "Redirect";
    op: RedirOp;
    fd?: string;
    target: Word;
    heredoc?: Word;
};
export type SimpleCommand = {
    type: "SimpleCommand";
    words?: Word[];
    assignments?: Assignment[];
    redirects?: Redirect[];
};
export type Subshell = {
    type: "Subshell";
    body: Statement[];
};
export type Block = {
    type: "Block";
    body: Statement[];
};
export type IfClause = {
    type: "IfClause";
    cond: Statement[];
    then: Statement[];
    else?: Statement[];
};
export type WhileClause = {
    type: "WhileClause";
    cond: Statement[];
    body: Statement[];
    until?: boolean;
};
export type ForClause = {
    type: "ForClause";
    name: string;
    items?: Word[];
    body: Statement[];
};
export type SelectClause = {
    type: "SelectClause";
    name: string;
    items?: Word[];
    body: Statement[];
};
export type FunctionDecl = {
    type: "FunctionDecl";
    name: string;
    body: Statement[];
};
export type CaseItem = {
    type: "CaseItem";
    patterns: Word[];
    body: Statement[];
};
export type CaseClause = {
    type: "CaseClause";
    word: Word;
    items: CaseItem[];
};
export type TimeClause = {
    type: "TimeClause";
    command: Statement;
};
export type TestClause = {
    type: "TestClause";
    expr: Word[];
};
export type ArithCmd = {
    type: "ArithCmd";
    expr: string;
};
export type CoprocClause = {
    type: "CoprocClause";
    name?: string;
    body: Statement;
};
export type DeclClause = {
    type: "DeclClause";
    variant: "declare" | "local" | "export" | "readonly" | "typeset" | "nameref";
    args?: Word[];
    assigns?: Assignment[];
    redirects?: Redirect[];
};
export type LetClause = {
    type: "LetClause";
    exprs: Word[];
    redirects?: Redirect[];
};
export type CStyleLoop = {
    type: "CStyleLoop";
    init?: string;
    cond?: string;
    post?: string;
    body: Statement[];
};
export type CommentNode = {
    type: "Comment";
    text: string;
};
export type Pipeline = {
    type: "Pipeline";
    commands: Statement[];
};
export type Logical = {
    type: "Logical";
    op: "and" | "or";
    left: Statement;
    right: Statement;
};
export type Command = SimpleCommand | Subshell | Block | IfClause | WhileClause | ForClause | SelectClause | FunctionDecl | CaseClause | TimeClause | TestClause | ArithCmd | CoprocClause | Pipeline | Logical | DeclClause | LetClause | CStyleLoop;
export type Statement = {
    type: "Statement";
    command: Command;
    background?: boolean;
    negated?: boolean;
};
export type Program = {
    type: "Program";
    body: Statement[];
    comments?: CommentNode[];
};
export type ParseResult = {
    ast: Program;
};
//# sourceMappingURL=ast.d.ts.map