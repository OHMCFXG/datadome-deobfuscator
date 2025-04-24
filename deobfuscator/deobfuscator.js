const parser = require("@babel/parser");
const generate = require("@babel/generator").default;

const {
  unescapeStrings,
  resolveStringCharCodes,
  mergeStrings,
  deobfuscateBase64EncodedStrings,
  deobfuscateEncryptedStringsAndNumbers,
} = require("./strings");
const {
  resolveMathFunctions,
  solveStaticMathOperations,
  resolveStaticMath,
} = require("./numbers");
const {
  resolveWindowCalls,
  resolveMemberExprCalls,
  cleanWildNumbers,
} = require("./misc");
const { resolveOpaquePredicates, deobfuscateSwitchCases } = require("./switch");
const {
  removeTrashFlow,
  fixLogicalExpressions,
  fixTrashIfs,
} = require("./flow");

function deobfuscate(script) {
  const parsedProgram = parser.parse(script, {});
  const start = performance.now();

  unescapeStrings(parsedProgram);
  resolveMathFunctions(script, parsedProgram);
  resolveStringCharCodes(parsedProgram);
  mergeStrings(parsedProgram);
  deobfuscateBase64EncodedStrings(parsedProgram);
  deobfuscateEncryptedStringsAndNumbers(parsedProgram);
  resolveMathFunctions(script, parsedProgram);
  resolveWindowCalls(parsedProgram);
  resolveMemberExprCalls(parsedProgram);
  resolveStaticMath(parsedProgram);
  resolveOpaquePredicates(parsedProgram);
  solveStaticMathOperations(parsedProgram);
  removeTrashFlow(parsedProgram);
  removeTrashFlow(parsedProgram);
  deobfuscateSwitchCases(parsedProgram);
  cleanWildNumbers(parsedProgram);
  fixLogicalExpressions(parsedProgram);
  fixTrashIfs(parsedProgram);

  console.log("took " + (performance.now() - start) + "ms to run transformers");
  const result = generate(parsedProgram, {
    comments: true,
    minified: false,
    concise: false,
  }).code;

  return result;
}

module.exports = {deobfuscate};
