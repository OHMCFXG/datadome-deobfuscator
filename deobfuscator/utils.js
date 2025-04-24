const { moduleExpression } = require("@babel/types");
const t = require("@babel/types");
const generate = require("@babel/generator").default;
const traverse = require("@babel/traverse").default;

function isNumberNode(node) {
  if (t.isSequenceExpression(node)) {
    for (const expr of node.expressions) {
      if (isNumberNode(expr)) {
        return true;
      }
    }
  }

  while (!t.isNumericLiteral(node)) {
    if (
      t.isUnaryExpression(node) &&
      (node.operator === "+" ||
        node.operator === "-" ||
        node.operator === "~" ||
        node.operator === "!") &&
      isNumberNode(node.argument)
    ) {
      node = node.argument;
    } else {
      return false;
    }
  }

  return true;
}

function numberToNode(num) {
  if (num < 0) {
    return t.unaryExpression("-", t.numericLiteral(-num), true);
  }

  return t.numericLiteral(num);
}

function isSupportedOperator(op) {
  return (
    op === "+" ||
    op === "-" ||
    op === "~" ||
    op === "!"
  );
}

function getNumberFromNode(node) {
  if (t.isSequenceExpression(node)) {
    for (let i = node.expressions.length - 1; i >= 0; i--) {
      if (isNumberNode(node.expressions[i])) {
        return getNumberFromNode(node.expressions[i]);
      }
    }
  }

  if (t.isNumericLiteral(node)) {
    return node.value;
  }

  if (t.isUnaryExpression(node)) {
    const changes = [];
    while (!t.isNumericLiteral(node)) {
      if (!t.isUnaryExpression(node) || !isSupportedOperator(node.operator)) {
        return undefined;
      }

      changes.push(node.operator);
      node = node.argument;
    }

    let value = node.value;
    for (const ch of changes.reverse()) {
      switch (ch) {
        case "+":
          value = +value;
          break;
        case "-":
          value = -value;
          break;
        case "~":
          value = ~value;
          break;
        case "!":
          value = !value;
          break;
      }
    }

    return value;

    //   let value;
    //   if (t.isNumericLiteral(node.argument)) {
    //     value = node.argument.value;
    //   } else if (t.isUnaryExpression(node.argument)) {
    //     value = getNumberFromNode(node.argument);
    //   } else {
    //     return undefined;
    //   }

    //   switch (node.operator) {
    //     case "+":
    //       value = +value;
    //       break;
    //     case "-":
    //       value = -value;
    //       break;
    //     case "~":
    //       value = ~value;
    //       break;
    //     case "!":
    //       value = !value;
    //       break;
    //   }

    //   return value;
    // }

    // // throw new Error("unknown num node");
    // return undefined;
  }
}

function revertTest(node) {
  if (t.isUnaryExpression(node) && node.operator === "!") {
    return node.argument;
  }

  if (
    t.isConditionalExpression(node) &&
    t.isNumericLiteral(node.consequent) &&
    t.isNumericLiteral(node.alternate)
  ) {
    const leftNumber = node.consequent.value;
    const rightNumber = node.alternate.value;

    if (leftNumber === 1 && rightNumber === 0) {
      return revertTest(node.test);
    } else if (leftNumber === 0 && rightNumber === 1) {
      return node.test;
    }
  }

  if (t.isSequenceExpression(node)) {
    for (let i = node.expressions.length - 1; i > 0; i--) {
      const expr = node.expressions[i];
      if (t.isAssignmentExpression(expr)) break;

      const temp = revertTest(expr);
      if (temp === undefined) continue;
      node.expressions[i] = temp;
    }

    return node;
  }

  if (
    t.isIdentifier(node) ||
    t.isCallExpression(node) ||
    t.isMemberExpression(node)
  ) {
    return t.unaryExpression("!", node, true);
  }

  if (t.isLogicalExpression(node)) {
    const tempLeft = revertTest(node.left);
    const tempRight = revertTest(node.right);
    if (tempLeft === undefined || tempRight === undefined) {
      return undefined;
    }

    if (node.operator === "&&") {
      node.operator = "||";
    } else if (node.operator === "||") {
      node.operator = "&&";
    }

    node.left = tempLeft;
    node.right = tempRight;
    return node;
  }

  if (t.isBinaryExpression(node)) {
    switch (node.operator) {
      case "!==":
        node.operator = "===";
        break;
      case "===":
        node.operator = "!==";
        break;
      case "==":
        node.operator = "!=";
        break;
      case "!=":
        node.operator = "==";
        break;
      case ">":
        node.operator = "<";
        break;
      case "<":
        node.operator = ">";
        break;
      case ">=":
        node.operator = "<=";
        break;
      case "<=":
        node.operator = ">=";
        break;
      default:
        return undefined;
    }

    return node;
  }

  return undefined;
}

function getExpressions(node) {
  if (t.isExpressionStatement(node)) {
    return node.expressions;
  }

  return node;
}

module.exports = {
  revertTest,
  isNumberNode,
  getNumberFromNode,
  getExpressions,
  numberToNode,
};
