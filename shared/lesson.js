// Reaching a session's lesson switches (workers/lesson) from any Worker bound to them.
export const lessonStub = (env, session) => env.LESSON.get(env.LESSON.idFromName(session));
export const lessonSwitches = (env, session) => lessonStub(env, session).switches();
