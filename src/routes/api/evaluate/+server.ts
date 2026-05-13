import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import conceptsData from '$lib/data/concepts.json' with { type: 'json' };
import { evaluateAnswer } from '$lib/server/gemini';
import type { ConceptsData } from '$lib/types';
import type { RequestHandler } from './$types';

const data = conceptsData as ConceptsData;

const QuestionSchema = z.object({
	id: z.string(),
	conceptId: z.string(),
	kind: z.enum(['predict-output', 'fix-bug', 'implement', 'explain', 'mcq']),
	standard: z.enum(['c++20', 'c++23', 'c++26']),
	title: z.string(),
	prompt: z.string(),
	starterCode: z.string().optional(),
	hints: z.array(z.string()),
	expectedConcepts: z.array(z.string()),
	referenceAnswer: z.string().optional(),
	choices: z
		.array(z.object({ id: z.string(), text: z.string() }))
		.optional(),
	correctChoiceId: z.string().optional(),
	createdAt: z.number()
});

const Body = z.object({
	apiKey: z.string().min(1, 'Gemini API key is required'),
	model: z.string().min(1),
	question: QuestionSchema,
	userAnswer: z.string(),
	userCode: z.string().optional(),
	compileStdout: z.string().optional(),
	compileStderr: z.string().optional()
});

export const POST: RequestHandler = async ({ request }) => {
	const raw = await request.json().catch(() => null);
	const parsed = Body.safeParse(raw);
	if (!parsed.success) error(400, parsed.error.issues.map((i) => i.message).join('; '));

	const concept = data.concepts.find((c) => c.id === parsed.data.question.conceptId);
	if (!concept) error(404, 'unknown concept');

	try {
		const evalRes = await evaluateAnswer({
			apiKey: parsed.data.apiKey,
			model: parsed.data.model,
			concept,
			question: parsed.data.question,
			userAnswer: parsed.data.userAnswer,
			userCode: parsed.data.userCode,
			compileStdout: parsed.data.compileStdout,
			compileStderr: parsed.data.compileStderr
		});
		return json(evalRes);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		error(502, `gemini failed: ${msg}`);
	}
};
