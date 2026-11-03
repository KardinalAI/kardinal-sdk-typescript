/**
 * Compiles TypeScript snippets against the SDK sources, in one program, and
 * returns the diagnostics as "file:line message" lines. Used to check at the
 * type level what a reader's editor would show. The snippets are compiled
 * with the TypeScript version of the lockfile.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const SDK_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const ROOT = dirname(SDK_ENTRY);

export function typecheck(modules: Record<string, string>): string[] {
  // Virtual files live next to the sources so that `types: ["node"]` and
  // the SDK's own imports resolve as they do for the package itself.
  const virtual = new Map(Object.entries(modules).map(([name, text]) => [join(ROOT, "..", ".typecheck", name), text]));
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.es2022.d.ts"],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    types: ["node"],
    paths: { "@kardinal-ai/sdk": [SDK_ENTRY] },
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (file) => virtual.has(file) || fileExists(file);
  host.readFile = (file) => virtual.get(file) ?? readFile(file);
  host.getSourceFile = (file, languageVersion, ...rest) => {
    const text = virtual.get(file);
    if (text === undefined) return getSourceFile(file, languageVersion, ...rest);
    return ts.createSourceFile(file, text, languageVersion, true);
  };
  const program = ts.createProgram([...virtual.keys()], options, host);
  const lines: string[] = [];
  for (const file of virtual.keys()) {
    const source = program.getSourceFile(file)!;
    for (const d of [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]) {
      const { line } = source.getLineAndCharacterOfPosition(d.start ?? 0);
      lines.push(`${file.split("/").pop()}:${line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
    }
  }
  return lines;
}
