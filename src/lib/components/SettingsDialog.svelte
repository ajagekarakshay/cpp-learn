<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Settings as SettingsIcon, Eye, EyeOff, ExternalLink } from '@lucide/svelte';
	import { settings, GEMINI_MODELS, type GeminiModel } from '$lib/stores/settings.svelte';

	interface Props {
		open?: boolean;
		// If passed, the dialog renders inline (no trigger). Useful when the caller wants its own button.
		hideTrigger?: boolean;
	}
	let { open = $bindable(false), hideTrigger = false }: Props = $props();

	let draftKey = $state('');
	let draftModel = $state<GeminiModel>('gemini-3-flash-preview');
	let revealed = $state(false);

	$effect(() => {
		if (open) {
			draftKey = settings.state.geminiApiKey;
			draftModel = settings.state.geminiModel;
			revealed = false;
		}
	});

	function save() {
		settings.setKey(draftKey);
		settings.setModel(draftModel);
		open = false;
	}

	function clearKey() {
		settings.clearKey();
		draftKey = '';
	}
</script>

<Dialog.Root bind:open>
	{#if !hideTrigger}
		<Dialog.Trigger>
			{#snippet child({ props })}
				<Button variant="ghost" size="sm" {...props} title="Settings">
					<SettingsIcon class="size-4" />
				</Button>
			{/snippet}
		</Dialog.Trigger>
	{/if}
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="font-heading">Settings</Dialog.Title>
			<Dialog.Description>
				Your Gemini API key stays in this browser. It's sent to this app's server only to forward
				requests to Google.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-2">
			<div class="space-y-1.5">
				<label for="apiKey" class="text-sm font-medium">Gemini API key</label>
				<div class="flex gap-1.5">
					<div class="relative flex-1">
						<Input
							id="apiKey"
							type={revealed ? 'text' : 'password'}
							placeholder="AIza..."
							bind:value={draftKey}
							autocomplete="off"
							class="pr-9 font-mono text-xs"
						/>
						<button
							type="button"
							class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
							onclick={() => (revealed = !revealed)}
							aria-label={revealed ? 'Hide key' : 'Show key'}
						>
							{#if revealed}<EyeOff class="size-3.5" />{:else}<Eye class="size-3.5" />{/if}
						</button>
					</div>
					{#if draftKey}
						<Button variant="outline" size="sm" onclick={clearKey}>Clear</Button>
					{/if}
				</div>
				<p class="text-muted-foreground text-xs">
					Get a free key at
					<a
						href="https://aistudio.google.com/apikey"
						target="_blank"
						rel="noreferrer"
						class="underline-offset-2 hover:underline inline-flex items-center gap-0.5"
					>
						aistudio.google.com/apikey <ExternalLink class="size-3" />
					</a>
				</p>
			</div>

			<div class="space-y-1.5">
				<label for="model" class="text-sm font-medium">Model</label>
				<div class="grid gap-1.5">
					{#each GEMINI_MODELS as m (m.id)}
						<label
							class="hover:bg-accent/30 flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm {draftModel ===
							m.id
								? 'border-foreground/60 bg-accent/30'
								: ''}"
						>
							<input
								type="radio"
								name="model"
								value={m.id}
								bind:group={draftModel}
								class="mt-0.5"
							/>
							<div class="flex-1">
								<div class="font-medium">{m.label}</div>
								<div class="text-muted-foreground text-xs">{m.hint}</div>
							</div>
							<code class="text-muted-foreground font-mono text-[10px]">{m.id}</code>
						</label>
					{/each}
				</div>
			</div>
		</div>

		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button variant="outline" {...props}>Cancel</Button>
				{/snippet}
			</Dialog.Close>
			<Button onclick={save}>Save</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
