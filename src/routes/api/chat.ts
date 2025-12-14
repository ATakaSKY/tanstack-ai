import { chat, toolDefinition, toStreamResponse } from "@tanstack/ai";
import { gemini } from "@tanstack/ai-gemini";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// DEV ONLY: Workaround for TLS certificate issues with @google/genai SDK on Node 24
// Remove this in production!
if (process.env.NODE_ENV !== "production") {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

// Define input and output schemas
const weatherInputSchema = z.object({
	location: z
		.string()
		.meta({ description: "The city and state, e.g. San Francisco, CA" }),
	unit: z.enum(["celsius", "fahrenheit"]).optional(),
});

const weatherOutputSchema = z.object({
	temperature: z.number(),
	conditions: z.string(),
	location: z.string(),
});

// Create the tool definition with type assertions for Zod 4 compatibility
const getWeatherDef = toolDefinition({
	name: "get_weather",
	description: "Get the current weather for a location",
	// biome-ignore lint: Zod 4 schemas require type assertion for @tanstack/ai compatibility
	inputSchema: weatherInputSchema as any,
	// biome-ignore lint: Zod 4 schemas require type assertion for @tanstack/ai compatibility
	outputSchema: weatherOutputSchema as any,
});

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

				const getWeather = getWeatherDef.server(async ({ location, unit }) => {
					try {
						// Use Open-Meteo geocoding API to get coordinates from location name
						const geoResponse = await fetch(
							`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`,
						);
						const geoData = await geoResponse.json();

						if (!geoData.results || geoData.results.length === 0) {
							return {
								temperature: 0,
								conditions: "Location not found",
								location: location,
							};
						}

						const { latitude, longitude, name, country } = geoData.results[0];

						// Fetch weather data from Open-Meteo (free, no API key required)
						const tempUnit = unit === "fahrenheit" ? "fahrenheit" : "celsius";
						const weatherResponse = await fetch(
							`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&temperature_unit=${tempUnit}`,
						);
						const weatherData = await weatherResponse.json();

						// Map weather codes to conditions
						const weatherCodes: Record<number, string> = {
							0: "Clear sky",
							1: "Mainly clear",
							2: "Partly cloudy",
							3: "Overcast",
							45: "Foggy",
							48: "Depositing rime fog",
							51: "Light drizzle",
							53: "Moderate drizzle",
							55: "Dense drizzle",
							61: "Slight rain",
							63: "Moderate rain",
							65: "Heavy rain",
							71: "Slight snow",
							73: "Moderate snow",
							75: "Heavy snow",
							80: "Slight rain showers",
							81: "Moderate rain showers",
							82: "Violent rain showers",
							95: "Thunderstorm",
						};

						const weatherCode = weatherData.current?.weather_code ?? 0;
						const conditions = weatherCodes[weatherCode] || "Unknown";

						return {
							temperature: weatherData.current?.temperature_2m ?? 0,
							conditions,
							location: `${name}, ${country}`,
						};
					} catch (error) {
						console.error("Weather API error:", error);
						return {
							temperature: 0,
							conditions: "Error fetching weather",
							location: location,
						};
					}
				});

				try {
					// Create a streaming chat response with explicit API key
					const stream = chat({
						adapter: gemini(),
						messages,
						model: "gemini-2.0-flash",
						conversationId,
						tools: [getWeather],
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
