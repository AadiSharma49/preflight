import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { findSourceFiles } from './walk.js';

// @babel/traverse is CJS; interop gives us the callable on .default.
const traverse = traverseModule.default ?? traverseModule;

/**
 * Does an import specifier refer to this package?
 * 'framer-motion'          -> yes
 * 'framer-motion/dist/x'   -> yes (subpath)
 * 'framer-motion-3d'       -> NO. This is the check regex approaches get wrong.
 */
function matchesPackage(spec, pkg) {
  return spec === pkg || spec.startsWith(`${pkg}/`);
}

function subpathOf(spec, pkg) {
  return spec === pkg ? null : spec.slice(pkg.length + 1);
}

function parserPlugins(file) {
  const ext = path.extname(file);
  const plugins = ['decorators-legacy'];

  // The jsx plugin makes `<T>(x) => x` ambiguous in .ts files, so it is only
  // safe to enable for .tsx and plain JS.
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') plugins.push('typescript');
  else if (ext === '.tsx') plugins.push('typescript', 'jsx');
  else plugins.push('jsx');

  return plugins;
}

function parseFile(code, file) {
  return parse(code, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowSuperOutsideMethod: true,
    // One malformed file must not abort a whole-repo scan.
    errorRecovery: true,
    plugins: parserPlugins(file),
  });
}

function isRequireCall(node, pkg) {
  return (
    node?.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'require' &&
    node.arguments.length === 1 &&
    node.arguments[0].type === 'StringLiteral' &&
    matchesPackage(node.arguments[0].value, pkg)
  );
}

// True only when the identifier sits in a TypeScript *type* position.
// Checking the immediate parent is what keeps `foo as Bar` honest: `Bar` is a
// type, `foo` is a value, even though both live under a TS* node.
function isTypePosition(ref) {
  const p = ref.parentPath;
  if (!p) return false;
  return Boolean(
    p.isTSTypeReference?.() ||
      p.isTSQualifiedName?.() ||
      p.isTSTypeQuery?.() ||
      p.isTSExpressionWithTypeArguments?.() ||
      p.isTSImportType?.()
  );
}

/**
 * Given one reference to a binding, work out which export it touches and how.
 *
 * `api` is always the name the *package* exports — that's what a changelog
 * talks about. For `import * as m` / default imports, the member access is the
 * export name (`m.motion` -> motion). For named imports the export name is
 * already known and any member access is recorded separately as `member`.
 */
function classify(ref, ctx) {
  const node = ref.node;
  const parent = ref.parent;
  const grand = ref.parentPath?.parent;
  const namespaceLike =
    ctx.via === 'namespace' || ctx.via === 'require-ns' || ctx.via === 'default';

  let api = ctx.api;
  let member = null;

  if (
    parent?.type === 'MemberExpression' &&
    parent.object === node &&
    !parent.computed &&
    parent.property.type === 'Identifier'
  ) {
    member = parent.property.name;
    if (namespaceLike) {
      api = member;
      member = null;
    }
    const called = grand?.type === 'CallExpression' && grand.callee === parent;
    return { api, member, kind: called ? 'call' : 'member' };
  }

  if (parent?.type === 'JSXMemberExpression' && parent.object === node) {
    member = parent.property.name;
    if (namespaceLike) {
      api = member;
      member = null;
    }
    return { api, member, kind: 'jsx' };
  }

  if (node.type === 'JSXIdentifier') return { api, member, kind: 'jsx' };
  if (parent?.type === 'CallExpression' && parent.callee === node)
    return { api, member, kind: 'call' };
  if (parent?.type === 'NewExpression' && parent.callee === node)
    return { api, member, kind: 'new' };
  if (isTypePosition(ref)) return { api, member, kind: 'type' };

  return { api, member, kind: 'reference' };
}

