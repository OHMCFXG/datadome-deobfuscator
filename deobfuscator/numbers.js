const t = require("@babel/types");
const traverse = require("@babel/traverse").default;
const { getNumberFromNode, isNumberNode, numberToNode } = require("./utils");
const vm = require("node:vm");

function resolveMathFunctions(script, program) {
  let replaced = 0;
  traverse(program, {
    FunctionDeclaration(path) {
      if (path.node.params.length < 2) {
        return;
      }

      // let debug = path.node.id.name === "n" && path.node.params.length === 6;

      let bodyStatement = path.node.body;
      if (
        !t.isBlockStatement(bodyStatement) ||
        bodyStatement.body.length > 5 ||
        !t.isReturnStatement(bodyStatement.body.at(-1))
      ) {
        return;
      }

      let isInvalid = false;
      traverse(
        path.node.body,
        {
          enter(bodyPath) {
            if (
              !t.isBinaryExpression(bodyPath.node) &&
              !t.isUnaryExpression(bodyPath.node) &&
              !t.isIdentifier(bodyPath.node) &&
              !t.isConditionalExpression(bodyPath.node) &&
              !t.isNumericLiteral(bodyPath.node) &&
              !t.isMemberExpression(bodyPath.node) &&
              !t.isReturnStatement(bodyPath.node) &&
              !t.isVariableDeclaration(bodyPath.node) &&
              !t.isVariableDeclarator(bodyPath.node) &&
              !t.isAssignmentExpression(bodyPath.node)
            ) {
              // console.log("failed " + path.node.id.name + " because of " + bodyPath.node.type);
              isInvalid = true;
              bodyPath.stop();
            }
          },
        },
        path.scope
      );

      if (isInvalid) {
        return;
      }

      const functionCode = script.slice(
        path.node.loc.start.index,
        path.node.loc.end.index
      );

      const references = path.parentPath.scope.getBinding(
        path.node.id.name
      ).referencePaths;

      const filtered = references.filter(
        (refPath) =>
          t.isCallExpression(refPath.parentPath) &&
          refPath.parentPath.node.arguments.length === 2 &&
          isNumberNode(refPath.parentPath.node.arguments[0]) &&
          isNumberNode(refPath.parentPath.node.arguments[1])
      );

      if (filtered.length === 0) {
        return;
      }

      let canRemovePath =
        filtered.length ===
        references.filter((ref) => t.isCallExpression(ref.parentPath.node))
          .length;

      let vmCode = "let array = [];" + functionCode + "; output=[";

      for (const refPath of filtered) {
        const callPath = refPath.parentPath;
        const callNode = callPath.node;
        vmCode +=
          path.node.id.name +
          "(" +
          getNumberFromNode(callNode.arguments[0]) +
          "," +
          getNumberFromNode(callNode.arguments[1]) +
          "),";
      }

      vmCode = vmCode.slice(0, -1);
      vmCode += "];";

      const ctx = {};
      vm.createContext(ctx);
      vm.runInContext(vmCode, ctx);

      // let output = eval(vmCode);
      // console.log(vmCode);
      let output = ctx.output;
      for (let i = 0; i < filtered.length; i++) {
        const refPath = filtered[i];
        const callPath = refPath.parentPath;

        callPath.replaceWith(t.numericLiteral(output[i]));
        replaced++;
      }

      path.scope.crawl();
      if (canRemovePath) {
        path.remove();
      }
    },
  });

  console.log("solved " + replaced + " int obfuscation calls");
}

