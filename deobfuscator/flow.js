const t = require("@babel/types");
const traverse = require("@babel/traverse").default;
const { getNumberFromNode, isNumberNode, getExpressions, revertTest } = require("./utils");

function removeTrashFlow(program) {
  let removed = 0;

  // returns expressions or undefined
  const fixStaticConditional = function (node) {
    while (t.isConditionalExpression(node.test)) {
      const temp = fixStaticConditional(node.test);
      if (temp === undefined) return undefined;
      node.test = temp;
    }

    while (t.isBinaryExpression(node.test) && node.test.operator == "==") {
      if (!isNumberNode(node.test.left) || !isNumberNode(node.test.right)) {
        return undefined;
      }

      const left = getNumberFromNode(node.test.left);
      const right = getNumberFromNode(node.test.right);
      if (left == right) {
        return getExpressions(node.consequent);
      } else {
        return getExpressions(node.alternate);
      }
    }

    while (t.isLogicalExpression(node.test)) {
      if (t.isConditionalExpression(node.test.left)) {
        const temp = fixStaticConditional(node.test.left);
        if (temp === undefined) return undefined;
        node.test.left = temp;
      }

      if (t.isConditionalExpression(node.test.right)) {
        const temp = fixStaticConditional(node.test.right);
        if (temp === undefined) return undefined;
        node.test.right = temp;
      }

      if (!isNumberNode(node.test.left) || !isNumberNode(node.test.right)) {
        return undefined;
      }

      const left = getNumberFromNode(node.test.left);
      const right = getNumberFromNode(node.test.right);

      if (node.test.operator === "&&") {
        if (left && right) {
          return getExpressions(node.consequent);
        } else {
          return getExpressions(node.alternate);
        }
      } else if (node.test.operator === "||") {
        if (left || right) {
          return getExpressions(node.consequent);
        } else {
          return getExpressions(node.alternate);
        }
      } else {
        throw new Error("unhandled logical op " + node.test.operator);
      }
    }

    if (isNumberNode(node.test)) {
      if (getNumberFromNode(node.test)) {
        return getExpressions(node.consequent);
      } else {
        return getExpressions(node.alternate);
      }
    }

    return undefined;
  };

  traverse(program, {
    ConditionalExpression(path) {
      const res = fixStaticConditional(path.node);
      if (res !== undefined) {
        path.replaceWithMultiple(res);
        removed++;
      } else if (res === null) {
        path.remove();
      }
    },
    IfStatement(path) {
      const res = fixStaticConditional(path.node);
      if (res !== undefined) {
        path.replaceWithMultiple(res);
        removed++;
      } else if (res === null) {
        path.remove();
      }
    },
  });

  console.log("removed " + removed + " trash cf");
}

function fixTrashIfs(program) {
  traverse(program, {
    IfStatement(path) {
      const node = path.node;
      if (
        t.isBlockStatement(node.alternate) &&
        node.alternate.body.length === 0
      ) {
        node.alternate = null;
      }

      // duplicated code because I don't know how to let babel traverse the conditional while being the traversed path
      // we could traverse the if path but then it would traverse as well actual body
      a: {
        const node = path.node.test;
        if (!t.isConditionalExpression(node)) {
            break a;
        }
        if (
            !t.isNumericLiteral(node.consequent) ||
            !t.isNumericLiteral(node.alternate)
          ) {
            break a;
          }

          const consequent = node.consequent.value;
          const alternate = node.alternate.value;

          if (
            (consequent !== 0 && consequent !== 1) ||
            (alternate !== 0 && alternate !== 1)
          ) {
            break a;
          }

          if (consequent === 0 && alternate === 1) {
            const temp = revertTest(node.test);
            if (temp !== undefined) {
                path.node.test = temp;
            }
          } else if (consequent == 1 && alternate == 0) {
            path.node.test = node.test;
          }
      }

      traverse(
        path.node.test,
        {
          ConditionalExpression(p) {
            if (
              !t.isNumericLiteral(p.node.consequent) ||
              !t.isNumericLiteral(p.node.alternate)
            ) {
              return;
            }

            const consequent = p.node.consequent.value;
            const alternate = p.node.alternate.value;

            if (
              (consequent !== 0 && consequent !== 1) ||
              (alternate !== 0 && alternate !== 1)
            ) {
              return;
            }

            if (consequent === 0 && alternate === 1) {
              const temp = revertTest(p.node.test);
              if (temp !== undefined) {
                if (
                  t.isUnaryExpression(temp) &&
                  t.isUnaryExpression(p.parentPath.node)
                ) {
                  p.parentPath.replaceWith(temp.argument);
                } else {
                  p.replaceWith(temp);
                }
              }
            } else if (consequent == 1 && alternate == 0) {
              p.replaceWith(p.node.test);
            }
          },
        },
        path.scope
      );

      if (
        t.isBlockStatement(node.consequent) &&
        (node.consequent.body === null || node.consequent.body.length === 0) &&
        node.alternate !== null
      ) {
        const revert = revertTest(node.test);
        if (revert !== undefined) {
          node.test = revert;
          node.consequent = node.alternate;
          node.alternate = null;
        }
      }
    },
  });
}

function fixLogicalExpressions(program) {
  let simplified = 0;
  traverse(program, {
    LogicalExpression(path) {
      const left = path.node.left;
      const right = path.node.right;

      if (!isNumberNode(left) && !isNumberNode(right)) {
        return;
      }

      if (isNumberNode(left) && !isNumberNode(right)) {
        const leftNumber = getNumberFromNode(left);
        if (path.node.operator === "||" && !leftNumber) {
          path.replaceWith(right);
          simplified++;
        } else if (path.node.operator === "&&" && leftNumber) {
          path.replaceWith(right);
          simplified++;
        }
      } else if (isNumberNode(right) && !isNumberNode(left)) {
        const rightNumber = getNumberFromNode(right);
        if (path.node.operator === "||" && !rightNumber) {
          path.replaceWith(left);
          simplified++;
        } else if (path.node.operator === "&&" && rightNumber) {
          path.replaceWith(left);
          simplified++;
        }
      }
    },
  });

  console.log("simplified " + simplified + " logical expressions");
}

module.exports = { removeTrashFlow, fixTrashIfs, fixLogicalExpressions };
