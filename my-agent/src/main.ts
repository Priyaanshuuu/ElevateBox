import { fileURLToPath } from "node:url";
import { AutoSubscribe, cli, defineAgent, type JobContext, WorkerOptions } from "@livekit/agents";
import { RoomEvent } from "@livekit/rtc-node";
import { createAgent } from "./agent.ts";

export default defineAgent({
	entry: async (ctx: JobContext) => {
		console.log("Job entry started.");
		await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
		console.log("Connected to room.");
		createAgent(ctx.room);

		await ctx.waitForParticipant();

		await new Promise<void>((resolve) => {
			ctx.room.once(RoomEvent.Disconnected, () => resolve());
		});
	},
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	cli.runApp(
		new WorkerOptions({
			agent: fileURLToPath(import.meta.url),
			agentName: process.env.LIVEKIT_AGENT_NAME ?? "voice-sales-agent",
			initializeProcessTimeout: 30_000,
		}),
	);
}