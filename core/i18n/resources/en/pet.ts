export const pet = {
  lines: {
    thinking: ['Thinking...', 'Reasoning...', 'Working it through'],
    working: ['Working', 'Crafting', 'Building'],
    speaking: ['Explaining', 'Unfolding', 'Finding the thread'],
    idle: [
      'Explain this page',
      'Click to ask me',
      'Ask DeepSeek',
      'Anything you want to chat?',
      'Select text & right click to ask me',
      'Idle',
      'Tap to check in',
      'Taking a breath',
    ],
    confused: ['Reorienting', 'Sorting it out', 'Finding the path'],
    success: ['Done', 'Handled', 'Finished'],
    error: ['Stuck...', 'Something failed', 'Needs a retry'],
    sleepy: ['Zzz...', 'Sleepy...', 'Taking a nap'],
  },
} as const;
