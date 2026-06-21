export function toMcpError(err) {
  const code = err.code || 500;
  const message = err.expose ? err.message : "An internal error occurred";

  return {
    content: [{ type: "text", text: JSON.stringify({ error: message, code }) }],
    isError: true,
  };
}
