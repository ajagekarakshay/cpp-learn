import { GoogleGenAI, Type } from '@google/genai';
import type {
	CppStandard,
	Concept,
	ConceptProgress,
	Evaluation,
	Question,
	QuestionKind
} from '$lib/types';

// The API key is supplied per-request by the client (read from the user's localStorage). The
// server never stores it. We do cache one client instance per key+model combo to avoid re-
// constructing the SDK class on every call within the same process lifetime.
const clientCache = new Map<string, GoogleGenAI>();
function client(apiKey: string): GoogleGenAI {
	if (!apiKey) throw new Error('Missing Gemini API key. Open Settings and paste one in.');
	let c = clientCache.get(apiKey);
	if (!c) {
		c = new GoogleGenAI({ apiKey });
		clientCache.set(apiKey, c);
	}
	return c;
}

// Truncate concept body to keep prompts cheap. The full body is usually <2k chars but cap it.
function clip(s: string, n: number) {
	return s.length > n ? s.slice(0, n) + '\n...[truncated]' : s;
}

const QUESTION_SCHEMA = {
	type: Type.OBJECT,
	properties: {
		kind: {
			type: Type.STRING,
			enum: ['predict-output', 'fix-bug', 'implement', 'explain', 'mcq']
		},
		title: { type: Type.STRING },
		prompt: { type: Type.STRING, description: 'Markdown prompt for the user.' },
		starterCode: { type: Type.STRING, description: 'Optional starter C++ code.' },
		hints: { type: Type.ARRAY, items: { type: Type.STRING } },
		expectedConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
		referenceAnswer: {
			type: Type.STRING,
			description:
				'For predict-output: the exact expected program output. For explain: a model answer. Empty for implement/fix-bug.'
		},
		choices: {
			type: Type.ARRAY,
			items: {
				type: Type.OBJECT,
				properties: {
					id: { type: Type.STRING },
					text: { type: Type.STRING }
				},
				required: ['id', 'text']
			}
		},
		correctChoiceId: { type: Type.STRING }
	},
	required: ['kind', 'title', 'prompt', 'hints', 'expectedConcepts']
};

const EVAL_SCHEMA = {
	type: Type.OBJECT,
	properties: {
		correct: { type: Type.BOOLEAN },
		confidence: { type: Type.NUMBER, description: '0..1 — confidence the user truly understands' },
		score: { type: Type.NUMBER, description: '0..100' },
		verdict: { type: Type.STRING, enum: ['correct', 'partial', 'incorrect'] },
		strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
		gaps: {
			type: Type.ARRAY,
			items: { type: Type.STRING },
			description: 'Concrete misconceptions to remember for future questions.'
		},
		feedback: { type: Type.STRING, description: 'Markdown feedback for the user.' }
	},
	required: ['correct', 'confidence', 'score', 'verdict', 'strengths', 'gaps', 'feedback']
};

export interface GenerateParams {
	apiKey: string;
	model: string;
	concept: Concept;
	standard: CppStandard;
	skillEstimate: string;
	progress?: ConceptProgress;
	preferKind?: QuestionKind;
	// Compact summary of past gaps across all concepts to inform new question difficulty.
	gapsAcross?: string[];
	avoidTitles?: string[];
}

export async function generateQuestion(params: GenerateParams): Promise<Omit<Question, 'id' | 'createdAt'>> {
	const { apiKey, model, concept, standard, skillEstimate, progress, preferKind, gapsAcross, avoidTitles } =
		params;

	const kindHint = preferKind
		? `Strongly prefer the question kind: ${preferKind}.`
		: progress && progress.confidence < 0.5
			? 'Prefer "predict-output" or "mcq" to diagnose specific misconceptions.'
			: 'Choose whichever kind best tests deep understanding: predict-output, fix-bug, implement, explain, mcq.';

	const noteSection = progress?.notes.length
		? `Prior recorded misconceptions for THIS concept:\n- ${progress.notes.slice(0, 6).join('\n- ')}\nDesign the question to probe these directly.`
		: 'No prior misconceptions logged for this concept.';

	const globalSection = gapsAcross && gapsAcross.length
		? `User's recent gaps across other concepts:\n- ${gapsAcross.slice(0, 8).join('\n- ')}`
		: '';

	const avoidSection = avoidTitles && avoidTitles.length
		? `Do NOT reuse these question titles: ${avoidTitles.slice(0, 10).join(' | ')}`
		: '';

	const sys = `You are an expert C++ instructor crafting exercises for an aspiring quant developer.
Generate ONE question targeting the concept below. The question must:
- Compile under ${standard} (use features from that standard when relevant).
- Be solvable in under 10 minutes.
- Test real understanding, not trivia.
- If "predict-output", set referenceAnswer to the EXACT expected stdout (no extra whitespace).
- If "mcq", include 4 plausible choices with one clearly correct.
- If "fix-bug", starterCode contains buggy code; the user must produce a fixed version.
- If "implement", starterCode contains a signature/skeleton and TODO comments.
- "explain" asks for a written answer; include a referenceAnswer model response.
- Calibrate to the user's skill level: ${skillEstimate}.
${kindHint}
${noteSection}
${globalSection}
${avoidSection}`;

	const user = `Concept ${concept.number} — ${concept.title} (module: ${concept.moduleTitle}).
Authoritative source material (use this as ground truth, do not contradict it):

${clip(concept.body, 4000)}`;

	const res = await client(apiKey).models.generateContent({
		model,
		contents: [{ role: 'user', parts: [{ text: user }] }],
		config: {
			systemInstruction: sys,
			responseMimeType: 'application/json',
			responseSchema: QUESTION_SCHEMA,
			temperature: 0.8
		}
	});

	const text = res.text ?? '';
	const parsed = JSON.parse(text) as Omit<Question, 'id' | 'createdAt' | 'conceptId' | 'standard'>;
	return {
		conceptId: concept.id,
		standard,
		...parsed,
		hints: parsed.hints ?? [],
		expectedConcepts: parsed.expectedConcepts ?? []
	};
}

