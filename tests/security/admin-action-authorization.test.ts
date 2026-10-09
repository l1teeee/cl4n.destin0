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

function firstAwaitedCallName(body: ts.Block): string | undefined {
  const firstAwait = firstAwaitExpression(body);
  return firstAwait &&
    ts.isCallExpression(firstAwait.expression) &&
    ts.isIdentifier(firstAwait.expression.expression)
    ? firstAwait.expression.expression.text
    : undefined;
}

const unauthenticatedActions = [
  "signInAction",
  "requestPasswordResetAction",
  "completePasswordResetAction",
];

function isUserManagementFile(file: string): boolean {
  return file.split(path.sep).includes("users");
}

describe("admin Server Action authorization", () => {
  const adminDirectory = path.join(process.cwd(), "src", "app", "admin");

  it("requires authorization as the first awaited call in every action except the sign-in and recovery ones", () => {
    const violations: string[] = [];

    for (const file of actionFiles(adminDirectory)) {
      const source = readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const allowedGuards = isUserManagementFile(file)
        ? ["requireSuperAdmin"]
        : ["requireAdmin", "requireSuperAdmin"];

      for (const action of exportedAsyncFunctions(sourceFile)) {
        if (unauthenticatedActions.includes(action.name)) continue;

        const guard = firstAwaitedCallName(action.body);
        if (!guard || !allowedGuards.includes(guard)) {
          violations.push(`${path.relative(process.cwd(), file)}:${action.name}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("guards every user-management action with requireSuperAdmin", () => {
    const file = path.join(adminDirectory, "(protected)", "users", "actions.ts");
    const sourceFile = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const guards = exportedAsyncFunctions(sourceFile).map((action) => [
      action.name,
      firstAwaitedCallName(action.body),
    ]);

    expect(guards).toEqual([
      ["createAdminUserAction", "requireSuperAdmin"],
      ["requestAdminUserDeletionCodeAction", "requireSuperAdmin"],
      ["confirmAdminUserDeletionAction", "requireSuperAdmin"],
      ["updateAdminUserAction", "requireSuperAdmin"],
      ["deactivateAdminUserAction", "requireSuperAdmin"],
      ["reactivateAdminUserAction", "requireSuperAdmin"],
      ["resetAdminPasswordAction", "requireSuperAdmin"],
      ["revokeAdminSessionsAction", "requireSuperAdmin"],
    ]);
  });

  it("guards location status and image deletion actions with requireAdmin", () => {
    const file = path.join(adminDirectory, "(protected)", "events", "actions.ts");
    const sourceFile = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const guards = new Map(
      exportedAsyncFunctions(sourceFile).map((action) => [
        action.name,
        firstAwaitedCallName(action.body),
      ]),
    );
    expect(guards.get("setEventLocationStatusAction")).toBe("requireAdmin");
    expect(guards.get("deleteEventImageAction")).toBe("requireAdmin");
  });
});
