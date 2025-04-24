const t = require("@babel/types");
const generate = require("@babel/generator").default;
const traverse = require("@babel/traverse").default;

function resolveWindowCalls(program) {
  let resolved = 0;
  traverse(program, {
    VariableDeclarator(path) {
      const node = path.node;
      const init = node.init;

      if (t.isIdentifier(init) && init.name === "window") {
        let binding = path.scope.getBinding(path.node.id.name);

        for (const reference of binding.referencePaths) {
          const parentPath = reference.parentPath;
          const parent = parentPath.node;

          if (
            !t.isMemberExpression(parent) ||
            !t.isIdentifier(parent.object) ||
            !t.isStringLiteral(parent.property)
          ) {
            // just replace value with window
            reference.replaceWith(t.stringLiteral("window"));
            resolved++;
            continue;
          }

          if (parent.object.name === node.id.name) {
            parentPath.replaceWith(t.identifier(parent.property.value));
            resolved++;
          }
        }

        // there's currently one window var so we don't need to look at every vars
        path.stop();
      }
    },
  });

  console.log("resolved " + resolved + " window calls");
}

function resolveMemberExprCalls(program) {
  let resolved = 0;
  traverse(program, {
    MemberExpression(path) {
      if (
        t.isStringLiteral(path.node.property) &&
        !path.node.property.value.includes("@")
      ) {
        path.node.property = t.identifier(path.node.property.value);
        path.node.computed = false;
        resolved++;
      }

      if (t.isArrayExpression(path.node.property)) {
        const arr = path.node.property.elements;
        if (
          arr.length === 1 &&
          t.isStringLiteral(arr[0]) &&
          !arr[0].value.includes("@")
        ) {
          path.node.property = t.identifier(arr[0].value);
          path.node.computed = false;
          resolved++;
        }
      }
    },
  });

  console.log("resolved " + resolved + " member expr string lit calls");
}

function cleanWildNumbers(program) {
  let cleaned = 0;
  traverse(program, {
    SequenceExpression(path) {
      const prevSize = path.node.expressions.length;
      path.node.expressions = path.node.expressions.filter(
        (expr) => !t.isNumericLiteral(expr)
      );

      if (prevSize !== path.node.expressions.length) {
        cleaned++;
      }

      if (path.node.expressions.length === 0) {
        path.parentPath.remove();
      }
    },
  });

  console.log("cleaned " + cleaned + " wild numbers");
}

module.exports = {
  resolveWindowCalls,
  resolveMemberExprCalls,
  cleanWildNumbers,
};