export interface EvaluateParams {
	apiKey: string;
	model: string;
	concept: Concept;
	question: Question;
	userAnswer: string;
	userCode?: string;
	compileStdout?: string;
	compileStderr?: string;
}

export async function evaluateAnswer(params: EvaluateParams): Promise<Evaluation> {
	const { apiKey, model, concept, question, userAnswer, userCode, compileStdout, compileStderr } =
		params;

	// Cheap deterministic short-circuit for predict-output and mcq.
	if (question.kind === 'predict-output' && question.referenceAnswer) {
		const norm = (s: string) =>
			s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
		const correct = norm(userAnswer) === norm(question.referenceAnswer);
		if (correct) {
			return {
				correct: true,
				confidence: 0.9,
				score: 100,
				verdict: 'correct',
				strengths: ['Produced the exact expected output.'],
				gaps: [],
				feedback: 'Correct — your output matched exactly.'
			};
		}
		// Fall through to Gemini for diagnostic feedback on a wrong answer.
	}
	if (question.kind === 'mcq' && question.correctChoiceId) {
		const picked = userAnswer.trim();
		const correct = picked === question.correctChoiceId;
		return {
			correct,
			confidence: correct ? 0.85 : 0.2,
			score: correct ? 100 : 0,
			verdict: correct ? 'correct' : 'incorrect',
			strengths: correct ? ['Picked the correct option.'] : [],
			gaps: correct
				? []
				: [`Confused option ${picked} for the correct ${question.correctChoiceId} on: ${concept.title}`],
			feedback: correct
				? 'Correct.'
				: `The correct answer was option ${question.correctChoiceId}. Review the explanation below and try a follow-up question.`
		};
	}

	const sys = `You are a strict but fair C++ grader. Evaluate the user's answer to the question below.
Return JSON only. Calibrate "confidence" as your belief the user TRULY understands ${concept.title} based on this answer (not just got lucky). Be honest: if the answer is shallow or memorized, lower confidence even if the surface answer is "correct".

In "gaps", record CONCRETE misconceptions in 1 sentence each (e.g., "Believes std::move performs a copy", "Conflates references with pointers"). These will be re-used as inputs to future question generation, so make them precise.`;

	const compileBlock = userCode
		? `Compiled output:\n--- stdout ---\n${compileStdout ?? ''}\n--- stderr ---\n${compileStderr ?? ''}`
		: '';

	const user = `Concept: ${concept.number} ${concept.title}
Question kind: ${question.kind}
Question prompt:
${question.prompt}

${question.referenceAnswer ? `Reference answer:\n${question.referenceAnswer}\n` : ''}
${question.expectedConcepts.length ? `Concepts that should appear: ${question.expectedConcepts.join(', ')}\n` : ''}

Authoritative source material (ground truth):
${clip(concept.body, 3000)}

User's written answer:
${userAnswer || '(empty)'}

${userCode ? `User's code:\n\`\`\`cpp\n${userCode}\n\`\`\`\n${compileBlock}` : ''}`;

	const res = await client(apiKey).models.generateContent({
		model,
		contents: [{ role: 'user', parts: [{ text: user }] }],
		config: {
			systemInstruction: sys,
			responseMimeType: 'application/json',
			responseSchema: EVAL_SCHEMA,
			temperature: 0.2
		}
	});
	const text = res.text ?? '';
	return JSON.parse(text) as Evaluation;
}
