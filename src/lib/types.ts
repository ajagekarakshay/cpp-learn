export type CppStandard = 'c++20' | 'c++23' | 'c++26';

export type QuestionKind = 'predict-output' | 'fix-bug' | 'implement' | 'explain' | 'mcq';

export interface Concept {
	id: string;
	moduleId: string;
	moduleTitle: string;
	moduleNumber: number;
	number: string;
	title: string;
	slug: string;
	body: string;
	tags: string[];
	difficulty: 'novice' | 'intermediate' | 'advanced';
}

export interface ConceptModule {
	id: string;
	number: number;
	title: string;
	slug: string;
	conceptIds: string[];
}

export interface ConceptsData {
	generatedAt: string;
	sourceFile: string;
	modules: ConceptModule[];
	concepts: Concept[];
	practiceModuleIds: string[];
}

export interface Question {
	id: string; // client-generated nanoid
	conceptId: string;
	kind: QuestionKind;
	standard: CppStandard;
	title: string;
	prompt: string; // markdown
	starterCode?: string;
	hints: string[];
	expectedConcepts: string[]; // ideas that should appear in correct answer
	// For predict-output / mcq we store an authoritative answer; for open-ended we let Gemini grade.
	referenceAnswer?: string;
	choices?: { id: string; text: string }[];
	correctChoiceId?: string;
	createdAt: number;
}

export interface Evaluation {
	correct: boolean;
	confidence: number; // 0..1 — model's confidence that the user truly understands
	score: number; // 0..100
	verdict: 'correct' | 'partial' | 'incorrect';
	strengths: string[];
	gaps: string[]; // misconceptions to remember
	feedback: string; // markdown — what to study next
	suggestedNextConceptId?: string;
}

export interface AttemptRecord {
	questionId: string;
	conceptId: string;
	at: number;
	kind: QuestionKind;
	verdict: 'correct' | 'partial' | 'incorrect' | 'skipped';
	confidence: number;
	gaps: string[];
	durationMs: number;
}

export interface ConceptProgress {
	conceptId: string;
	status: 'locked' | 'unlocked' | 'in-progress' | 'mastered' | 'shaky';
	confidence: number; // rolling 0..1
	attempts: number;
	correctCount: number;
	lastSeenAt?: number;
	notes: string[]; // misconception notes accumulated
}

export interface ProgressState {
	version: 1;
	concepts: Record<string, ConceptProgress>;
	attempts: AttemptRecord[]; // capped, newest first
	skillEstimate: 'novice' | 'beginner' | 'intermediate' | 'advanced';
	preferredStandard: CppStandard;
}

export interface CompileResult {
	stdout: string;
	stderr: string;
	asm?: string;
	exitCode: number;
	timedOut: boolean;
	durationMs: number;
}
