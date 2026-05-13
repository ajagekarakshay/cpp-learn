<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import { Progress } from '$lib/components/ui/progress';
	import { Separator } from '$lib/components/ui/separator';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import * as Tabs from '$lib/components/ui/tabs';
	import { progress } from '$lib/stores/progress.svelte';
	import type { ConceptsData, CppStandard } from '$lib/types';
	import conceptsRaw from '$lib/data/concepts.json' with { type: 'json' };
	import { Lock, Sparkles, Zap, ChevronRight, RotateCcw, KeyRound } from '@lucide/svelte';
	import SettingsDialog from '$lib/components/SettingsDialog.svelte';
	import { settings } from '$lib/stores/settings.svelte';

	const data = conceptsRaw as ConceptsData;

	const practiceModules = $derived(
		data.modules
			.filter((m) => data.practiceModuleIds.includes(m.id))
			.sort((a, b) => a.number - b.number)
	);

	const skill = $derived(progress.state.skillEstimate);
	const totalPractice = $derived(
		data.concepts.filter((c) => data.practiceModuleIds.includes(c.moduleId)).length
	);
	const mastered = $derived(
		Object.values(progress.state.concepts).filter((c) => c.status === 'mastered').length
	);
	const inProgress = $derived(
		Object.values(progress.state.concepts).filter(
			(c) => c.status === 'in-progress' || c.status === 'shaky'
		).length
	);

	const overallPct = $derived(Math.round((mastered / Math.max(1, totalPractice)) * 100));

	const standards: CppStandard[] = ['c++20', 'c++23', 'c++26'];

	const suggested = $derived.by(() => {
		const id = progress.suggestNextConceptId();
		if (!id) return null;
		return data.concepts.find((c) => c.id === id) ?? null;
	});

	function statusColor(status: string) {
		switch (status) {
			case 'mastered':
				return 'bg-emerald-500';
			case 'shaky':
				return 'bg-amber-500';
			case 'in-progress':
				return 'bg-sky-500';
			case 'unlocked':
				return 'bg-muted-foreground/40';
			default:
				return 'bg-muted';
		}
	}

	function setStd(s: CppStandard) {
		progress.setStandard(s);
	}

	function jumpTo(conceptId: string) {
		goto(`/learn/${conceptId}`);
	}

	function confirmReset() {
		if (confirm('Reset all progress? This clears your local cache.')) progress.reset();
	}

	let settingsOpen = $state(false);
</script>

<svelte:head><title>C++ Quant Dojo</title></svelte:head>

