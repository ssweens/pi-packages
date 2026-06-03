import { describe, expect, it } from "vitest";

import { createClient } from "../../../src/client/create-client.js";
import { redditAdapter } from "../../../src/sources/adapters/reddit.js";
import { createFakeCredentialBackend } from "../../helpers/fake-credential-backend.js";
import { makeFakeLauncher } from "../../helpers/fake-launcher.js";

const REDDIT_BODY = JSON.stringify({
	data: {
		children: [
			{
				kind: "t3",
				data: {
					id: "abc",
					title: "t",
					selftext: "",
					author: "u",
					permalink: "/r/x/comments/abc/t/",
					url: "https://reddit.com",
					created_utc: Math.floor(Date.now() / 1000),
					score: 1,
					num_comments: 0,
				},
			},
		],
	},
});

describe("client.fetchSources", () => {
	it("returns merged result using injected adapters", async () => {
		const client = createClient({
			launcher: makeFakeLauncher(),
			sources: [redditAdapter()],
			credentials: {
				backend: "custom",
				customBackend: createFakeCredentialBackend(),
			},
			httpFetch: async () => ({
				status: 200,
				headers: {},
				body: REDDIT_BODY,
				url: "https://www.reddit.com/search.json",
			}),
		});
		const res = await client.fetchSources("rust", {
			sources: ["reddit"],
			lookbackDays: 30,
			perSourceLimit: 10,
		});
		expect(res.items).toHaveLength(1);
		expect(res.errors).toEqual([]);
	});

	it("throws config_invalid when backend is 'custom' but customBackend is missing", async () => {
		const client = createClient({
			launcher: makeFakeLauncher(),
			sources: [redditAdapter()],
			credentials: { backend: "custom" },
			httpFetch: async () => ({ status: 200, headers: {}, body: "{}", url: "" }),
		});
		await expect(client.fetchSources("rust", { sources: ["reddit"] })).rejects.toMatchObject({
			err: {
				type: "config_invalid",
				field: "credentials.customBackend",
			},
		});
	});
});
