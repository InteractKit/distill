import { Config } from "../../core/Config.js";
import { HostServer } from "../../core/HostServer.js";
import { Reporter } from "../../ui/Reporter.js";

// `distill host` - serve extraction over HTTP.
//   default:  run the built code extractor (no LLM, fast, free).
//   --learn:  serve LLM answers AND learn from them in the background, rebuilding
//             the code extractor over time. Watch /metrics; when code-vs-LLM
//             agreement is high, restart without --learn to serve free code.
export class HostCommand {
  constructor(
    private readonly opts: { task?: string; learn?: boolean; port?: string },
  ) {}

  async run(): Promise<void> {
    const cfg = await Config.load(this.opts.task);
    const r = new Reporter();
    const port = this.opts.port ? Number(this.opts.port) : undefined;
    if (port !== undefined && (!Number.isFinite(port) || port <= 0)) {
      throw new Error(`invalid --port "${this.opts.port}"`);
    }
    const server = new HostServer(cfg, r, {
      learn: this.opts.learn ?? false,
      port,
    });
    await server.start();
    // Keep the process alive; the HTTP server holds the event loop open.
  }
}
