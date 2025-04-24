const t = require("@babel/types");
const generate = require("@babel/generator").default;
const traverse = require("@babel/traverse").default;
const { getExpressions, isNumberNode, getNumberFromNode } = require("./utils");

function buildEquivalences(arr) {
  const equivalences = new Map();
  let groupId = 1;

  for (let i = 0; i < 128; i++) {
    for (let j = 0; j < 512; j++) {
      const ref = arr[i][j];
      let found = false;

      for (const [id, arrays] of equivalences.entries()) {
        if (arrays.includes(ref)) {
          found = true;
          break;
        }
      }

      if (!found) {
        equivalences.set(groupId++, [ref]);
      }
    }
  }

  const pairToGroupMap = new Map();
  for (let i = 0; i < 256; i++) {
    for (let j = 0; j < 999; j++) {
      const ref = arr[i][j];

      for (const [id, arrays] of equivalences.entries()) {
        if (arrays.includes(ref)) {
          pairToGroupMap.set(`${i},${j}`, id);
          break;
        }
      }
    }
  }

  return pairToGroupMap;
}

function transformIndices(arr, i, j) {
  const mod_i = i % 128;
  if (!transformIndices.equivalences) {
    transformIndices.equivalences = buildEquivalences(arr);
  }

  return transformIndices.equivalences.get(`${mod_i},${j}`);
}

function resolveOpaquePredicates(program) {
  // let genIndex = function (e, t, a, n, c, i, r, o) {
  //   return (((t * a) ^ (r * i) ^ (e * n)) >>> 0) & (c - 1);
  // };

  let deobfuscated = 0;
  let getIdxFuncPath = null;
  let arrayVarDeclaratorPath = null;

  traverse(program, {
    FunctionExpression(path) {
      if (path.node.body.body.length < 1) {
        return;
      }

      const lastExpr = path.node.body.body.at(-1);
      if (
        !t.isReturnStatement(lastExpr) ||
        !t.isMemberExpression(lastExpr.argument)
      ) {
        return;
      }

      const id = lastExpr.argument.property;
      if (!t.isNumericLiteral(id)) {
        return;
      }

      let arrayStartIndex = id.value; // dw
      let tempGetIdxFunc = null;

      traverse(
        path.node.body,
        {
          CallExpression(callPath) {
            if (!t.isIdentifier(callPath.node.callee)) {
              return;
            }

            if (callPath.node.arguments.length < 7) {
              return;
            }

            const identifierNum = callPath.node.arguments.filter((arg) =>
              t.isIdentifier(arg)
            ).length;
            const numNum = callPath.node.arguments.filter((arg) =>
              t.isNumericLiteral(arg)
            ).length;

            if (identifierNum !== 2 || numNum < 5) {
              return;
            }

            tempGetIdxFunc = callPath.scope.getBinding(
              callPath.node.callee.name
            ).path;
            callPath.stop();
          },
        },
        path.scope
      );

      if (arrayStartIndex === -1 || id.value != arrayStartIndex) {
        return;
      }

      while (!t.isVariableDeclarator(path)) {
        path = path.parentPath;
      }

      getIdxFuncPath = tempGetIdxFunc;
      arrayVarDeclaratorPath = path;
    },
  });

  if (getIdxFuncPath == null) {
    console.log("could not find opaque predicates gen func");
    return;
  }

  const vmCode =
    generate(getIdxFuncPath.node).code +
    ";" +
    generate(t.variableDeclaration("let", [arrayVarDeclaratorPath.node])).code +
    ";" +
    arrayVarDeclaratorPath.node.id.name;
  const arr = eval(vmCode);

  const references = arrayVarDeclaratorPath.scope.getBinding(
    arrayVarDeclaratorPath.node.id.name
  ).referencePaths;
  for (let refPath of references) {
    while (t.isMemberExpression(refPath.parentPath)) {
      refPath = refPath.parentPath;
    }

    if (
      !t.isMemberExpression(refPath.node.object) ||
      !t.isIdentifier(refPath.node.object.object)
    ) {
      continue;
    }

    if (!t.isNumericLiteral(refPath.node.property)) {
      continue;
    }

    const firstIdx = refPath.node.object.property.value;
    const secondIdx = refPath.node.property.value;

    refPath.replaceWith(
      t.numericLiteral(transformIndices(arr, firstIdx, secondIdx))
    );
    deobfuscated++;
  }

  arrayVarDeclaratorPath.remove();
  console.log("deobfuscated " + deobfuscated + " opaque predicates");
}

