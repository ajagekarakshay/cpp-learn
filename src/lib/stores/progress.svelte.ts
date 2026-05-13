import { browser } from '$app/environment';
import type {
	AttemptRecord,
	ConceptProgress,
	CppStandard,
	Evaluation,
	ProgressState,
	Question,
	QuestionKind
} from '$lib/types';
import conceptsData from '$lib/data/concepts.json' with { type: 'json' };
import type { ConceptsData } from '$lib/types';

const STORAGE_KEY = 'cpp-quant-progress-v1';
const MAX_ATTEMPTS = 200;

const data = conceptsData as ConceptsData;

function defaultState(): ProgressState {
	const concepts: Record<string, ConceptProgress> = {};
	// Unlock first concept of each practice module; lock the rest. The first practice module
	// (lowest module number) is unlocked entirely so the user has a starting point.
	const practiceModules = data.modules
		.filter((m) => data.practiceModuleIds.includes(m.id))
		.sort((a, b) => a.number - b.number);
	const firstModuleId = practiceModules[0]?.id;

	for (const c of data.concepts) {
		const isPracticeable = data.practiceModuleIds.includes(c.moduleId);
		const status: ConceptProgress['status'] = !isPracticeable
			? 'unlocked'
			: c.moduleId === firstModuleId
				? 'unlocked'
				: 'locked';
		concepts[c.id] = {
			conceptId: c.id,
			status,
			confidence: 0,
			attempts: 0,
			correctCount: 0,
			notes: []
		};
	}
	return {
		version: 1,
		concepts,
		attempts: [],
		skillEstimate: 'novice',
		preferredStandard: 'c++26'
	};
}

function load(): ProgressState {
	if (!browser) return defaultState();
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return defaultState();
		const parsed = JSON.parse(raw) as ProgressState;
		if (parsed.version !== 1) return defaultState();
		// Merge in any new concepts not present in saved state (e.g., after curriculum update).
		const base = defaultState();
		for (const id of Object.keys(base.concepts)) {
			if (!parsed.concepts[id]) parsed.concepts[id] = base.concepts[id];
		}
		return parsed;
	} catch {
		return defaultState();
	}
}

function save(s: ProgressState) {
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
	} catch {
		// quota — ignore
	}
}

class ProgressStore {
	state = $state<ProgressState>(defaultState());

	constructor() {
		if (browser) this.state = load();
	}

