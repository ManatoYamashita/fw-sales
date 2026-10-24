/** cacheTag / revalidateTag / updateTag がテナント付きの CACHE_TAGS に由来するかを検査する。 */
import ts from "typescript";

export function unsafeCacheTagCalls(source: ts.SourceFile): number[] {
  const calls = new Map<string, string>();
  const namespaces = new Set<string>();
  const declarations = new Map<ts.Node, Map<string, ts.VariableDeclaration>>();
  const scope = (node: ts.Node): ts.Node => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isForOfStatement(parent)) return parent;
    }
    return source;
  };
  const walk = (node: ts.Node, visit: (node: ts.Node) => void) => {
    visit(node);
    ts.forEachChild(node, (child) => walk(child, visit));
  };
  walk(source, (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "next/cache") {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) calls.set(binding.name.text, binding.propertyName?.text ?? binding.name.text);
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const owner = scope(node);
      const vars = declarations.get(owner) ?? new Map<string, ts.VariableDeclaration>();
      vars.set(node.name.text, node);
      declarations.set(owner, vars);
    }
  });
  function fromTags(node: ts.Expression, seen = new Set<ts.Node>()): boolean {
    if (seen.has(node)) return false;
    seen.add(node);
    if (ts.isParenthesizedExpression(node)) return fromTags(node.expression, seen);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      return ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "CACHE_TAGS" && node.arguments.length > 0;
    }
    if (ts.isIdentifier(node)) {
      for (let owner: ts.Node | undefined = node; owner; owner = owner.parent) {
        const variable = declarations.get(owner)?.get(node.text);
        if (!variable) continue;
        if (!ts.isVariableDeclarationList(variable.parent) || !(variable.parent.flags & ts.NodeFlags.Const)) return false;
        if (variable.initializer) return fromTags(variable.initializer, seen);
        const loop = variable.parent.parent;
        return ts.isForOfStatement(loop) && ts.isArrayLiteralExpression(loop.expression)
          && loop.expression.elements.length > 0 && loop.expression.elements.every((item) => ts.isExpression(item) && fromTags(item, new Set(seen)));
      }
    }
    return false;
  }
  const unsafe: number[] = [];
  walk(source, (node) => {
    if (!ts.isCallExpression(node)) return;
    let name: string | undefined;
    if (ts.isIdentifier(node.expression)) name = calls.get(node.expression.text);
    if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && namespaces.has(node.expression.expression.text)) name = node.expression.name.text;
    if (!name || !["cacheTag", "revalidateTag", "updateTag"].includes(name)) return;
    const tags = name === "cacheTag" ? node.arguments : node.arguments.slice(0, 1);
    if (tags.length === 0 || !tags.every((arg) => fromTags(arg))) unsafe.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
  });
  return unsafe;
}
