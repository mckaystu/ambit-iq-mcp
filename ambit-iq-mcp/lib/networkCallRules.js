import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;

const AXIOS_METHODS = new Set([
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "request",
  "head",
  "options",
]);

/**
 * @param {import('@babel/types').Expression | import('@babel/types').V8IntrinsicIdentifier | import('@babel/types').PrivateName} callee
 */
function isNetworkCallCallee(callee) {
  if (!callee) return false;
  if (callee.type === "Identifier" && callee.name === "fetch") return true;
  if (callee.type === "Identifier" && callee.name === "axios") return true;
  if (callee.type === "MemberExpression" && !callee.computed) {
    const obj = callee.object;
    const prop = callee.property;
    const name = prop.type === "Identifier" ? prop.name : null;
    if (obj.type === "Identifier" && obj.name === "axios" && name && AXIOS_METHODS.has(name)) {
      return true;
    }
  }
  return false;
}

function containsNode(ancestor, target) {
  if (ancestor === target) return true;
  if (!ancestor || typeof ancestor !== "object") return false;
  for (const k of Object.keys(ancestor)) {
    const v = ancestor[k];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === "object" && containsNode(item, target)) return true;
      }
    } else if (v && typeof v === "object" && v.type) {
      if (containsNode(v, target)) return true;
    }
  }
  return false;
}

/**
 * @param {import('@babel/traverse').NodePath<import('@babel/types').CallExpression>} callPath
 */
function isInTryBlock(callPath) {
  const node = callPath.node;
  let p = callPath.parentPath;
  while (p) {
    if (p.isTryStatement()) {
      const block = p.node.block;
      return block ? containsNode(block, node) : false;
    }
    p = p.parentPath;
  }
  return false;
}

/**
 * Promise chain: fetch().catch / .then().catch starting at the innermost call (e.g. fetch CE).
 * @param {import('@babel/traverse').NodePath} callPath
 */
function hasCatchOnPromiseChain(callPath) {
  let path = callPath;
  for (let depth = 0; depth < 48; depth++) {
    const memberPath = path.findParent(
      (p) =>
        p.isMemberExpression() &&
        !p.node.computed &&
        p.get("object").node === path.node,
    );
    if (!memberPath) return false;
    const prop = memberPath.get("property");
    if (prop.isIdentifier({ name: "catch" })) return true;
    const outer = memberPath.parentPath;
    if (!outer?.isCallExpression()) return false;
    path = outer;
  }
  return false;
}

/**
 * @param {import('@babel/types').CallExpression} call
 */
function objectArgHasTimeoutOrSignal(call) {
  for (let i = 1; i < call.arguments.length; i++) {
    const arg = call.arguments[i];
    if (arg.type === "ObjectExpression") {
      for (const prop of arg.properties) {
        if (prop.type !== "ObjectProperty" && prop.type !== "ObjectMethod") continue;
        const key = prop.key;
        const name =
          key.type === "Identifier"
            ? key.name
            : key.type === "StringLiteral"
              ? key.value
              : key.type === "NumericLiteral"
                ? String(key.value)
                : null;
        if (name === "signal" || name === "timeout") return true;
      }
    }
  }
  return false;
}

/**
 * @param {import('@babel/types').File} ast
 * @returns {{ paths: import('@babel/traverse').NodePath<import('@babel/types').CallExpression>[] }}
 */
function collectNetworkCallPaths(ast) {
  /** @type {import('@babel/traverse').NodePath<import('@babel/types').CallExpression>[]} */
  const paths = [];
  traverse(ast, {
    CallExpression(path) {
      if (isNetworkCallCallee(path.node.callee)) {
        paths.push(path);
      }
    },
  });
  return { paths };
}

function parseOrNull(code) {
  try {
    return parse(code, {
      sourceType: "module",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowImportExportEverywhere: true,
      errorRecovery: true,
      plugins: ["jsx", "typescript", "optionalChaining", "nullishCoalescingOperator"],
    });
  } catch {
    return null;
  }
}

/**
 * AST-based: any fetch/axios call without try/catch-on-chain protection.
 */
export function hasUnprotectedNetworkCallAst(code) {
  const ast = parseOrNull(code);
  if (!ast) return null;
  const { paths } = collectNetworkCallPaths(ast);
  if (paths.length === 0) return false;
  return paths.some((p) => !isInTryBlock(p) && !hasCatchOnPromiseChain(p));
}

/**
 * AST-based: any fetch/axios call missing timeout/signal in an inline options object.
 * Variables spread into options are not resolved (may false-positive).
 */
export function hasNetworkCallWithoutTimeoutAst(code) {
  const ast = parseOrNull(code);
  if (!ast) return null;
  const { paths } = collectNetworkCallPaths(ast);
  if (paths.length === 0) return false;
  return paths.some((p) => !objectArgHasTimeoutOrSignal(p.node));
}

/** Legacy whole-file heuristics when parse fails or yields no calls but text suggests I/O. */
export function legacyUnprotectedNetworkCall(code) {
  return (
    (code.includes("fetch(") || code.includes("axios.")) &&
    !code.includes("try") &&
    !code.includes(".catch(")
  );
}

export function legacyNetworkCallWithoutTimeout(code) {
  return (
    (code.includes("fetch(") || code.includes("axios.")) &&
    !/timeout|AbortController|signal/.test(code)
  );
}
