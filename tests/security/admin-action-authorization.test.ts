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
    return entry.name.endsWith(".ts") ? [entryPath] : [];
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

const unauthenticatedActions: Record<string, string> = {
  "admin/login/actions.ts:signInAction": "Signing in requires no session.",
  "admin/forgot/actions.ts:requestPasswordResetAction": "Recovery starts without a session.",
  "admin/reset/actions.ts:completePasswordResetAction": "Reset links work without a session.",
};

// Add imported guard helpers here with the file in which they call an accepted guard.
const importedGuardHelpers: Record<string, string> = {};

function isGuard(name: string | undefined, sourceFile: ts.SourceFile, guards: string[]): boolean {
  if (!name) return false;
  if (guards.includes(name)) return true;
  const local = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  if (local?.body) return guards.includes(firstAwaitedCallName(local.body) ?? "");
  const helperFile = importedGuardHelpers[name];
  if (!helperFile) return false;
  const imported = sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text ===
        `@/${helperFile.replace(/^src\//, "").replace(/\.ts$/, "")}` &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some((element) => element.name.text === name),
  );
  if (!imported) return false;
  const helper = ts.createSourceFile(
    helperFile,
    readFileSync(helperFile, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = helper.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  return !!declaration?.body && guards.includes(firstAwaitedCallName(declaration.body) ?? "");
}

function isUserManagementFile(file: string): boolean {
  return file.split(path.sep).includes("users");
}

describe("admin Server Action authorization", () => {
  const adminDirectory = path.join(process.cwd(), "src", "app", "admin");
  const appDirectory = path.join(process.cwd(), "src", "app");

  it("requires authorization as the first awaited call in every action except the sign-in and recovery ones", () => {
    const violations: string[] = [];

    for (const file of actionFiles(appDirectory)) {
      const source = readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const first = sourceFile.statements[0];
      if (
        !first ||
        !ts.isExpressionStatement(first) ||
        !ts.isStringLiteral(first.expression) ||
        first.expression.text !== "use server"
      )
        continue;
      const allowedGuards = isUserManagementFile(file)
        ? ["requirePermission"]
        : ["requireAdmin", "requirePermission"];

      for (const action of exportedAsyncFunctions(sourceFile)) {
        const actionId = `${path.relative(appDirectory, file).split(path.sep).join("/")}:${action.name}`;
        if (Object.hasOwn(unauthenticatedActions, actionId)) continue;

        const guard = firstAwaitedCallName(action.body);
        if (!isGuard(guard, sourceFile, allowedGuards)) {
          violations.push(`${path.relative(process.cwd(), file)}:${action.name}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("guards every user-management action with requirePermission", () => {
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
      ["createAdminUserAction", "requirePermission"],
      ["requestAdminUserDeletionCodeAction", "requirePermission"],
      ["confirmAdminUserDeletionAction", "requirePermission"],
      ["updateAdminUserAction", "requirePermission"],
      ["deactivateAdminUserAction", "requirePermission"],
      ["reactivateAdminUserAction", "requirePermission"],
      ["resetAdminPasswordAction", "requirePermission"],
      ["revokeAdminSessionsAction", "requirePermission"],
    ]);
  });

  it("guards event, location, image and capacity actions with requireAdmin", () => {
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
    expect(guards.get("sendEventLocationAction")).toBe("requireAdmin");
    expect(guards.has("processPendingLocationEmailsAction")).toBe(false);
    expect(guards.get("deleteEventImageAction")).toBe("requireAdmin");
    expect(guards.get("deleteEventClueAction")).toBe("requireAdmin");
    expect(guards.get("deleteEventAction")).toBe("requireAdmin");
    expect(guards.get("changeCapacityAction")).toBe("requireAdmin");
    expect(guards.get("changeWaitlistCapacityAction")).toBe("requireAdmin");
  });

  it("guards drink deletion with requireAdmin", () => {
    const file = path.join(adminDirectory, "(protected)", "drinks", "actions.ts");
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
    expect(guards.get("deleteDrinkAction")).toBe("requireAdmin");
  });
});
