// What a Bot sees when its own reminder fires.
//
// The stored prompt was written to the Bot's future self ("remind the user to …"). Delivered
// bare it reads like a message from the user, so the Bot answered it like one: flat, and
// without the thing it had promised to say. Framing it as the Bot's own reminder is what
// lets it speak instead of reading out the note.
export interface ReminderTask {
  readonly title: string
  readonly prompt: string
}

export function reminderText(task: ReminderTask): string {
  return [
    `[YOUR OWN REMINDER] ${task.title}`,
    '',
    'You set this earlier and it has just come due. Tell the user now, the way you would say',
    'it in passing: one or two short sentences, in their language, naming what it was about.',
    'Do not explain that a reminder fired, do not read the note below back word for word,',
    'and do not ask a question that does not need an answer.',
    '',
    `(what you noted: ${task.prompt === '' ? task.title : task.prompt})`,
  ].join('\n')
}
