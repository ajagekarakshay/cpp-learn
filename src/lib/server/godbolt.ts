import type { CppStandard, CompileResult } from '$lib/types';

// Godbolt / Compiler Explorer compiler IDs. These are stable, public identifiers used by godbolt.org.
// We pick a recent GCC that supports the requested standard's flag (-std=c++26 etc).
// gcc 14.2 supports -std=c++26 (as of late 2025). Earlier versions accept c++20/c++23 fine.
const GCC_COMPILER = 'g142'; // GCC 14.2

const STD_FLAG: Record<CppStandard, string> = {
	'c++20': '-std=c++20',
	'c++23': '-std=c++23',
	'c++26': '-std=c++26'
};

interface GodboltExecBlock {
	code?: number;
	stdout?: { text: string }[];
	stderr?: { text: string }[];
	timedOut?: boolean;
}
interface GodboltResponse extends GodboltExecBlock {
	didExecute?: boolean;
	buildResult?: GodboltExecBlock;
	asm?: { text: string }[];
}

export async function compileAndRun(
	source: string,
	standard: CppStandard,
	opts: { stdin?: string; wantAsm?: boolean } = {}
): Promise<CompileResult> {
	const start = Date.now();
	const flags = `${STD_FLAG[standard]} -O2 -Wall -Wextra -Wpedantic`;

	const body = {
		source,
		options: {
			userArguments: flags,
			executeParameters: { args: '', stdin: opts.stdin ?? '' },
			compilerOptions: { executorRequest: true, skipAsm: !opts.wantAsm },
			filters: {
				execute: true,
				binary: false,
				labels: true,
				directives: true,
				commentOnly: true,
				demangle: true,
				intel: true
			}
		},
		lang: 'c++',
		allowStoreCodeDebug: false
	};

	const url = `https://godbolt.org/api/compiler/${GCC_COMPILER}/compile`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: JSON.stringify(body)
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`godbolt error ${res.status}: ${text.slice(0, 500)}`);
	}
	const data = (await res.json()) as GodboltResponse;

	// With executorRequest: true, the top-level fields are the runtime result; buildResult holds compile.
	const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
	const compileErr = stripAnsi((data.buildResult?.stderr ?? []).map((s) => s.text).join('\n'));
	const runStdout = (data.stdout ?? []).map((s) => s.text).join('\n');
	const runStderr = stripAnsi((data.stderr ?? []).map((s) => s.text).join('\n'));
	const buildFailed = (data.buildResult?.code ?? 0) !== 0;

	return {
		stdout: runStdout,
		stderr: [compileErr, runStderr].filter(Boolean).join('\n').trim(),
		asm: opts.wantAsm ? (data.asm ?? []).map((a) => a.text).join('\n') : undefined,
		exitCode: buildFailed ? (data.buildResult?.code ?? 1) : (data.code ?? 0),
		timedOut: !!data.timedOut || !!data.buildResult?.timedOut,
		durationMs: Date.now() - start
	};
}
