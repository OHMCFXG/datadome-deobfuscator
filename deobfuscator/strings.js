const t = require("@babel/types");
const generate = require("@babel/generator").default;
const traverse = require("@babel/traverse").default;

function unescapeStrings(program) {
  traverse(program, {
    StringLiteral(path) {
      let escaped = JSON.stringify(path.node.value).slice(1, -1);
      path.node.extra.rawValue = `"` + escaped + `"`;
    },
  });
}

function mergeStrings(program) {
  let solve = function (binary) {
    let left = binary.left;
    let right = binary.right;

    if (t.isBinaryExpression(left)) {
      let res = solve(left);
      if (res === undefined) return undefined;

      left = res;
    }

    if (t.isBinaryExpression(right)) {
      let res = solve(right);
      if (res === undefined) return undefined;

      right = res;
    }

    if (!t.isStringLiteral(left) || !t.isStringLiteral(right)) {
      return undefined;
    }

    return t.stringLiteral(left.value + right.value);
  };

  let merged = 0;
  traverse(program, {
    BinaryExpression(path) {
      const node = path.node;
      if (node.operator !== "+") {
        return;
      }

      let result = solve(node);
      if (result !== undefined) {
        path.replaceWith(result);
        merged++;
      }
    },
  });

  console.log("merged " + merged + " strings");
}

function resolveStringCharCodes(program) {
  let resolved = 0;
  traverse(program, {
    VariableDeclarator(path) {
      if (!t.isMemberExpression(path.node.init)) {
        return;
      }

      const init = path.node.init;
      if (
        !t.isIdentifier(init.object) ||
        !t.isIdentifier(init.property) ||
        init.object.name !== "String" ||
        init.property.name !== "fromCharCode"
      ) {
        if (
          init.object.name !== "String" ||
          !t.isArrayExpression(init.property)
        ) {
          return;
        }

        let propertyElements = init.property.elements;
        if (
          propertyElements.length !== 1 ||
          !t.isStringLiteral(propertyElements[0]) ||
          propertyElements[0].value !== "fromCharCode"
        ) {
          return;
        }
      }

      const binding = path.scope.getBinding(path.node.id.name);
      for (const refPath of binding.referencePaths) {
        const parent = refPath.parentPath;
        if (!t.isCallExpression(parent)) {
          console.log("not a call expr wtf");
          return;
        }
        const callArgs = parent.node.arguments;
        if (callArgs.length !== 1) {
          console.log("args len is not equal to 1");
          continue;
        }

        if (!t.isNumericLiteral(callArgs[0])) {
          console.log("call arg 0 is not a numeric literal");
          continue;
        }

        parent.replaceWith(
          t.stringLiteral(String.fromCharCode(callArgs[0].value))
        );
        resolved++;
      }
    },
  });

  console.log("resolved " + resolved + " String.fromCharCode calls");
}

function deobfuscateBase64EncodedStrings(program) {
  let deobfuscated = 0;
  let decodeFunctionPath = null;
  let arrayPath = null;
  let arrayElements = null;

  traverse(program, {
    FunctionDeclaration(path) {
      const node = path.node;
      if (node.body.body.length > 5) {
        return;
      }

      let hasAtobCall = false;
      let arrayMemberPath = undefined;
      path.traverse({
        CallExpression(p) {
          if (!hasAtobCall) {
            // not our func
            p.stop();
          }
          if (
            t.isIdentifier(p.node.callee) &&
            p.node.callee.name === "atob" &&
            p.node.arguments.length === 1
          ) {
            hasAtobCall = true;
          }
        },
        MemberExpression(p) {
          if (
            !p.node.computed ||
            !t.isIdentifier(p.node.object) ||
            !t.isIdentifier(p.node.property)
          ) {
            return;
          }

          if (arrayMemberPath !== undefined) {
            p.stop();
            hasAtobCall = false;
            arrayMemberPath = undefined;
            return;
          }

          arrayMemberPath = p;
        },
      });

      if (!hasAtobCall || arrayMemberPath === undefined) {
        return;
      }

      let binding = path.scope.getBinding(arrayMemberPath.node.object.name);
      if (binding === undefined || binding.path === undefined) {
        console.log("could not bind b64 array strings");
        return;
      }

      decodeFunctionPath = path;
      arrayPath = binding.path;
      arrayElements = binding.path.node.init.elements;
      path.stop();
    },
  });

  if (decodeFunctionPath !== null && arrayElements !== null) {
    let references = decodeFunctionPath.scope.getBinding(
      decodeFunctionPath.node.id.name
    ).referencePaths;
    for (const refPath of references) {
      const parentRefPath = refPath.parentPath;
      if (!t.isCallExpression(parentRefPath.node)) {
        console.log(
          "found id to base 64 decode func but parent was not a call expr"
        );
        continue;
      }

      if (parentRefPath.node.arguments.length !== 1) {
        console.log(
          "found base 64 decode func call expr but with unexpected args len"
        );
        continue;
      }

      if (!t.isNumericLiteral(parentRefPath.node.arguments[0])) {
        console.log(
          "found base 64 decode func call expr with correct args len but not a number"
        );
        continue;
      }

      const idx = parentRefPath.node.arguments[0].value;
      const elem = arrayElements[idx];

      if (!t.isStringLiteral(elem)) {
        console.log("base 64 array elem is not a string lit: ");
        console.log(elem);
        continue;
      }

      parentRefPath.replaceWith(t.stringLiteral(atob(elem.value)));
      deobfuscated++;
    }

    arrayPath.remove();
  }

  console.log("deobfuscated " + deobfuscated + " base 64 encoded strings");
}

