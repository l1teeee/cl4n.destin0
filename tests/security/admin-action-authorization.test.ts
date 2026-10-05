import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ExportedAsyncFunction {
  body: ts.Block;
  name: string;
}

function actionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return actionFiles(entryPath);
    return entry.name === "actions.ts" ? [entryPath] : [];
  });
}

function hasModifier(
  node: { modifiers?: ts.NodeArray<ts.ModifierLike> },
  kind: ts.SyntaxKind,
): boolean {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function exportedAsyncFunctions(sourceFile: ts.SourceFile): ExportedAsyncFunction[] {
  const functions: ExportedAsyncFunction[] = [];

  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      statement.body &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
      hasModifier(statement, ts.SyntaxKind.AsyncKeyword)
    ) {
      functions.push({ name: statement.name.text, body: statement.body });
      continue;
    }

    if (
      !ts.isVariableStatement(statement) ||
      !hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (
        ts.isIdentifier(declaration.name) &&
        initializer &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
        ts.isBlock(initializer.body) &&
        hasModifier(initializer, ts.SyntaxKind.AsyncKeyword)
      ) {
        functions.push({ name: declaration.name.text, body: initializer.body });
      }
    }
  }

  return functions;
}

function firstAwaitExpression(body: ts.Block): ts.AwaitExpression | undefined {
  let firstAwait: ts.AwaitExpression | undefined;

  function visit(node: ts.Node): void {
    if (firstAwait) return;
    if (ts.isFunctionLike(node)) return;
    if (ts.isAwaitExpression(node)) {
      firstAwait = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(body, visit);
  return firstAwait;
}

describe("admin Server Action authorization", () => {
  it("requires authorization as the first awaited call in every action except sign-in", () => {
    const adminDirectory = path.join(process.cwd(), "src", "app", "admin");
    const violations: string[] = [];

    for (const file of actionFiles(adminDirectory)) {
      const source = readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);

      for (const action of exportedAsyncFunctions(sourceFile)) {
        if (action.name === "signInAction") continue;

        const firstAwait = firstAwaitExpression(action.body);
        const isRequireAdminCall =
          firstAwait &&
          ts.isCallExpression(firstAwait.expression) &&
          ts.isIdentifier(firstAwait.expression.expression) &&
          firstAwait.expression.expression.text === "requireAdmin";

        if (!isRequireAdminCall) {
          violations.push(`${path.relative(process.cwd(), file)}:${action.name}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
