// Convert h('tag', props, ...children) / h(Comp, props, ...) call expressions to JSX.
// Keeps `import { createElement as h, Fragment }` so classic jsxFactory stays in scope.
import ts from 'typescript'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node h-to-jsx.mjs <file.ts>...')
  process.exit(1)
}

function isHCall(node) {
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'h'
    && node.arguments.length >= 1
}

function propsToJsxAttributes(propsExpr, factory) {
  if (!propsExpr || propsExpr.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(propsExpr) && propsExpr.text === 'null')) return []
  if (ts.isObjectLiteralExpression(propsExpr)) {
    const attrs = []
    for (const prop of propsExpr.properties) {
      if (ts.isSpreadAssignment(prop)) {
        attrs.push(factory.createJsxSpreadAttribute(prop.expression))
        continue
      }
      if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue
      const name = ts.isIdentifier(prop.name) ? prop.name.text
        : ts.isStringLiteral(prop.name) ? prop.name.text
        : null
      if (name === null) {
        // computed — keep as spread of a one-key object would be lossy; skip
        continue
      }
      // Hyphenated aria-/data- names are valid JsxIdentifiers (Identifier text may include '-').
      const jsxName = factory.createIdentifier(name)
      if (ts.isShorthandPropertyAssignment(prop)) {
        attrs.push(factory.createJsxAttribute(jsxName, factory.createJsxExpression(undefined, factory.createIdentifier(prop.name.text))))
        continue
      }
      const init = prop.initializer
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
        attrs.push(factory.createJsxAttribute(jsxName, init))
      } else if (init.kind === ts.SyntaxKind.TrueKeyword) {
        attrs.push(factory.createJsxAttribute(jsxName, undefined)) // boolean true shorthand
      } else {
        attrs.push(factory.createJsxAttribute(jsxName, factory.createJsxExpression(undefined, init)))
      }
    }
    return attrs
  }
  // dynamic props object: <Comp {...props}>
  return [factory.createJsxSpreadAttribute(propsExpr)]
}

function argToJsxChild(arg, factory, visit) {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return factory.createJsxText(arg.text)
  }
  if (ts.isIdentifier(arg) && arg.text === 'null') return null
  const visited = visit(arg)
  // if already jsx, use as child; else wrap in expression
  if (ts.isJsxElement(visited) || ts.isJsxSelfClosingElement(visited) || ts.isJsxFragment(visited)) return visited
  return factory.createJsxExpression(undefined, visited)
}

function hCallToJsx(node, factory, visit) {
  const [typeArg, propsArg, ...childArgs] = node.arguments
  const attrs = propsToJsxAttributes(propsArg, factory)
  const children = []
  for (const c of childArgs) {
    if (ts.isArrayLiteralExpression(c)) {
      for (const el of c.elements) {
        const child = argToJsxChild(el, factory, visit)
        if (child) children.push(child)
      }
      continue
    }
    const child = argToJsxChild(c, factory, visit)
    if (child) children.push(child)
  }

  // Fragment: h(Fragment, null, ...)
  if (ts.isIdentifier(typeArg) && typeArg.text === 'Fragment') {
    return factory.createJsxFragment(
      factory.createJsxOpeningFragment(),
      children,
      factory.createJsxJsxClosingFragment(),
    )
  }

  // Only intrinsics (string tags). Component calls stay as h(Comp, …) so helpers
  // that return ReactNode keep typechecking under classic JSX.
  if (!ts.isStringLiteral(typeArg)) return node
  const tagName = factory.createIdentifier(typeArg.text)

  const opening = factory.createJsxOpeningElement(tagName, undefined, factory.createJsxAttributes(attrs))
  if (children.length === 0) {
    return factory.createJsxSelfClosingElement(tagName, undefined, factory.createJsxAttributes(attrs))
  }
  const closing = factory.createJsxClosingElement(tagName)
  return factory.createJsxElement(opening, children, closing)
}

function transformSource(filePath) {
  const text = readFileSync(filePath, 'utf8')
  const kind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.ES2022, true, kind)
  let changed = false
  // Proper two-phase: transform h calls bottom-up
  const transformer = (context) => {
    const visitNode = (node) => {
      node = ts.visitEachChild(node, visitNode, context)
      if (isHCall(node)) {
        const jsx = hCallToJsx(node, context.factory, (n) => n)
        if (jsx !== node && (ts.isJsxElement(jsx) || ts.isJsxSelfClosingElement(jsx) || ts.isJsxFragment(jsx))) {
          changed = true
          return jsx
        }
      }
      return node
    }
    return (node) => ts.visitNode(node, visitNode)
  }

  const result = ts.transform(sf, [transformer])
  const outSf = result.transformed[0]
  result.dispose()
  if (!changed) return { changed: false }

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
  let printed = printer.printFile(outSf)
  // TypeScript printer may emit Fragments oddly; ok.

  const dest = filePath.endsWith('.tsx') ? filePath : filePath.replace(/\.ts$/, '.tsx')
  writeFileSync(dest, printed)
  if (dest !== filePath && existsSync(filePath)) {
    // leave deleting to caller after updating imports
  }
  return { changed: true, dest, src: filePath }
}

for (const f of files) {
  const r = transformSource(f)
  console.log(r.changed ? `converted ${f} -> ${r.dest}` : `skip ${f}`)
}
