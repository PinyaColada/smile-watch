import { transform } from "esbuild";
import { readFile, writeFile, readdir } from "node:fs/promises";
for (const dir of ["web", "scripts", "tests"]) for (const file of await readdir(dir)) {
  if (!file.endsWith(".js") && !file.endsWith(".mjs") && !file.endsWith(".css")) continue;
  const path = `${dir}/${file}`, source = await readFile(path, "utf8");
  const { code } = await transform(source, { loader: file.endsWith(".css") ? "css" : "js", target: "esnext", minify: false, legalComments: "inline" });
  await writeFile(path, code);
}
