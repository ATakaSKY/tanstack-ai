import { chat, toStreamResponse } from "@tanstack/ai";
import { gemini } from "@tanstack/ai-gemini";
import { createFileRoute } from "@tanstack/react-router";

// DEV ONLY: Workaround for TLS certificate issues with @google/genai SDK on Node 24
// Remove this in production!
if (process.env.NODE_ENV !== "production") {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

export const Route = createFileRoute("/api/chat")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const apiKey = process.env.GEMINI_API_KEY;
				// Check for API key
				if (!apiKey) {
					return new Response(
						JSON.stringify({
							error: "GEMINI_API_KEY not configured",
						}),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						},
					);
				}

				const { messages, conversationId } = await request.json();
				try {
					// Create a streaming chat response with explicit API key
					const stream = chat({
						adapter: gemini(),
						messages,
						model: "gemini-2.0-flash",
						conversationId,
					});

					// Convert stream to HTTP response
					return toStreamResponse(stream);
				} catch (error) {
					return new Response(
						JSON.stringify({
							error:
								error instanceof Error ? error.message : "An error occurred",
						}),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						},
					);
				}
			},
		},
	},
});
