const { deobfuscate } = require("./deobfuscator/deobfuscator");
const fs = require("node:fs");

const input = fs.readFileSync("input.js");
const output = deobfuscate(input.toString());
fs.writeFileSync("output.js", output.toString());