function resolveStaticMath(program) {
  let resolved = 0;
  let inlined = 0;

  const inlineReferences = function (path) {
    if (!t.isVariableDeclarator(path.parentPath.node)) {
      return;
    }

    const varName = path.parentPath.node.id.name;
    const binding = path.parentPath.scope.getBinding(varName);

    if (binding !== undefined) {
      let privInlined = 0;
      for (const refPath of binding.referencePaths) {
        refPath.replaceWith(path.node);
        inlined++;
        privInlined++;
      }

      if (privInlined == binding.referencePaths.length) {
        if (
          t.isVariableDeclaration(path.parentPath.parentPath.node) &&
          path.parentPath.parentPath.node.declarations.length === 1
        ) {
          path.parentPath.parentPath.remove();
        } else if (t.isVariableDeclarator(path.parentPath.node)) {
          path.parentPath.remove();
        }
      }
    }
  };

  traverse(program, {
    CallExpression(path) {
      const node = path.node;

      if (
        t.isIdentifier(node.callee) &&
        node.callee.name === "parseInt" &&
        node.arguments.length === 1
      ) {
        const num = getNumberFromNode(node.arguments[0]);
        if (num === undefined) return;
        path.replaceWith(numberToNode(parseInt(num)));
        resolved++;
        inlineReferences(path);
        return;
      }

      if (
        t.isIdentifier(node.callee) &&
        node.callee.name === "Number" &&
        node.arguments.length === 1
      ) {
        const num = getNumberFromNode(node.arguments[0]);
        if (num === undefined) return;
        path.replaceWith(numberToNode(num));
        resolved++;
        inlineReferences(path);
        return;
      }

      if (
        !t.isMemberExpression(node.callee) ||
        !t.isIdentifier(node.callee.object) ||
        !t.isIdentifier(node.callee.property)
      ) {
        return;
      }

      if (node.callee.object.name !== "Math") {
        return;
      }

      switch (node.callee.property.name) {
        case "ceil":
          const ceilResult = getNumberFromNode(node.arguments[0]);
          if (ceilResult === undefined) return;
          path.replaceWith(numberToNode(Math.ceil(ceilResult)));
          break;
        case "floor":
          const floorResult = getNumberFromNode(node.arguments[0]);
          if (floorResult === undefined) return;
          path.replaceWith(numberToNode(Math.floor(floorResult)));
          break;
        default:
          return;
      }

      inlineReferences(path);
      resolved++;
    },
  });

  console.log("resolved " + resolved + " static math functions");
  console.log("inlined " + inlined + " numbers");
}

function solveBin(bin) {
  let left = bin.left;
  let right = bin.right;

  while (!isNumberNode(left)) {
    if (t.isUnaryExpression(left) && t.isBinaryExpression(left.argument)) {
      const temp = solveBin(left.argument);
      if (temp === undefined) return undefined;
      left.argument = numberToNode(temp);
    } else if (t.isBinaryExpression(left)) {
      left = solveBin(left);
      if (left === undefined) return undefined;
      left = numberToNode(left);
    } else {
      return undefined;
    }
  }

  while (!isNumberNode(right)) {
    if (t.isUnaryExpression(right) && t.isBinaryExpression(right.argument)) {
      const temp = solveBin(right.argument);
      if (temp === undefined) return undefined;
      right.argument = numberToNode(temp);
    } else if (t.isBinaryExpression(right)) {
      right = solveBin(right);
      if (right === undefined) return undefined;
      right = numberToNode(right);
    } else {
      return undefined;
    }
  }

  const leftValue = getNumberFromNode(left);
  const rightValue = getNumberFromNode(right);
  if (leftValue === undefined || rightValue === undefined) {
    return undefined;
  }

  switch (bin.operator) {
    case "+":
      return leftValue + rightValue;
    case "-":
      return leftValue - rightValue;
    case "*":
      return leftValue * rightValue;
    case "/":
      return leftValue / rightValue;
    case ">>":
      return leftValue >> rightValue;
    case ">>>":
      return leftValue >>> rightValue;
    case "<<":
      return leftValue << rightValue;
    case "&":
      return leftValue & rightValue;
    case "|":
      return leftValue | rightValue;
    case "^":
      return leftValue ^ rightValue;
    case ">":
      return leftValue > rightValue ? 1 : 0;
    case "<":
      return leftValue < rightValue ? 1 : 0;
    case "!=":
      return leftValue != rightValue ? 1 : 0;
    case "!==":
      return leftValue !== rightValue ? 1 : 0;
    case "===":
      return leftValue === rightValue ? 1 : 0;
    case "==":
      return leftValue == rightValue ? 1 : 0;
    case ">=":
      return leftValue >= rightValue ? 1 : 0;
    case "<=":
      return leftValue <= rightValue ? 1 : 0;
    case "%":
      return leftValue % rightValue ? 1 : 0;
    default:
      throw new Error(
        "unhandled operator while solving math operations: " + bin.operator
      );
  }
}

function solveStaticMathOperations(program) {
  let solved = 0;

  traverse(program, {
    BinaryExpression(path) {
      const res = solveBin(path.node);
      if (res !== undefined) {
        path.replaceWith(numberToNode(res));
        solved++;
      }
    },
  });
  console.log("solved " + solved + " static math operations");
}

module.exports = {resolveMathFunctions, resolveStaticMath, solveBin, solveStaticMathOperations};