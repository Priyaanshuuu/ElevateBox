import { fileURLToPath } from "node:url";
import { AutoSubscribe, cli, defineAgent, type JobContext, WorkerOptions } from "@livekit/agents";
import { RoomEvent } from "@livekit/rtc-node";
import { createAgent } from "./agent.ts";

export default defineAgent({
	entry: async (ctx: JobContext) => {
		await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
		createAgent(ctx.room);

		await ctx.waitForParticipant();

		await new Promise<void>((resolve) => {
			ctx.room.once(RoomEvent.Disconnected, () => resolve());
		});
	},
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
}