<div class="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
	<header class="flex flex-col gap-2">
		<div class="flex items-baseline justify-between">
			<h1 class="font-heading text-4xl font-semibold tracking-tight">C++ Quant Dojo</h1>
			<div class="flex items-center gap-2">
				<span class="text-muted-foreground text-sm">Standard:</span>
				<div class="bg-muted inline-flex rounded-md p-0.5">
					{#each standards as s (s)}
						<button
							type="button"
							class="rounded px-2.5 py-1 text-xs font-medium transition {progress.state
								.preferredStandard === s
								? 'bg-background shadow-sm'
								: 'text-muted-foreground hover:text-foreground'}"
							onclick={() => setStd(s)}
						>
							{s}
						</button>
					{/each}
				</div>
				<Button variant="ghost" size="sm" onclick={confirmReset} title="Reset progress">
					<RotateCcw class="size-4" />
				</Button>
				<SettingsDialog bind:open={settingsOpen} />
			</div>
		</div>
		<p class="text-muted-foreground max-w-2xl">
			LeetCode-style practice for C++20/23/26 quant interview prep. Questions are generated
			against your weak points by Gemini. Your progress lives in this browser only.
		</p>
	</header>

	{#if !settings.hasKey}
		<div class="border-amber-500/30 bg-amber-500/5 flex items-start gap-3 rounded-md border p-4">
			<KeyRound class="text-amber-600 dark:text-amber-400 mt-0.5 size-5 shrink-0" />
			<div class="flex-1">
				<div class="font-medium">Add your Gemini API key to start practicing</div>
				<p class="text-muted-foreground mt-1 text-sm">
					Questions are generated and graded by Gemini. Your key is stored only in this browser
					and forwarded server-side per request.
				</p>
			</div>
			<Button onclick={() => (settingsOpen = true)}>Add key</Button>
		</div>
	{/if}

	<div class="grid gap-4 md:grid-cols-3">
		<Card.Root>
			<Card.Header>
				<Card.Description>Skill estimate</Card.Description>
				<Card.Title class="font-heading text-2xl capitalize">{skill}</Card.Title>
			</Card.Header>
			<Card.Content>
				<Progress value={overallPct} />
				<p class="text-muted-foreground mt-2 text-xs">
					{mastered} mastered · {inProgress} in progress · {totalPractice} total
				</p>
			</Card.Content>
		</Card.Root>

		<Card.Root class="md:col-span-2">
			<Card.Header>
				<Card.Description class="flex items-center gap-1.5">
					<Sparkles class="size-3.5" /> Suggested next
				</Card.Description>
				{#if suggested}
					<Card.Title class="font-heading text-xl">
						{suggested.number} {suggested.title}
					</Card.Title>
					<p class="text-muted-foreground text-sm">{suggested.moduleTitle}</p>
				{:else}
					<Card.Title class="font-heading text-xl">All caught up</Card.Title>
				{/if}
			</Card.Header>
			<Card.Footer>
				{#if suggested}
					<Button onclick={() => jumpTo(suggested.id)} disabled={!settings.hasKey}>
						Continue <ChevronRight class="ml-1 size-4" />
					</Button>
				{/if}
			</Card.Footer>
		</Card.Root>
	</div>

	<Separator />

	<Tabs.Root value="curriculum" class="w-full">
		<Tabs.List>
			<Tabs.Trigger value="curriculum">Curriculum</Tabs.Trigger>
			<Tabs.Trigger value="history">Recent activity</Tabs.Trigger>
			<Tabs.Trigger value="gaps">Misconception log</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="curriculum" class="mt-4">
			<div class="grid gap-3">
				{#each practiceModules as mod (mod.id)}
					{@const s = progress.moduleStatus(mod.id)}
					<Card.Root>
						<Card.Header class="pb-3">
							<div class="flex items-baseline justify-between gap-4">
								<div>
									<Card.Description class="text-xs">Module {mod.number}</Card.Description>
									<Card.Title class="font-heading text-lg">{mod.title}</Card.Title>
								</div>
								<div class="text-muted-foreground text-xs">
									{s.mastered}/{s.total} mastered
								</div>
							</div>
						</Card.Header>
						<Card.Content>
							<div class="flex flex-wrap gap-1.5">
								{#each mod.conceptIds as cid (cid)}
									{@const c = data.concepts.find((x) => x.id === cid)}
									{@const p = progress.getConcept(cid)}
									{#if c && p}
										<button
											type="button"
											class="group inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition {p.status ===
											'locked'
												? 'text-muted-foreground/60 cursor-not-allowed border-dashed'
												: 'hover:border-foreground/40 hover:bg-accent/30'}"
											disabled={p.status === 'locked'}
											onclick={() => jumpTo(cid)}
											title={`${c.number} ${c.title} — ${p.status}`}
										>
											<span class="size-1.5 rounded-full {statusColor(p.status)}"></span>
											<span class="font-mono text-[10px]">{c.number}</span>
											<span class="max-w-[200px] truncate">{c.title}</span>
											{#if p.status === 'locked'}
												<Lock class="size-3" />
											{/if}
										</button>
									{/if}
								{/each}
							</div>
						</Card.Content>
					</Card.Root>
				{/each}
			</div>
		</Tabs.Content>

		<Tabs.Content value="history" class="mt-4">
			<Card.Root>
				<Card.Content class="p-0">
					<ScrollArea class="h-[420px]">
						{#if progress.state.attempts.length === 0}
							<p class="text-muted-foreground p-6 text-sm">
								No attempts yet. Pick a concept above to start.
							</p>
						{:else}
							<ul class="divide-y">
								{#each progress.state.attempts.slice(0, 60) as a (a.questionId)}
									{@const c = data.concepts.find((x) => x.id === a.conceptId)}
									<li class="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
										<div class="flex items-center gap-2 truncate">
											<span
												class="size-2 rounded-full {a.verdict === 'correct'
													? 'bg-emerald-500'
													: a.verdict === 'partial'
														? 'bg-amber-500'
														: a.verdict === 'skipped'
															? 'bg-muted-foreground/50'
															: 'bg-rose-500'}"
											></span>
											<span class="font-mono text-xs">{c?.number ?? '?'}</span>
											<span class="truncate">{c?.title ?? a.conceptId}</span>
											<Badge variant="outline" class="ml-1 text-[10px] capitalize">
												{a.kind}
											</Badge>
										</div>
										<div class="text-muted-foreground flex items-center gap-3 text-xs">
											<span class="capitalize">{a.verdict}</span>
											<span>{new Date(a.at).toLocaleString()}</span>
										</div>
									</li>
								{/each}
							</ul>
						{/if}
					</ScrollArea>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="gaps" class="mt-4">
			<Card.Root>
				<Card.Header>
					<Card.Title class="font-heading flex items-center gap-2 text-lg">
						<Zap class="size-4" /> Misconceptions Gemini will probe next
					</Card.Title>
					<Card.Description>
						Aggregated from your recent attempts. Used to bias new question generation.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					{#each progress.recentGapsAcross(20) as g (g)}
						<div class="border-border/60 border-l-2 py-1.5 pl-3 text-sm">{g}</div>
					{:else}
						<p class="text-muted-foreground text-sm">
							No recorded misconceptions yet. They'll appear here as you answer questions.
						</p>
					{/each}
				</Card.Content>
			</Card.Root>
		</Tabs.Content>
	</Tabs.Root>
</div>
