<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Separator } from '$lib/components/ui/separator';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { progress } from '$lib/stores/progress.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import CodeEditor from '$lib/components/CodeEditor.svelte';
	import Markdownish from '$lib/components/Markdownish.svelte';
	import SettingsDialog from '$lib/components/SettingsDialog.svelte';
	import type {
		CompileResult,
		ConceptsData,
		CppStandard,
		Evaluation,
		Question,
		QuestionKind
	} from '$lib/types';
	import conceptsRaw from '$lib/data/concepts.json' with { type: 'json' };
	import {
		ArrowLeft,
		Play,
		Send,
		RefreshCw,
		ChevronRight,
		Lightbulb,
		AlertTriangle,
		CheckCircle2,
		Sparkles,
		KeyRound
	} from '@lucide/svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const all = conceptsRaw as ConceptsData;

	const concept = $derived(data.concept);
	const mod = $derived(data.module);

	// State machine: 'idle' → 'generating' → 'answering' → 'evaluating' → 'graded'
	let phase = $state<'idle' | 'generating' | 'answering' | 'evaluating' | 'graded'>('idle');
	let question = $state<Question | null>(null);
	let userAnswer = $state('');
	let userCode = $state('');
	let mcqChoice = $state<string | null>(null);
	let compileResult = $state<CompileResult | null>(null);
	let compiling = $state(false);
	let evaluation = $state<Evaluation | null>(null);
	let errorMsg = $state<string | null>(null);
	let revealedHints = $state(0);
	let startedAt = $state(0);
	let standard = $derived<CppStandard>(progress.state.preferredStandard);
	let settingsOpen = $state(false);

	const cp = $derived(progress.getConcept(concept.id));

	// Reset state when concept changes.
	$effect(() => {
		// Track the concept ID so the effect re-runs when it changes.
		void concept.id;
		question = null;
		userAnswer = '';
		userCode = '';
		mcqChoice = null;
		compileResult = null;
		evaluation = null;
		errorMsg = null;
		revealedHints = 0;
		phase = 'idle';
	});

	async function generate(opts: { preferKind?: QuestionKind } = {}) {
		if (!settings.hasKey) {
			errorMsg = 'Add your Gemini API key in Settings to generate questions.';
			settingsOpen = true;
			return;
		}
		phase = 'generating';
		errorMsg = null;
		evaluation = null;
		compileResult = null;
		try {
			const recentTitles = progress.state.attempts
				.filter((a) => a.conceptId === concept.id)
				.map((a) => a.questionId);
			const res = await fetch('/api/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					apiKey: settings.state.geminiApiKey,
					model: settings.state.geminiModel,
					conceptId: concept.id,
					standard,
					skillEstimate: progress.state.skillEstimate,
					preferKind: opts.preferKind,
					progress: cp,
					gapsAcross: progress.recentGapsAcross(8),
					avoidTitles: recentTitles
				})
			});
			if (!res.ok) throw new Error(await res.text());
			const q = (await res.json()) as Question;
			question = q;
			userAnswer = '';
			userCode = q.starterCode ?? defaultStarter();
			mcqChoice = null;
			revealedHints = 0;
			startedAt = Date.now();
			phase = 'answering';
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
			phase = 'idle';
		}
	}

	function defaultStarter(): string {
		return `#include <iostream>\n\nint main() {\n    // your code here\n    return 0;\n}\n`;
	}

	async function runCode() {
		if (!question) return;
		compiling = true;
		errorMsg = null;
		try {
			const res = await fetch('/api/compile', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ source: userCode, standard })
			});
			if (!res.ok) throw new Error(await res.text());
			compileResult = (await res.json()) as CompileResult;
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
		} finally {
			compiling = false;
		}
	}

	async function submit() {
		if (!question) return;
		phase = 'evaluating';
		errorMsg = null;
		try {
			const answerText =
				question.kind === 'mcq'
					? (mcqChoice ?? '')
					: question.kind === 'fix-bug' || question.kind === 'implement'
						? userAnswer.trim()
							? userAnswer
							: '(see code)'
						: userAnswer;
			const res = await fetch('/api/evaluate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					apiKey: settings.state.geminiApiKey,
					model: settings.state.geminiModel,
					question,
					userAnswer: answerText,
					userCode: question.kind === 'fix-bug' || question.kind === 'implement' ? userCode : undefined,
					compileStdout: compileResult?.stdout,
					compileStderr: compileResult?.stderr
				})
			});
			if (!res.ok) throw new Error(await res.text());
			const ev = (await res.json()) as Evaluation;
			evaluation = ev;
			progress.recordAttempt(question, ev, Date.now() - startedAt);
			phase = 'graded';
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
			phase = 'answering';
		}
	}

	function skip() {
		if (!question) return;
		progress.recordSkip(question, Date.now() - startedAt);
		generate();
	}

	function nextConcept() {
		const id = progress.suggestNextConceptId();
		if (id && id !== concept.id) goto(`/learn/${id}`);
		else goto('/');
	}

	const verdictColor = $derived(
		evaluation?.verdict === 'correct'
			? 'text-emerald-600 dark:text-emerald-400'
			: evaluation?.verdict === 'partial'
				? 'text-amber-600 dark:text-amber-400'
				: 'text-rose-600 dark:text-rose-400'
	);

	const kinds: { value: QuestionKind; label: string }[] = [
		{ value: 'predict-output', label: 'Predict output' },
		{ value: 'mcq', label: 'Multiple choice' },
		{ value: 'fix-bug', label: 'Fix the bug' },
		{ value: 'implement', label: 'Implement' },
		{ value: 'explain', label: 'Explain' }
	];

	const needsEditor = $derived(
		question?.kind === 'fix-bug' || question?.kind === 'implement' || question?.kind === 'predict-output'
	);
