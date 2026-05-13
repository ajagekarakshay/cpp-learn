import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import conceptsData from '$lib/data/concepts.json' with { type: 'json' };
import { generateQuestion } from '$lib/server/gemini';
import type { ConceptsData, Question } from '$lib/types';
import type { RequestHandler } from './$types';

const data = conceptsData as ConceptsData;

const Body = z.object({
	apiKey: z.string().min(1, 'Gemini API key is required'),
	model: z.string().min(1),
	conceptId: z.string(),
	standard: z.enum(['c++20', 'c++23', 'c++26']),
	skillEstimate: z.string().default('beginner'),
	preferKind: z.enum(['predict-output', 'fix-bug', 'implement', 'explain', 'mcq']).optional(),
	progress: z
		.object({
			conceptId: z.string(),
			status: z.string(),
			confidence: z.number(),
			attempts: z.number(),
			correctCount: z.number(),
			lastSeenAt: z.number().optional(),
			notes: z.array(z.string())
		})
		.optional(),
	gapsAcross: z.array(z.string()).optional(),
	avoidTitles: z.array(z.string()).optional()
});

function nanoid(): string {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const POST: RequestHandler = async ({ request }) => {
	const raw = await request.json().catch(() => null);
	const parsed = Body.safeParse(raw);
	if (!parsed.success) error(400, parsed.error.issues.map((i) => i.message).join('; '));

	const concept = data.concepts.find((c) => c.id === parsed.data.conceptId);
	if (!concept) error(404, 'unknown concept');

	try {
		const q = await generateQuestion({
			apiKey: parsed.data.apiKey,
			model: parsed.data.model,
			concept,
			standard: parsed.data.standard,
			skillEstimate: parsed.data.skillEstimate,
			preferKind: parsed.data.preferKind,
			// @ts-expect-error: status is a string but matches the union from the schema validation above
			progress: parsed.data.progress,
			gapsAcross: parsed.data.gapsAcross,
			avoidTitles: parsed.data.avoidTitles
		});
		const full: Question = { id: nanoid(), createdAt: Date.now(), ...q };
		return json(full);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		error(502, `gemini failed: ${msg}`);
	}
};
