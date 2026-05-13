<script lang="ts">
	// Minimal markdown-ish renderer: handles fenced code blocks, inline code, **bold**, and paragraphs.
	// Sufficient for Gemini-generated prompts and feedback. Avoids a heavy markdown dep.

	interface Props {
		text: string;
		class?: string;
	}
	let { text, class: klass = '' }: Props = $props();

	type Block = { kind: 'code'; lang: string; content: string } | { kind: 'text'; content: string };

	function parse(s: string): Block[] {
		const blocks: Block[] = [];
		const re = /```(\w+)?\n([\s\S]*?)```/g;
		let lastIdx = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(s)) !== null) {
			if (m.index > lastIdx) blocks.push({ kind: 'text', content: s.slice(lastIdx, m.index) });
			blocks.push({ kind: 'code', lang: m[1] ?? 'cpp', content: m[2] });
			lastIdx = m.index + m[0].length;
		}
		if (lastIdx < s.length) blocks.push({ kind: 'text', content: s.slice(lastIdx) });
		return blocks;
	}

	function escapeHtml(s: string): string {
		return s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}

	function renderInline(s: string): string {
		let out = escapeHtml(s);
		out = out.replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-[0.9em] font-mono">$1</code>');
		out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
		out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
		return out;
	}

	const blocks = $derived(parse(text ?? ''));
</script>

<div class={klass}>
	{#each blocks as b, i (i)}
		{#if b.kind === 'code'}
			<pre class="bg-muted my-3 overflow-x-auto rounded-md p-3 text-xs leading-relaxed"><code class="font-mono">{b.content}</code></pre>
		{:else}
			{#each b.content.split(/\n{2,}/) as para, j (j)}
				{#if para.trim()}
					<p class="my-2 whitespace-pre-wrap leading-relaxed">{@html renderInline(para)}</p>
				{/if}
			{/each}
		{/if}
	{/each}
</div>
