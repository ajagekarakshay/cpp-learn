<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	interface Props {
		value: string;
		language?: string;
		theme?: 'vs-dark' | 'vs';
		height?: string;
		readonly?: boolean;
	}

	let {
		value = $bindable(''),
		language = 'cpp',
		theme = 'vs-dark',
		height = '100%',
		readonly = false
	}: Props = $props();

	let container: HTMLDivElement;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let editor: any;
	let disposed = false;

	onMount(async () => {
		// Lazy-load monaco and its editor worker only on the client.
		const [monaco, { default: EditorWorker }] = await Promise.all([
			import('monaco-editor'),
			import('monaco-editor/esm/vs/editor/editor.worker?worker')
		]);

		// We only register the base editor worker — C++ has no language service in monaco,
		// so the default tokenizer is sufficient.
		(self as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
			getWorker: () => new EditorWorker()
		};

		if (disposed) return;
		editor = monaco.editor.create(container, {
			value,
			language,
			theme,
			automaticLayout: true,
			minimap: { enabled: false },
			fontSize: 13,
			fontFamily:
				'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
			scrollBeyondLastLine: false,
			tabSize: 4,
			readOnly: readonly,
			renderLineHighlight: 'gutter',
			padding: { top: 12, bottom: 12 }
		});

		editor.onDidChangeModelContent(() => {
			value = editor.getValue();
		});
	});

	// Reactive: if the parent updates `value` externally, sync into editor.
	$effect(() => {
		if (editor && editor.getValue() !== value) {
			editor.setValue(value);
		}
	});

	onDestroy(() => {
		disposed = true;
		editor?.dispose();
	});
</script>

<div bind:this={container} class="size-full overflow-hidden rounded-md border" style="height: {height};"></div>