	#persist() {
		save(this.state);
	}

	setStandard(s: CppStandard) {
		this.state.preferredStandard = s;
		this.#persist();
	}

	getConcept(id: string): ConceptProgress {
		return this.state.concepts[id];
	}

	// Module is unlocked iff at least one of its concepts is unlocked / beyond.
	moduleStatus(moduleId: string): { unlocked: number; mastered: number; total: number } {
		const conceptIds = data.modules.find((m) => m.id === moduleId)?.conceptIds ?? [];
		let unlocked = 0;
		let mastered = 0;
		for (const id of conceptIds) {
			const p = this.state.concepts[id];
			if (!p) continue;
			if (p.status !== 'locked') unlocked++;
			if (p.status === 'mastered') mastered++;
		}
		return { unlocked, mastered, total: conceptIds.length };
	}

	// Aggregate the most recent gaps across all concepts.
	recentGapsAcross(limit = 8): string[] {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const a of this.state.attempts) {
			for (const g of a.gaps) {
				if (seen.has(g)) continue;
				seen.add(g);
				out.push(g);
				if (out.length >= limit) return out;
			}
		}
		return out;
	}

	recordAttempt(question: Question, evaluation: Evaluation, durationMs: number) {
		const conceptId = question.conceptId;
		const cp = this.state.concepts[conceptId];
		const firstAttempt = cp.attempts === 0;
		cp.attempts += 1;
		cp.lastSeenAt = Date.now();
		if (evaluation.verdict === 'correct') cp.correctCount += 1;

		// On the first attempt, take Gemini's reported confidence directly so a single strong
		// answer can master the concept. On later attempts, smooth with EMA so a one-off lucky
		// guess can't override prior signal.
		if (firstAttempt) {
			cp.confidence = evaluation.confidence;
		} else {
			const alpha = 0.5;
			cp.confidence = Math.max(
				0,
				Math.min(1, (1 - alpha) * cp.confidence + alpha * evaluation.confidence)
			);
		}

		// Append novel gaps as notes (dedupe).
		for (const g of evaluation.gaps) {
			if (!cp.notes.includes(g)) cp.notes.push(g);
		}
		// Cap notes to prevent unbounded growth.
		if (cp.notes.length > 20) cp.notes = cp.notes.slice(-20);

		// Status transitions.
		const ev = evaluation.verdict;
		if (ev === 'correct' && cp.confidence >= 0.6) {
			cp.status = 'mastered';
			this.#unlockDownstream(conceptId);
		} else if (ev === 'correct' && cp.confidence < 0.7) {
			cp.status = 'shaky';
			// Still unlock next concept — user can keep going but flagged for revisit.
			this.#unlockDownstream(conceptId);
		} else if (ev === 'partial') {
			cp.status = 'shaky';
		} else if (ev === 'incorrect') {
			cp.status = 'in-progress';
		}

		this.state.attempts.unshift({
			questionId: question.id,
			conceptId,
			at: Date.now(),
			kind: question.kind,
			verdict: ev,
			confidence: evaluation.confidence,
			gaps: evaluation.gaps,
			durationMs
		});
		if (this.state.attempts.length > MAX_ATTEMPTS)
			this.state.attempts.length = MAX_ATTEMPTS;

		this.#updateSkillEstimate();
		this.#persist();
	}

	recordSkip(question: Question, durationMs: number) {
		const cp = this.state.concepts[question.conceptId];
		cp.attempts += 1;
		cp.lastSeenAt = Date.now();
		// Skipping a question still counts as exposure but reduces confidence slightly.
		cp.confidence = Math.max(0, cp.confidence * 0.9);
		if (cp.status === 'locked') cp.status = 'unlocked';
		this.state.attempts.unshift({
			questionId: question.id,
			conceptId: question.conceptId,
			at: Date.now(),
			kind: question.kind,
			verdict: 'skipped',
			confidence: 0,
			gaps: [`Skipped a ${question.kind} question on ${question.title}`],
			durationMs
		});
		if (this.state.attempts.length > MAX_ATTEMPTS)
			this.state.attempts.length = MAX_ATTEMPTS;
		this.#persist();
	}

	#unlockDownstream(conceptId: string) {
		// Find the concept's module, unlock the next concept in that module, and if
		// this was the last concept in the module, unlock the first concept of the next module.
		const concept = data.concepts.find((c) => c.id === conceptId);
		if (!concept) return;
		const mod = data.modules.find((m) => m.id === concept.moduleId);
		if (!mod) return;
		const idx = mod.conceptIds.indexOf(conceptId);
		if (idx >= 0 && idx + 1 < mod.conceptIds.length) {
			const nextId = mod.conceptIds[idx + 1];
			const next = this.state.concepts[nextId];
			if (next.status === 'locked') next.status = 'unlocked';
		} else {
			// Move to next module.
			const practice = data.modules
				.filter((m) => data.practiceModuleIds.includes(m.id))
				.sort((a, b) => a.number - b.number);
			const modIdx = practice.findIndex((m) => m.id === mod.id);
			const next = practice[modIdx + 1];
			if (next && next.conceptIds[0]) {
				const np = this.state.concepts[next.conceptIds[0]];
				if (np.status === 'locked') np.status = 'unlocked';
			}
		}
	}

	#updateSkillEstimate() {
		const mastered = Object.values(this.state.concepts).filter((c) => c.status === 'mastered')
			.length;
		const totalPractice = data.concepts.filter((c) =>
			data.practiceModuleIds.includes(c.moduleId)
		).length;
		const ratio = mastered / Math.max(1, totalPractice);
		if (ratio < 0.1) this.state.skillEstimate = 'novice';
		else if (ratio < 0.3) this.state.skillEstimate = 'beginner';
		else if (ratio < 0.7) this.state.skillEstimate = 'intermediate';
		else this.state.skillEstimate = 'advanced';
	}

	// Suggest the next concept to practice. Strategy:
	//   1. The first un-mastered, un-locked concept in curriculum order — UNLESS the user just
	//      attempted it and the result wasn't mastery, in which case we prefer to advance to
	//      the next un-mastered concept so the dashboard reflects forward motion.
	//   2. Falls back to the most-recently-attempted concept if there's nothing further.
	suggestNextConceptId(): string | null {
		const lastAttempt = this.state.attempts[0];
		const lastConceptId = lastAttempt?.conceptId;

		const practiceModules = data.modules
			.filter((m) => data.practiceModuleIds.includes(m.id))
			.sort((a, b) => a.number - b.number);

		const isCandidate = (cid: string) => {
			const p = this.state.concepts[cid];
			return p && (p.status === 'unlocked' || p.status === 'in-progress' || p.status === 'shaky');
		};

		const ordered: string[] = [];
		for (const m of practiceModules) for (const cid of m.conceptIds) ordered.push(cid);

		// First pass: skip the last-attempted concept so suggested-next visibly advances after
		// every submit. If the user wants to keep drilling, they can click "Another on this
		// concept" from the question view.
		for (const cid of ordered) {
			if (cid === lastConceptId) continue;
			if (isCandidate(cid)) return cid;
		}
		// Second pass: fall back to the last-attempted concept if it's still un-mastered.
		for (const cid of ordered) {
			if (isCandidate(cid)) return cid;
		}
		return null;
	}

	reset() {
		this.state = defaultState();
		this.#persist();
	}
}

export const progress = new ProgressStore();