function getLastNumber(binding, locEnd) {
  let value = undefined;
  let closestLoc = 0;

  const reassignements = binding.constantViolations;
  if (binding.path !== undefined) {
    reassignements.push(binding.path);
  }

  for (const refPath of reassignements) {
    if (
      t.isAssignmentExpression(refPath.node) &&
      isNumberNode(refPath.node.right) &&
      closestLoc <= refPath.node.loc.start.index &&
      refPath.node.loc.start.index <= locEnd
    ) {
      value = getNumberFromNode(refPath.node.right);
      closestLoc = refPath.node.loc.start.index;
    }

    if (
      t.isVariableDeclarator(refPath.node) &&
      isNumberNode(refPath.node.init) &&
      closestLoc <= refPath.node.loc.start.index &&
      refPath.node.loc.start.index <= locEnd
    ) {
      value = getNumberFromNode(refPath.node.init);
      closestLoc = refPath.node.loc.start.index;
    }
  }

  return value;
}

function deobfuscateSwitchCases(program) {
  const parseDiscriminant = function (scope, node) {
    // should never be reached
    if (isNumberNode(node)) {
      return getNumberFromNode(node);
    }

    if (t.isIdentifier(node)) {
      const binding = scope.getBinding(node.name);
      const value = getLastNumber(binding, node.loc.end.index);
      return value;
    }

    return undefined;
  };

  const getCaseByNum = function (switchExpr, num) {
    return switchExpr.cases.filter((c) => getNumberFromNode(c.test) === num)[0];
  };

  let deobfuscated = 0;
  let deobfuscatedCases = 0;

  traverse(program, {
    SwitchStatement(path) {
      let isForLoopObfuscation = false;
      const hasNonStaticCases = path.node.cases.some(
        (c) => !isNumberNode(c.test)
      );

      if (hasNonStaticCases) {
        // not every cases are numbers so we just skip it as we can't recreate it
        return;
      }

      path.traverse({
        ContinueStatement(path) {
          isForLoopObfuscation = true;
          path.stop();
        },
      });

      if (!isForLoopObfuscation) {
        return;
      }

      const startingDiscriminant = parseDiscriminant(
        path.scope,
        path.node.discriminant
      );
      let plainCodeExpressions = [];
      let caseToInspect = getCaseByNum(path.node, startingDiscriminant);

      while (caseToInspect !== undefined) {
        let nextCaseToInspect = -1;
        let continued = false;
        let changed = false;
        let switchEnd = false;
        let hasReturned = false;

        // find next case
        traverse(
          caseToInspect,
          {
            IfStatement(cPath) {
              cPath.skip();
            },
            ForStatement(cPath) {
              cPath.skip();
            },
            ConditionalExpression(cPath) {
              cPath.skip();
            },
            AssignmentExpression(cPath) {
              if (
                t.isIdentifier(cPath.node.left) &&
                cPath.node.left.name === path.node.discriminant.name
              ) {
                const next = getNumberFromNode(cPath.node.right);
                if (next === undefined) {
                  throw new Error(
                    "wasn't able to retrieve next case because assignement wasn't a num" +
                      cPath.node.type
                  );
                }
                // caseToInspect = getCaseByNum(path.node, next);
                nextCaseToInspect = next;
                changed = true;
                cPath.remove();
              }
            },
            ContinueStatement(cPath) {
              continued = true;
              cPath.remove();
              cPath.stop();
            },
            BreakStatement(cPath) {
              switchEnd = true;
              cPath.remove();
              cPath.stop();
            },
            ReturnStatement(cPath) {
              switchEnd = true;
              hasReturned = true;
              cPath.skip();
            },
            enter(cPath) {
              if (hasReturned) cPath.remove();
            },
          },
          path.scope
        );

        if (continued && !changed) {
          // throw new Error(
          //   "Switch case discrimant hasn't changed but was reiterated."
          // );
          console.log("squid game " + caseToInspect.test.value);
          return;
        }

        plainCodeExpressions.push(...getExpressions(caseToInspect.consequent));
        if (switchEnd) {
          break;
        }

        if (changed) {
          caseToInspect = getCaseByNum(path.node, nextCaseToInspect);
        } else {
          // console.log("no assigment found going to next case");
          caseToInspect = path.node.cases.at(
            path.node.cases.indexOf(caseToInspect) + 1
          );
          continue;
        }
      }

      deobfuscatedCases += path.node.cases.length;
      while (path !== null && !t.isForStatement(path)) {
        path = path.parentPath;
      }
      if (path === null) {
        return;
      }

      if (path.node.init !== undefined && path.node.init !== null) {
        plainCodeExpressions.unshift(path.node.init);
      }
      path.replaceWithMultiple(plainCodeExpressions);
      deobfuscated++;
    },
  });

  console.log(
    "deobfuscated " +
      deobfuscated +
      " switch cases with a total of " +
      deobfuscatedCases +
      " cases"
  );
}

module.exports = { resolveOpaquePredicates, deobfuscateSwitchCases };
