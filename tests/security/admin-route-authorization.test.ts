import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const guards = ["requireAdmin", "requirePermission"];
// Add imported guard helpers with the file where they call requireAdmin or requirePermission.
const importedGuardHelpers: Record<string, string> = {};
// readDrinkRequest checks isSameOriginRequest in drinks/read-drink-request.ts.
const originHelpers = ["readDrinkRequest"];
const originExceptions: Record<string, string> = {};

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(file);
    return entry.name === "route.ts" ? [file] : [];
  });
}

function firstAwaitedCall(body: ts.Block): string | undefined {
  let result: ts.AwaitExpression | undefined;
  function visit(node: ts.Node): void {
    if (result || ts.isFunctionLike(node)) return;
    if (ts.isAwaitExpression(node)) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(body, visit);
  const expression = result?.expression;
  return expression && ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)
    ? expression.expression.text
    : undefined;
}

function functionBody(source: ts.SourceFile, name: string): ts.Block | undefined {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement.body;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const value = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          value &&
          (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) &&
          ts.isBlock(value.body)
        )
          return value.body;
      }
    }
  }
}

function isGuard(name: string | undefined, source: ts.SourceFile): boolean {
  if (!name) return false;
  if (guards.includes(name)) return true;
  const local = functionBody(source, name);
  if (local) return guards.includes(firstAwaitedCall(local) ?? "");
  const file = importedGuardHelpers[name];
  if (!file) return false;
  const imported = source.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === `@/${file.replace(/^src\//, "").replace(/\.ts$/, "")}` &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some((element) => element.name.text === name),
  );
  if (!imported) return false;
  const helper = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const body = functionBody(helper, name);
  return !!body && guards.includes(firstAwaitedCall(body) ?? "");
}

function callsOriginCheck(body: ts.Block): boolean {
  let found = false;
  function visit(node: ts.Node): void {
    if (ts.isFunctionLike(node)) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ["isSameOriginRequest", ...originHelpers].includes(node.expression.text)
    )
      found = true;
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(body, visit);
  return found;
}

describe("admin route authorization", () => {
  it("guards every handler and checks the origin of mutations", () => {
    const violations: string[] = [];
    for (const file of routeFiles(path.join(process.cwd(), "src", "app", "admin"))) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const statement of source.statements) {
        if (
          !ts.canHaveModifiers(statement) ||
          !ts
            .getModifiers(statement)
            ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
        )
          continue;
        const names =
          ts.isFunctionDeclaration(statement) && statement.name
            ? [statement.name.text]
            : ts.isVariableStatement(statement)
              ? statement.declarationList.declarations.flatMap((declaration) =>
                  ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
                )
              : [];
        for (const name of names.filter((value) => methods.includes(value))) {
          const body = functionBody(source, name);
          const id = `${path.relative(process.cwd(), file).split(path.sep).join("/")}:${name}`;
          if (!body || !isGuard(firstAwaitedCall(body), source)) violations.push(`${id}: guard`);
          if (
            name !== "GET" &&
            (!body || !callsOriginCheck(body)) &&
            !Object.hasOwn(originExceptions, id)
          )
            violations.push(`${id}: origin`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
