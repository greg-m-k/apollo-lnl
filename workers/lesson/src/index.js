// Home of the per-session Lesson switches (broker down, consumer paused). Its own Worker,
// so the services that read the switches and the site that sets them can deploy in order.
import { Lesson } from "../../../shared/lesson.js";

export { Lesson };
export default { fetch: () => new Response("lesson switches live in the Lesson Durable Object", { status: 404 }) };
