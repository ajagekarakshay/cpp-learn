#!/usr/bin/env bun
// Parses cpp_quant_interview_learning_resource.md into a structured concepts.json.
// Each top-level chapter (# N. ...) becomes a "module"; each ## N.M ... becomes a "concept".
// We capture the body text for each concept so Gemini can use it as authoritative source material.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MD_PATH = join(ROOT, 'cpp_quant_interview_learning_resource.md');
const OUT_PATH = join(ROOT, 'src/lib/data/concepts.json');

const md = readFileSync(MD_PATH, 'utf-8');
const lines = md.split('\n');

interface Concept {
	id: string;
	moduleId: string;
	moduleTitle: string;
	moduleNumber: number;
	number: string; // "7.3"
	title: string;
	slug: string;
	body: string; // markdown body of just this subsection
	tags: string[];
	difficulty: 'novice' | 'intermediate' | 'advanced';
}

interface Module {
	id: string;
	number: number;
	title: string;
	slug: string;
	conceptIds: string[];
}

const modules: Module[] = [];
const concepts: Concept[] = [];

function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/`/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

// Heuristic tag/difficulty assignment based on chapter number.
function difficultyFor(moduleNum: number): Concept['difficulty'] {
	if (moduleNum <= 8) return 'novice';
	if (moduleNum <= 20) return 'intermediate';
	return 'advanced';
}

const moduleHeading = /^# (\d+)\. (.+)$/;
const conceptHeading = /^## (\d+)\.(\d+)\s+(.+)$/;

let currentModule: Module | null = null;
let currentConcept: { meta: Concept; bodyLines: string[] } | null = null;

function flushConcept() {
	if (!currentConcept) return;
	currentConcept.meta.body = currentConcept.bodyLines.join('\n').trim();
	concepts.push(currentConcept.meta);
	if (currentModule) currentModule.conceptIds.push(currentConcept.meta.id);
	currentConcept = null;
}

for (const line of lines) {
	const mm = moduleHeading.exec(line);
	if (mm) {
		flushConcept();
		const num = Number(mm[1]);
		const title = mm[2].trim();
		const m: Module = {
			id: `m${num}`,
			number: num,
			title,
			slug: slugify(`${num}-${title}`),
			conceptIds: []
		};
		modules.push(m);
		currentModule = m;
		continue;
	}
	const cm = conceptHeading.exec(line);
	if (cm) {
		flushConcept();
		if (!currentModule) continue;
		const number = `${cm[1]}.${cm[2]}`;
		const title = cm[3].trim();
		const id = `c${number.replace('.', '-')}`;
		const meta: Concept = {
			id,
			moduleId: currentModule.id,
			moduleTitle: currentModule.title,
			moduleNumber: currentModule.number,
			number,
			title,
			slug: slugify(`${number}-${title}`),
			body: '',
			tags: deriveTags(currentModule.title, title),
			difficulty: difficultyFor(currentModule.number)
		};
		currentConcept = { meta, bodyLines: [] };
		continue;
	}
	if (currentConcept) {
		currentConcept.bodyLines.push(line);
	}
}
flushConcept();

function deriveTags(moduleTitle: string, conceptTitle: string): string[] {
	const text = `${moduleTitle} ${conceptTitle}`.toLowerCase();
	const tags = new Set<string>();
	const map: Record<string, string> = {
		raii: 'raii',
		template: 'templates',
		concept: 'concepts',
		coroutine: 'coroutines',
		'move': 'move-semantics',
		lvalue: 'value-categories',
		rvalue: 'value-categories',
		virtual: 'oop',
		inherit: 'oop',
		const: 'const',
		pointer: 'pointers',
		reference: 'references',
		smart: 'smart-pointers',
		unique_ptr: 'smart-pointers',
		shared_ptr: 'smart-pointers',
		weak_ptr: 'smart-pointers',
		exception: 'exceptions',
		thread: 'concurrency',
		mutex: 'concurrency',
		atomic: 'concurrency',
		stl: 'stl',
		vector: 'stl',
		map: 'stl',
		hash: 'stl',
		iterator: 'iterators',
		algorithm: 'algorithms',
		lambda: 'lambdas',
		cache: 'performance',
		performance: 'performance',
		memory: 'memory',
		undefined: 'undefined-behavior',
		quant: 'quant',
		order: 'quant',
		csv: 'quant',
		trading: 'quant',
		c26: 'cxx26',
		'c++26': 'cxx26',
		execution: 'cxx26'
	};
	for (const [k, v] of Object.entries(map)) if (text.includes(k)) tags.add(v);
	return [...tags];
}

// Skip module 0 (study guide) and 29/32/33 (checklists/advice) from being recommended as practice paths,
// but keep them in the data for reference.
const practiceModuleIds = new Set(
	modules
		.filter((m) => m.number >= 1 && ![0, 28, 29, 32, 33].includes(m.number))
		.map((m) => m.id)
);

const out = {
	generatedAt: new Date().toISOString(),
	sourceFile: 'cpp_quant_interview_learning_resource.md',
	modules,
	concepts,
	practiceModuleIds: [...practiceModuleIds]
};

const outDir = dirname(OUT_PATH);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));

console.log(
	`Wrote ${concepts.length} concepts across ${modules.length} modules to ${OUT_PATH}`
);
