import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";


const banner =
	`/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/
`;

const prod = (process.argv[2] === "production");

const esbuildOptions = {
	banner: {
		js: banner,
	},
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins
	],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
}

const context = await esbuild.context(
	{...esbuildOptions},
	// {
	// 	plugins: [inlineWorkerPlugin({
	// 		// target: "browser",
	// 		// entryPoints: ["main.ts"],
	// 		// bundle: true,
	// 		// sourcemap: prod ? false : "inline",
	// 		external: esbuildOptions.external,
	// 		// outfile: "worker.ts",
	// 	})],
	// }
);

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