function deobfuscateEncryptedStringsAndNumbers(program) {
  let decryptFunctionPath = null;
  let arrayName = null;
  let arrayPath = null;
  let arrayElements = null;
  let deobfuscated = 0;

  traverse(program, {
    FunctionDeclaration(path) {
      const node = path.node;
      const debug = path.node.id.name === "r" && path.node.params.length === 2;

      if (node.body.body.length > 3) {
        return;
      }

      const collectedStrings = [];
      path.traverse({
        StringLiteral(p) {
          collectedStrings.push(p.node.value);
        },
        Identifier(p) {
          collectedStrings.push(p.node.name);
        }
      });

      if (
        !collectedStrings.includes("fromCharCode") ||
        !collectedStrings.includes("charAt") ||
        !collectedStrings.includes("string") ||
        !collectedStrings.includes("replace")
      ) {
        return;
      }

      let arrayMemberPath = undefined;
      path.traverse({
        MemberExpression(p) {
          if (
            !p.node.computed ||
            !t.isIdentifier(p.node.object) ||
            !t.isIdentifier(p.node.property) ||
            p.node.property.name !== path.node.params[0].name
          ) {
            return;
          }

          arrayMemberPath = p;
          p.stop();
        },
      });

      if (arrayMemberPath === undefined) {
        return;
      }

      // maybe add more checks
      // too lazy for now
      const arrayBinding = path.scope.getBinding(
        arrayMemberPath.node.object.name
      );
      if (arrayBinding === undefined) {
        console.log("could not find encrypted strings/numbers arr");
        return;
      }

      arrayName = arrayMemberPath.node.object.name;
      arrayPath = arrayBinding.path;
      arrayElements = arrayBinding.path.node.init.elements;
      decryptFunctionPath = path;
      path.stop();
    },
  });

  if (decryptFunctionPath === null || arrayElements === null) {
    console.log("could not find string decrypt func");
    return;
  }

  let vmCode =
    "let array = [];" +
    generate(
      t.variableDeclaration("let", [
        t.variableDeclarator(
          t.identifier(arrayName),
          t.arrayExpression(arrayElements)
        ),
      ])
    ).code +
    ";" +
    generate(decryptFunctionPath.node).code +
    ";";

  const encryptedStringIdxToPaths = [];

  let references = decryptFunctionPath.scope.getBinding(
    decryptFunctionPath.node.id.name
  ).referencePaths;
  for (const refPath of references) {
    const parentRefPath = refPath.parentPath;
    if (!t.isCallExpression(parentRefPath.node)) {
      console.log("found id to decrypt func but parent was not a call expr");
      continue;
    }

    if (parentRefPath.node.arguments.length !== 1) {
      console.log("found decrypt func call expr but with unexpected args len");
      continue;
    }

    if (!t.isNumericLiteral(parentRefPath.node.arguments[0])) {
      console.log(
        "found decrypt func call expr with correct args len but not a number"
      );
      continue;
    }

    const idx = parentRefPath.node.arguments[0].value;
    const elem = arrayElements[idx];

    if (!t.isStringLiteral(elem)) {
      if (t.isNumericLiteral(elem)) {
        parentRefPath.replaceWith(elem);
        deobfuscated++;
        continue;
      }

      if (t.isUnaryExpression(elem)) {
        const unaryArg = elem.argument;
        if (
          elem.operator === "-" &&
          t.isNumericLiteral(unaryArg) &&
          elem.prefix
        ) {
          parentRefPath.replaceWith(t.unaryExpression("-", unaryArg, true));
          deobfuscated++;
          continue;
        }
      }

      if (t.isNullLiteral(elem)) {
        parentRefPath.replaceWith(elem);
        deobfuscated++;
        continue;
      }

      if (
        t.isUnaryExpression(elem) &&
        elem.prefix &&
        elem.operator === "!" &&
        t.isNumericLiteral(elem.argument)
      ) {
        parentRefPath.replaceWith(t.booleanLiteral(elem.argument.value === 0));
        deobfuscated++;
        continue;
      }

      console.log("unexpected decrypt func arr val type: ");
      console.log(elem);
      continue;
    }

    let idxArray = encryptedStringIdxToPaths[idx];
    if (idxArray === undefined) {
      encryptedStringIdxToPaths[idx] = [];
      idxArray = encryptedStringIdxToPaths[idx];
      vmCode +=
        "array[" +
        idx +
        "]=" +
        decryptFunctionPath.node.id.name +
        "(" +
        idx +
        ");";
    }

    idxArray.push(parentRefPath);
  }

  vmCode += "array";
  let decryptedArray = eval(vmCode);

  for (let i = 0; i < decryptedArray.length; ++i) {
    const result = decryptedArray[i];
    if (result === undefined) {
      continue;
    }

    let paths = encryptedStringIdxToPaths[i];
    for (const path of paths) {
      path.replaceWith(t.stringLiteral(result));
    }
    deobfuscated++;
  }

  decryptFunctionPath.remove();
  arrayPath.remove();

  console.log(
    "deobfuscated " + deobfuscated + " encrypted strings/pooled numbers"
  );
}

module.exports = {
  unescapeStrings,
  mergeStrings,
  resolveStringCharCodes,
  deobfuscateBase64EncodedStrings,
  deobfuscateEncryptedStringsAndNumbers,
};
