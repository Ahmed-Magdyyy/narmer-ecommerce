// Log only explicitly selected fields; request bodies and credentials never belong here.
export const logger = {
  info: fields => console.log(JSON.stringify({ level: 'info', ...fields })),
  error: fields => console.error(JSON.stringify({ level: 'error', ...fields })),
};