/** Scan one file's source. Exported for the fixture tests. */
export function scanSource({ code, file, pkg, root }) {
  const usages = [];
  const rel = root
    ? path.relative(root, file).split(path.sep).join('/')
    : file;

  let ast;
  try {
    ast = parseFile(code, file);
  } catch (err) {
    return { usages, error: err.message };
  }

  // Local name -> what it was imported as. Populated in pass 1, read by the
  // type pass, which cannot rely on Babel's scope references (see below).
  const importedLocals = new Map();
  const seen = new Set();

  const record = (node, fields) => {
    const line = node.loc?.start.line ?? 0;
    const column = (node.loc?.start.column ?? 0) + 1;
    const key = `${line}:${column}:${fields.api}`;
    if (seen.has(key)) return;
    seen.add(key);

    usages.push({
      file: rel,
      line,
      column,
      member: null,
      typeOnly: false,
      subpath: null,
      ...fields,
    });
  };

  // Pass 2, run per binding: every place this local name is actually used.
  // Babel's scope resolution is what makes shadowing correct for free — a local
  // `const motion` inside a function is a different binding and never shows up
  // in referencePaths.
  const collectReferences = (binding, ctx) => {
    if (!binding) return;
    for (const ref of binding.referencePaths) {
      const { api, member, kind } = classify(ref, ctx);
      record(ref.node, {
        api,
        member,
        local: ctx.local,
        via: ctx.via,
        kind,
        typeOnly: ctx.typeOnly || kind === 'type',
        subpath: ctx.subpath,
      });
    }
  };

  traverse(ast, {
    // Pass 1a: ESM imports.
    ImportDeclaration(p) {
      const spec = p.node.source.value;
      if (!matchesPackage(spec, pkg)) return;

      const subpath = subpathOf(spec, pkg);
      const declTypeOnly = p.node.importKind === 'type';

      if (p.node.specifiers.length === 0) {
        record(p.node, {
          api: '*',
          local: null,
          via: 'side-effect',
          kind: 'import',
          subpath,
        });
        return;
      }

      for (const s of p.node.specifiers) {
        const typeOnly = declTypeOnly || s.importKind === 'type';
        let api;
        let via;

        if (s.type === 'ImportSpecifier') {
          api = s.imported.type === 'Identifier' ? s.imported.name : s.imported.value;
          via = 'named';
        } else if (s.type === 'ImportDefaultSpecifier') {
          api = 'default';
          via = 'default';
        } else {
          api = '*';
          via = 'namespace';
        }

        const local = s.local.name;
        const ctx = { api, local, via, typeOnly, subpath };

        record(s, { ...ctx, kind: 'import' });
        importedLocals.set(local, { ...ctx, identifier: s.local });
        collectReferences(p.scope.getBinding(local), ctx);
      }
    },

    // Pass 1b: CommonJS.
    VariableDeclarator(p) {
      if (!isRequireCall(p.node.init, pkg)) return;
      const subpath = subpathOf(p.node.init.arguments[0].value, pkg);
      const id = p.node.id;

      if (id.type === 'Identifier') {
        const ctx = { api: '*', local: id.name, via: 'require-ns', typeOnly: false, subpath };
        record(id, { ...ctx, kind: 'import' });
        collectReferences(p.scope.getBinding(id.name), ctx);
        return;
      }

      if (id.type !== 'ObjectPattern') return;
      for (const prop of id.properties) {
        if (prop.type !== 'ObjectProperty') continue;
        if (prop.value.type !== 'Identifier') continue; // nested/defaulted patterns
        const api = prop.key.name ?? prop.key.value;
        const ctx = { api, local: prop.value.name, via: 'require', typeOnly: false, subpath };
        record(prop, { ...ctx, kind: 'import' });
        collectReferences(p.scope.getBinding(prop.value.name), ctx);
      }
    },

    CallExpression(p) {
      const node = p.node;

      // await import('pkg')
      if (
        node.callee.type === 'Import' &&
        node.arguments[0]?.type === 'StringLiteral' &&
        matchesPackage(node.arguments[0].value, pkg)
      ) {
        record(node, {
          api: '*',
          local: null,
          via: 'dynamic',
          kind: 'dynamic',
          subpath: subpathOf(node.arguments[0].value, pkg),
        });
        return;
      }

      // require('pkg') whose result is never bound to a name.
      if (isRequireCall(node, pkg) && p.parentPath.node.type !== 'VariableDeclarator') {
        record(node, {
          api: '*',
          local: null,
          via: 'require',
          kind: 'require',
          subpath: subpathOf(node.arguments[0].value, pkg),
        });
      }
    },

    // export { x } from 'pkg' — a re-export is still a usage of that export.
    ExportNamedDeclaration(p) {
      if (!p.node.source || !matchesPackage(p.node.source.value, pkg)) return;
      const subpath = subpathOf(p.node.source.value, pkg);
      for (const s of p.node.specifiers) {
        if (s.type !== 'ExportSpecifier') continue;
        record(s, {
          api: s.local.name,
          local: s.exported.name ?? s.exported.value,
          via: 'named',
          kind: 're-export',
          typeOnly: p.node.exportKind === 'type' || s.exportKind === 'type',
          subpath,
        });
      }
    },

    ExportAllDeclaration(p) {
      if (!matchesPackage(p.node.source.value, pkg)) return;
      record(p.node, {
        api: '*',
        local: null,
        via: 'namespace',
        kind: 're-export',
        subpath: subpathOf(p.node.source.value, pkg),
      });
    },
  });

  // Pass 3: TypeScript type positions.
  //
  // Babel's scope tracks *value* references only, so `import type { Variants }`
  // would otherwise show the import line and none of the places the type is
  // actually used. A changed type signature is a real break for a TS consumer,
  // so those sites have to be found too. This runs as its own traversal so it
  // does not depend on imports being visited before their uses.
  const recordTypeName = (p, nameNode) => {
    if (!nameNode) return;

    let head = nameNode;
    let member = null;
    if (nameNode.type === 'TSQualifiedName') {
      member = nameNode.right.name;
      head = nameNode.left;
      while (head.type === 'TSQualifiedName') head = head.left;
    }
    if (head.type !== 'Identifier') return;

    const ctx = importedLocals.get(head.name);
    if (!ctx) return;

    // A local type alias with the same name is not the package. Comparing the
    // resolved binding is what makes this correct rather than a guess.
    const binding = p.scope.getBinding(head.name);
    if (binding && binding.identifier !== ctx.identifier) return;

    const namespaceLike =
      ctx.via === 'namespace' || ctx.via === 'require-ns' || ctx.via === 'default';
    let api = ctx.api;
    if (namespaceLike && member) {
      api = member;
      member = null;
    }

    record(head, {
      api,
      member,
      local: ctx.local,
      via: ctx.via,
      kind: 'type',
      typeOnly: true,
      subpath: ctx.subpath,
    });
  };

  traverse(ast, {
    TSTypeReference(p) {
      recordTypeName(p, p.node.typeName);
    },
    TSTypeQuery(p) {
      recordTypeName(p, p.node.exprName);
    },
    TSExpressionWithTypeArguments(p) {
      recordTypeName(p, p.node.expression);
    },
    // import('framer-motion').Variants
    TSImportType(p) {
      if (!matchesPackage(p.node.argument.value, pkg)) return;
      const qualifier = p.node.qualifier;
      record(p.node, {
        api: qualifier?.type === 'Identifier' ? qualifier.name : '*',
        local: null,
        via: 'dynamic',
        kind: 'type',
        typeOnly: true,
        subpath: subpathOf(p.node.argument.value, pkg),
      });
    },
  });

  usages.sort((a, b) => a.line - b.line || a.column - b.column);
  return { usages, error: null };
}

/** Scan a whole repo for one package. */
export function scanRepo({ repo, pkg }) {
  const files = findSourceFiles(repo);
  const usages = [];
  const errors = [];
  let filesMatched = 0;

  for (const file of files) {
    let code;
    try {
      code = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    // Any genuine import must contain the package name literally, so this skips
    // parsing for the ~99% of files that cannot possibly match.
    if (!code.includes(pkg)) continue;

    const { usages: found, error } = scanSource({ code, file, pkg, root: repo });
    if (error) {
      errors.push({ file: path.relative(repo, file), error });
      continue;
    }
    if (found.length) {
      filesMatched += 1;
      usages.push(...found);
    }
  }

  usages.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column
  );

  return {
    package: pkg,
    filesScanned: files.length,
    filesMatched,
    usages,
    errors,
  };
}