</script>

<svelte:head><title>{concept.number} {concept.title} · C++ Quant Dojo</title></svelte:head>

<div class="mx-auto max-w-7xl px-6 py-6">
	<!-- Top bar -->
	<div class="mb-4 flex items-center justify-between">
		<Button variant="ghost" size="sm" onclick={() => goto('/')}>
			<ArrowLeft class="mr-1 size-4" /> Dashboard
		</Button>
		<div class="text-muted-foreground flex items-center gap-3 text-xs">
			<span>Module {mod?.number} · {mod?.title}</span>
			<Badge variant="outline" class="font-mono">{standard}</Badge>
			<Badge variant="outline" class="capitalize">{cp?.status ?? 'unlocked'}</Badge>
			<SettingsDialog bind:open={settingsOpen} />
		</div>
	</div>

	{#if !settings.hasKey}
		<div class="border-amber-500/30 bg-amber-500/5 mb-4 flex items-start gap-3 rounded-md border p-3 text-sm">
			<KeyRound class="text-amber-600 dark:text-amber-400 mt-0.5 size-4 shrink-0" />
			<div class="flex-1">
				No Gemini API key set. Generation and grading are disabled until you add one.
			</div>
			<Button size="sm" onclick={() => (settingsOpen = true)}>Add key</Button>
		</div>
	{/if}

	<div class="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
		<!-- Left: concept + question. min-w-0 prevents wide children (long error lines, code blocks)
			from blowing out the column width in CSS Grid. -->
		<div class="flex min-w-0 flex-col gap-4">
			<Card.Root>
				<Card.Header>
					<Card.Description class="font-mono text-xs">{concept.number}</Card.Description>
					<Card.Title class="font-heading text-2xl">{concept.title}</Card.Title>
				</Card.Header>
			</Card.Root>

			{#if phase === 'idle'}
				<Card.Root>
					<Card.Header>
						<Card.Title class="font-heading text-lg">Pick a question style</Card.Title>
						<Card.Description>
							Gemini will generate a {standard} question tailored to your skill level and recent gaps.
						</Card.Description>
					</Card.Header>
					<Card.Content>
						<div class="flex flex-wrap gap-2">
							<Button onclick={() => generate()} disabled={!settings.hasKey}>
								<Sparkles class="mr-1 size-4" /> Surprise me
							</Button>
							{#each kinds as k (k.value)}
								<Button
									variant="outline"
									size="sm"
									onclick={() => generate({ preferKind: k.value })}
									disabled={!settings.hasKey}
								>
									{k.label}
								</Button>
							{/each}
						</div>
					</Card.Content>
				</Card.Root>
			{/if}

			{#if phase === 'generating'}
				<Card.Root>
					<Card.Header>
						<Card.Title class="font-heading text-lg">Generating a question...</Card.Title>
					</Card.Header>
					<Card.Content class="space-y-2">
						<Skeleton class="h-4 w-3/4" />
						<Skeleton class="h-4 w-full" />
						<Skeleton class="h-4 w-5/6" />
						<Skeleton class="h-24 w-full" />
					</Card.Content>
				</Card.Root>
			{/if}

			{#if question && (phase === 'answering' || phase === 'evaluating' || phase === 'graded')}
				<Card.Root>
					<Card.Header>
						<div class="flex items-center justify-between gap-3">
							<Card.Title class="font-heading text-lg">{question.title}</Card.Title>
							<Badge variant="secondary" class="capitalize">{question.kind.replace('-', ' ')}</Badge>
						</div>
					</Card.Header>
					<Card.Content>
						<Markdownish text={question.prompt} class="text-sm" />

						{#if question.hints.length > 0}
							<div class="mt-3">
								{#if revealedHints < question.hints.length}
									<Button
										variant="ghost"
										size="sm"
										onclick={() => (revealedHints += 1)}
									>
										<Lightbulb class="mr-1 size-3.5" />
										Reveal hint {revealedHints + 1} of {question.hints.length}
									</Button>
								{/if}
								{#each question.hints.slice(0, revealedHints) as h, i (i)}
									<div class="bg-muted/50 mt-2 rounded-md border-l-2 border-amber-500 px-3 py-2 text-xs">
										<span class="text-amber-700 dark:text-amber-400 font-semibold">Hint {i + 1}:</span>
										{h}
									</div>
								{/each}
							</div>
						{/if}
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header>
						<Card.Title class="font-heading text-base">Your answer</Card.Title>
					</Card.Header>
					<Card.Content class="space-y-3">
						{#if question.kind === 'mcq' && question.choices}
							<div class="flex flex-col gap-2">
								{#each question.choices as ch (ch.id)}
									<label
										class="hover:bg-accent/30 flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm transition {mcqChoice ===
										ch.id
											? 'border-foreground/60 bg-accent/30'
											: ''}"
									>
										<input
											type="radio"
											name="mcq"
											value={ch.id}
											bind:group={mcqChoice}
											disabled={phase === 'graded'}
											class="mt-0.5"
										/>
										<div>
											<span class="text-muted-foreground mr-2 font-mono text-xs">{ch.id}</span>
											<span>{ch.text}</span>
										</div>
									</label>
								{/each}
							</div>
						{:else if question.kind === 'predict-output'}
							<Textarea
								bind:value={userAnswer}
								placeholder="Type the EXACT stdout you expect (including newlines)."
								rows={5}
								disabled={phase === 'graded'}
								class="font-mono text-xs"
							/>
						{:else if question.kind === 'explain'}
							<Textarea
								bind:value={userAnswer}
								placeholder="Explain in your own words. Be specific about mechanism and tradeoffs."
								rows={8}
								disabled={phase === 'graded'}
							/>
						{:else}
							<Textarea
								bind:value={userAnswer}
								placeholder="Optional written notes — explain your approach. Code goes in the editor on the right."
								rows={3}
								disabled={phase === 'graded'}
							/>
						{/if}

						<div class="flex flex-wrap items-center gap-2">
							{#if phase !== 'graded'}
								<Button onclick={submit} disabled={phase === 'evaluating'}>
									<Send class="mr-1 size-4" />
									{phase === 'evaluating' ? 'Evaluating...' : 'Submit'}
								</Button>
								<Button variant="ghost" size="sm" onclick={skip}>Skip</Button>
							{:else}
								<Button variant="outline" onclick={() => generate()}>
									<RefreshCw class="mr-1 size-4" /> Another on this concept
								</Button>
								<Button onclick={nextConcept}>
									Next concept <ChevronRight class="ml-1 size-4" />
								</Button>
							{/if}
						</div>
					</Card.Content>
				</Card.Root>

				{#if evaluation}
					<Card.Root>
						<Card.Header>
							<div class="flex items-center justify-between">
								<Card.Title class="font-heading flex items-center gap-2 text-lg {verdictColor}">
									{#if evaluation.verdict === 'correct'}
										<CheckCircle2 class="size-5" />
									{:else}
										<AlertTriangle class="size-5" />
									{/if}
									<span class="capitalize">{evaluation.verdict}</span>
								</Card.Title>
								<div class="text-muted-foreground flex items-center gap-3 text-xs">
									<span>Score: <strong class="text-foreground">{evaluation.score}</strong></span>
									<span>
										Confidence: <strong class="text-foreground">
											{Math.round(evaluation.confidence * 100)}%
										</strong>
									</span>
								</div>
							</div>
						</Card.Header>
						<Card.Content class="space-y-3">
							<Markdownish text={evaluation.feedback} class="text-sm" />
							{#if evaluation.strengths.length}
								<div>
									<div class="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
										Strengths
									</div>
									<ul class="mt-1 list-disc pl-5 text-sm">
										{#each evaluation.strengths as s, i (i)}
											<li>{s}</li>
										{/each}
									</ul>
								</div>
							{/if}
							{#if evaluation.gaps.length}
								<div>
									<div class="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
										Gaps to remember
									</div>
									<ul class="mt-1 list-disc pl-5 text-sm">
										{#each evaluation.gaps as g, i (i)}
											<li>{g}</li>
										{/each}
									</ul>
								</div>
							{/if}
						</Card.Content>
					</Card.Root>
				{/if}
			{/if}

			{#if errorMsg}
				<Card.Root class="border-rose-500/50">
					<Card.Content class="text-sm">
						<div class="font-semibold text-rose-600 dark:text-rose-400">Error</div>
						<div class="text-muted-foreground mt-1 break-all text-xs">{errorMsg}</div>
					</Card.Content>
				</Card.Root>
			{/if}
		</div>

		<!-- Right: editor + compile. min-w-0 so the editor and compile output don't expand the column. -->
		<div class="flex min-w-0 flex-col gap-4">
			<Card.Root class="flex flex-1 flex-col">
				<Card.Header class="flex-row items-center justify-between pb-2">
					<Card.Title class="font-heading text-base">
						Editor <span class="text-muted-foreground ml-2 font-mono text-xs">{standard}</span>
					</Card.Title>
					<div class="flex gap-2">
						<Button
							size="sm"
							variant="outline"
							onclick={runCode}
							disabled={compiling || !question || phase === 'idle'}
						>
							<Play class="mr-1 size-3.5" />
							{compiling ? 'Compiling...' : 'Run'}
						</Button>
					</div>
				</Card.Header>
				<Card.Content class="flex-1 p-3 pt-0">
					{#if question || phase === 'idle'}
						<div class="h-[420px]">
							<CodeEditor bind:value={userCode} height="420px" />
						</div>
					{:else}
						<Skeleton class="h-[420px] w-full" />
					{/if}
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header class="pb-2">
					<Card.Title class="font-heading text-base">Output</Card.Title>
				</Card.Header>
				<Card.Content>
					{#if compileResult}
						<div class="text-muted-foreground mb-2 text-[10px] uppercase tracking-wide">
							exit {compileResult.exitCode} · {compileResult.durationMs}ms
							{#if compileResult.timedOut}· <span class="text-amber-500">timed out</span>{/if}
						</div>
						{#if compileResult.stdout}
							<pre class="bg-muted max-w-full overflow-x-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap break-words">{compileResult.stdout}</pre>
						{/if}
						{#if compileResult.stderr}
							<div class="mt-2 text-[10px] uppercase tracking-wide text-rose-500">stderr</div>
							<pre class="bg-muted max-w-full overflow-x-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap break-words text-rose-600 dark:text-rose-400">{compileResult.stderr}</pre>
						{/if}
					{:else}
						<p class="text-muted-foreground text-xs">
							Run the code to see stdout/stderr. Output is sent to Gemini when you submit.
						</p>
					{/if}
				</Card.Content>
			</Card.Root>

			{#if concept.body}
				<Card.Root>
					<Card.Header class="pb-2">
						<Card.Title class="font-heading text-base">Concept reference</Card.Title>
						<Card.Description class="text-xs">
							From the source learning resource. Same material Gemini uses as ground truth.
						</Card.Description>
					</Card.Header>
					<Card.Content>
						<div class="max-h-[300px] overflow-y-auto pr-2">
							<Markdownish text={concept.body} class="text-xs" />
						</div>
					</Card.Content>
				</Card.Root>
			{/if}
		</div>
	</div>
</div>
