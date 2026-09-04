import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

const srcRoot = path.resolve(import.meta.dir, "../src");
const appRoot = path.join(srcRoot, "app");
const httpMethods = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);
const publicRouteHandlers = new Set(["auth/login/route.ts", "logout/route.ts"]);

type ExportedFunction = {
  body: ts.ConciseBody;
  isDefault: boolean;
  name: string;
};

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listTypeScriptFiles(entryPath) : [entryPath];
    })
  );

  return files
    .flat()
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === kind))
  );
}

function startsWithAdminGuard(body: ts.ConciseBody): boolean {
  if (!ts.isBlock(body) || body.statements.length === 0) {
    return false;
  }

  const firstStatement = body.statements[0];
  if (!ts.isExpressionStatement(firstStatement)) {
    return false;
  }

  const expression = firstStatement.expression;
  if (!ts.isAwaitExpression(expression)) {
    return false;
  }

  const call = expression.expression;
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === "requireAdminSession" &&
    call.arguments.length === 0
  );
}

function getDirectlyExportedFunctions(
  sourceFile: ts.SourceFile
): ExportedFunction[] {
  const functions: ExportedFunction[] = [];

  for (const statement of sourceFile.statements) {
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.body) {
      functions.push({
        body: statement.body,
        isDefault: hasModifier(statement, ts.SyntaxKind.DefaultKeyword),
        name: statement.name?.text ?? "default",
      });
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (
          initializer &&
          (ts.isArrowFunction(initializer) ||
            ts.isFunctionExpression(initializer))
        ) {
          functions.push({
            body: initializer.body,
            isDefault: false,
            name: declaration.name.getText(sourceFile),
          });
        }
      }
    }
  }

  return functions;
}

function getIndirectRuntimeExports(sourceFile: ts.SourceFile): string[] {
  return sourceFile.statements.flatMap((statement) => {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.isTypeOnly ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      return [];
    }

    return statement.exportClause.elements
      .filter((element) => !element.isTypeOnly)
      .map((element) => element.name.text);
  });
}

function importsAdminGuard(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "@/lib/require-admin-session" &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (element) => element.name.text === "requireAdminSession"
      )
  );
}

function hasUseServerDirective(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === "use server"
  );
}

const failures: string[] = [];
const files = await listTypeScriptFiles(srcRoot);
let actionCount = 0;
let pageCount = 0;
let routeHandlerCount = 0;

for (const file of files) {
  const source = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const relativeToApp = path.relative(appRoot, file).split(path.sep).join("/");
  const relativeToAdmin = path.relative(
    path.resolve(import.meta.dir, ".."),
    file
  );
  const exportedFunctions = getDirectlyExportedFunctions(sourceFile);
  const indirectRuntimeExports = getIndirectRuntimeExports(sourceFile);
  const protectedFunctions: Array<ExportedFunction & { kind: string }> = [];
  const isServerActionModule = hasUseServerDirective(sourceFile);
  const isAdminPage =
    relativeToApp.startsWith("(admin)/") && relativeToApp.endsWith("/page.tsx");
  const isPrivateRouteHandler =
    relativeToApp.endsWith("/route.ts") &&
    !publicRouteHandlers.has(relativeToApp);

  if (isServerActionModule) {
    const actions = exportedFunctions.map((action) => ({
      ...action,
      kind: "Server Action",
    }));
    actionCount += actions.length;
    protectedFunctions.push(...actions);

    if (indirectRuntimeExports.length > 0) {
      failures.push(
        `${relativeToAdmin}: Server Actions must be directly declared so their guards can be verified`
      );
    }
  }

  if (isAdminPage) {
    const pages = exportedFunctions
      .filter((candidate) => candidate.isDefault)
      .map((page) => ({ ...page, kind: "admin page" }));
    pageCount += pages.length;
    protectedFunctions.push(...pages);

    if (pages.length !== 1) {
      failures.push(
        `${relativeToAdmin}: admin page must directly declare one guarded default function`
      );
    }
  }

  if (isPrivateRouteHandler) {
    const routeHandlers = exportedFunctions
      .filter((candidate) => httpMethods.has(candidate.name))
      .map((handler) => ({ ...handler, kind: "route handler" }));
    routeHandlerCount += routeHandlers.length;
    protectedFunctions.push(...routeHandlers);

    if (
      routeHandlers.length === 0 ||
      indirectRuntimeExports.some((name) => httpMethods.has(name))
    ) {
      failures.push(
        `${relativeToAdmin}: private Route Handlers must be directly declared so their guards can be verified`
      );
    }
  }

  if (protectedFunctions.length === 0) {
    continue;
  }

  if (!importsAdminGuard(sourceFile)) {
    failures.push(`${relativeToAdmin}: missing requireAdminSession import`);
  }

  for (const endpoint of protectedFunctions) {
    if (!startsWithAdminGuard(endpoint.body)) {
      failures.push(
        `${relativeToAdmin}: ${endpoint.kind} ${endpoint.name} must start with await requireAdminSession()`
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Admin endpoint authorization verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Verified ${actionCount} admin Server Actions, ${routeHandlerCount} private route handlers, and ${pageCount} admin pages require an in-endpoint session check.`
);
